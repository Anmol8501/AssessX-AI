"""Phase 6B: the admin evidence endpoints — isolation, integrity, pagination and cost.

What is asserted: only administrators can read evidence (candidates 403 for their own attempt and
anyone else's, anonymous 401); an evidence id is only valid within its own attempt (another attempt's id
is 404 — no IDOR); malformed ids and cursors are 422; nothing can create or modify evidence (405, and
events cannot smuggle evidence fields); every item traces to real stored events of that attempt; a
finished attempt's evidence is fixed and repeatable; pages are bounded and complete; the query count
does not grow with the number of events; and each read is logged with ids only.
"""

import logging
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.base import utcnow
from app.models.proctoring_event import ProctoringEvent, ProctoringEventType
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, intruder, proctored_exam, session_row, unproctored_exam
from tests.test_proctoring_events import post_event
from tests.test_risk_api import add_rows, count_queries

E = ProctoringEventType


@pytest.fixture
def active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers}


LIST = "/api/v1/admin/attempts/{}/evidence"
ITEM = "/api/v1/admin/attempts/{}/evidence/{}"


def get(client, helpers: Helpers, url: str, expect: int = 200, **params) -> dict:
    response = client.get(url, headers=admin_headers(helpers), params=params)
    assert response.status_code == expect, response.text
    return response.json()


def seed_mixed(db, active) -> None:
    """A correlated face-absence + focus-loss episode, then — each more than the 30 s correlation window
    apart, so 6A does not chain them in — a blocked paste and an open multiple-faces episode."""
    face, faces = str(uuid.uuid4()), str(uuid.uuid4())
    add_rows(
        db,
        active,
        [
            (E.FACE_NOT_DETECTED, 300, {"phase": "started", "episode_id": face}),
            (E.FOCUS_LOST, 298, {"reason": "deactivated"}),
            (E.FOCUS_REGAINED, 292, {"duration_ms": 6000}),
            (
                E.FACE_NOT_DETECTED,
                290,
                {"phase": "resolved", "episode_id": face, "resolution": "condition_cleared"},
            ),
            (E.PASTE_ATTEMPT, 200, {"shortcut": "CTRL+V", "blocked": True}),
            (E.MULTIPLE_FACES_DETECTED, 100, {"phase": "started", "episode_id": faces, "face_count": 2}),
        ],
    )


# -- what an administrator sees ---------------------------------------------------------------------


def test_the_timeline_is_chronological_traceable_and_explained(client, db, helpers: Helpers, active):
    seed_mixed(db, active)
    body = get(client, helpers, LIST.format(active["attempt"]["id"]))

    assert (body["policy_version"], body["evidence_version"], body["session_live"]) == (
        "6A-v1",
        "6B-v1",
        True,
    )
    assert body["total"] == 4 and body["next_cursor"] is None
    items = body["items"]
    assert [i["event_type"] for i in items] == [
        "FACE_NOT_DETECTED",
        "FOCUS_LOST",
        "PASTE_ATTEMPT",
        "MULTIPLE_FACES_DETECTED",
    ]
    assert [i["started_at"] for i in items] == sorted(i["started_at"] for i in items)
    statuses = {i["event_type"]: i["status"] for i in items}
    assert statuses == {
        "FACE_NOT_DETECTED": "RESOLVED",
        "FOCUS_LOST": "RESOLVED",
        "PASTE_ATTEMPT": "INSTANT",
        "MULTIPLE_FACES_DETECTED": "ONGOING",
    }
    ongoing = items[-1]
    assert (
        ongoing["ended_at"] is None
        and ongoing["duration_seconds"] is None
        and ongoing["counted_seconds"] >= 99
    )

    # Every source id is a real stored event of *this* attempt's session.
    session = session_row(db, active["attempt"])
    stored = {
        str(i) for i in db.scalars(select(ProctoringEvent.id).where(ProctoringEvent.session_id == session.id))
    }
    assert all(sid in stored for i in items for sid in i["source_event_ids"])
    assert all(i["evidence_id"] == i["source_event_ids"][0] for i in items)

    [episode] = body["episodes"]  # face absence + focus loss, correlated by 6A
    assert set(episode["member_ids"]) == {items[0]["evidence_id"], items[1]["evidence_id"]}
    assert items[0]["episode_id"] == items[1]["episode_id"] == episode["episode_id"]
    assert "does not establish a cause or an intent" in episode["explanation"]
    assert "does not determine intent" in body["interpretation"]


def test_an_attempt_without_evidence(client, helpers: Helpers, active):
    body = get(client, helpers, LIST.format(active["attempt"]["id"]))
    assert (body["total"], body["items"], body["episodes"], body["next_cursor"]) == (0, [], [], None)


def test_a_finished_attempt_is_fixed_honest_about_missing_ends_and_repeatable(
    client, db, helpers: Helpers, active
):
    face = str(uuid.uuid4())
    add_rows(
        db,
        active,
        [
            (E.FACE_NOT_DETECTED, 40, {"phase": "started", "episode_id": face}),
            (E.FOCUS_LOST, 20, {"reason": "deactivated"}),  # never regained
        ],
    )
    submit(client, active["headers"], active["attempt"]["id"])
    url = LIST.format(active["attempt"]["id"])

    first, second = get(client, helpers, url), get(client, helpers, url)
    for body in (first, second):
        body.pop("calculated_at")
    assert first == second
    assert first["session_live"] is False
    by_type = {i["event_type"]: i for i in first["items"]}
    face_item = by_type["FACE_NOT_DETECTED"]  # closed by the server at the session's end
    assert (face_item["status"], face_item["resolution"]) == ("RESOLVED", "session_ended")
    focus_item = by_type["FOCUS_LOST"]
    assert (focus_item["status"], focus_item["ended_at"], focus_item["duration_seconds"]) == (
        "NO_END_RECORDED",
        None,
        None,
    )
    assert "No end was recorded" in focus_item["explanation"]


def test_an_item_detail_shows_its_episode_and_source_events(client, db, helpers: Helpers, active):
    seed_mixed(db, active)
    first = get(client, helpers, LIST.format(active["attempt"]["id"]))["items"][0]
    body = get(client, helpers, ITEM.format(active["attempt"]["id"], first["evidence_id"]))

    assert body["item"] == first
    assert body["episode"]["episode_id"] == first["episode_id"]
    assert [e["event_id"] for e in body["source_events"]] == first["source_event_ids"]
    assert [e["details"]["phase"] for e in body["source_events"]] == ["started", "resolved"]
    assert all(e["source"] in {"CLIENT", "SERVER"} for e in body["source_events"])


def test_the_response_carries_no_pii_and_no_verdict(client, db, helpers: Helpers, active):
    seed_mixed(db, active)
    text = str(get(client, helpers, LIST.format(active["attempt"]["id"]))).lower()
    for leaked in ("candidate@test.local", "roll_number", "password", "token", "email"):
        assert leaked not in text
    for verdict in ("cheated", "guilty", "fraud", "verdict", "rejected"):
        assert verdict not in text


# -- isolation and authorization ------------------------------------------------------------------------


def test_evidence_ids_only_resolve_within_their_own_attempt(client, db, helpers: Helpers, users, active):
    seed_mixed(db, active)
    item_a = get(client, helpers, LIST.format(active["attempt"]["id"]))["items"][0]["evidence_id"]
    # A second candidate's active attempt on the same exam.
    other_headers = intruder(client, helpers, active["exam"])
    attempt_b = start(client, other_headers, active["exam"]["id"])
    activate(client, other_headers, attempt_b["id"])

    get(client, helpers, ITEM.format(attempt_b["id"], item_a), expect=404)  # A's evidence under B
    get(client, helpers, ITEM.format(active["attempt"]["id"], item_a))  # still fine under A


def test_unknown_evidence_attempts_and_unproctored_attempts_are_not_found(
    client, helpers: Helpers, users, active
):
    get(client, helpers, ITEM.format(active["attempt"]["id"], uuid.uuid4()), expect=404)
    get(client, helpers, LIST.format(uuid.uuid4()), expect=404)
    exam = unproctored_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    get(client, helpers, LIST.format(attempt["id"]), expect=404)


@pytest.mark.parametrize("bad", ["not-a-uuid", "123", "' OR 1=1 --"])
def test_malformed_ids_are_rejected(client, helpers: Helpers, active, bad):
    get(client, helpers, LIST.format(bad), expect=422)
    get(client, helpers, ITEM.format(active["attempt"]["id"], bad), expect=422)


def test_candidates_cannot_read_evidence(client, db, helpers: Helpers, active):
    seed_mixed(db, active)
    attempt_id = active["attempt"]["id"]
    item = get(client, helpers, LIST.format(attempt_id))["items"][0]["evidence_id"]
    other = intruder(client, helpers, active["exam"])
    for headers in (active["headers"], other):  # their own attempt, and someone else's
        assert client.get(LIST.format(attempt_id), headers=headers).status_code == 403
        assert client.get(ITEM.format(attempt_id, item), headers=headers).status_code == 403
    assert client.get(LIST.format(attempt_id)).status_code == 401
    assert client.get(ITEM.format(attempt_id, item)).status_code == 401


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_evidence_cannot_be_created_or_modified(client, db, helpers: Helpers, active, method):
    seed_mixed(db, active)
    item = get(client, helpers, LIST.format(active["attempt"]["id"]))["items"][0]["evidence_id"]
    payload = {"status": "RESOLVED", "points": 0, "explanation": "edited"}
    for headers in (admin_headers(helpers), active["headers"]):
        for url in (LIST.format(active["attempt"]["id"]), ITEM.format(active["attempt"]["id"], item)):
            assert client.request(method, url, headers=headers, json=payload).status_code == 405


def test_events_cannot_smuggle_evidence_fields(client, active):
    for forged in (
        {"evidence_id": str(uuid.uuid4())},
        {"episode_id": "x", "points": 99},
        {"explanation": "x"},
    ):
        post_event(
            client,
            active["headers"],
            active["attempt"]["id"],
            {"event_type": "PASTE_ATTEMPT", "metadata": {"shortcut": "CTRL+V", **forged}},
            expect=422,
        )


def test_candidate_endpoints_never_expose_evidence(client, db, active):
    seed_mixed(db, active)
    attempt_id = active["attempt"]["id"]
    for path in (f"{ME}/attempts/{attempt_id}", f"{ME}/attempts/{attempt_id}/proctoring"):
        text = str(client.get(path, headers=active["headers"]).json()).lower()
        assert "evidence" not in text and "episode" not in text


# -- pagination and cost ------------------------------------------------------------------------------


def seed_many(db, active, n: int) -> None:
    add_rows(db, active, [(E.PASTE_ATTEMPT, 1000 - i, {"shortcut": "CTRL+V"}) for i in range(n)])


def test_pages_are_bounded_and_complete(client, db, helpers: Helpers, active):
    seed_many(db, active, 130)
    url = LIST.format(active["attempt"]["id"])
    seen, cursor = [], None
    while True:
        body = get(client, helpers, url, limit=50, **({"cursor": cursor} if cursor else {}))
        assert len(body["items"]) <= 50 and body["total"] == 130
        seen += [i["evidence_id"] for i in body["items"]]
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 130


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 201}, {"cursor": "garbage!!"}, {"cursor": "x" * 300}]
)
def test_invalid_paging_is_rejected(client, db, helpers: Helpers, active, params):
    seed_many(db, active, 3)
    get(client, helpers, LIST.format(active["attempt"]["id"]), expect=422, **params)


def test_time_range_selects_by_start(client, db, helpers: Helpers, active):
    seed_many(db, active, 60)  # one paste per second, 1000 s … 941 s ago
    now = utcnow()
    body = get(
        client,
        helpers,
        LIST.format(active["attempt"]["id"]),
        since=(now - timedelta(seconds=980)).isoformat(),
        until=(now - timedelta(seconds=960)).isoformat(),
    )
    assert 18 <= body["total"] <= 21  # ~20 items, allowing for the seconds that pass during the test


def test_query_count_does_not_grow_with_events(client, db, helpers: Helpers, active):
    headers = admin_headers(helpers)
    url = LIST.format(active["attempt"]["id"])
    statements, stop = count_queries(db)
    client.get(url, headers=headers)
    few = len(statements)
    seed_many(db, active, 300)
    statements.clear()
    client.get(url, headers=headers)
    stop()
    assert len(statements) == few


def test_each_read_is_logged_with_ids_only(client, db, helpers: Helpers, active, caplog):
    seed_mixed(db, active)
    headers = admin_headers(helpers)
    with caplog.at_level(logging.INFO, logger="assessx.evidence"):
        client.get(LIST.format(active["attempt"]["id"]), headers=headers)
    [record] = [r for r in caplog.records if r.name == "assessx.evidence"]
    assert record.getMessage() == "Evidence read"
    assert record.attempt_id == active["attempt"]["id"] and record.items == 4
    assert headers["Authorization"].split()[1] not in str(record.__dict__)

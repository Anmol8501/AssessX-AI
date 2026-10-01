"""Phase 6A: the admin risk endpoint — authorization, explainability, determinism and cost.

What is asserted: only administrators can read an attempt's risk (candidates 403, anonymous 401,
unknown/unproctored attempts 404, malformed ids 422); nothing can write it; the server computes it
from stored events with its own clock (a client's duration or timestamp changes nothing); a finished
attempt's risk is fixed at its end and identical on every request; the response explains itself and
carries no candidate PII and no verdict; and the cost is one bounded query, not one per event.
"""

import time
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import event

from app.models.base import utcnow
from app.models.proctoring_event import ProctoringEvent, ProctoringEventSource, ProctoringEventType
from app.services.proctoring_events import CATEGORY
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, intruder, proctored_exam, session_row, unproctored_exam
from tests.test_proctoring_events import post_event

RISK = "/api/v1/admin/attempts/{}/risk"
E = ProctoringEventType


@pytest.fixture
def active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers}


def risk(client, helpers: Helpers, attempt_id: str, expect: int = 200) -> dict:
    response = client.get(RISK.format(attempt_id), headers=admin_headers(helpers))
    assert response.status_code == expect, response.text
    return response.json()


def report(client, active, event_type: str, **metadata) -> None:
    post_event(
        client, active["headers"], active["attempt"]["id"], {"event_type": event_type, "metadata": metadata}
    )


def add_rows(db, active, rows: list[tuple[E, float, dict]]) -> None:
    """Insert stored events directly, at chosen server times (seconds before now)."""
    session = session_row(db, active["attempt"])
    now = utcnow()
    for kind, seconds_ago, details in rows:
        db.add(
            ProctoringEvent(
                session=session,
                event_type=kind,
                category=CATEGORY[kind],
                source=ProctoringEventSource.CLIENT,
                details=details,
                recorded_at=now - timedelta(seconds=seconds_ago),
            )
        )
    db.flush()


# -- what an administrator sees -------------------------------------------------------------------


def test_an_admin_sees_an_explained_risk_state(client, db, helpers: Helpers, active):
    eid = str(uuid.uuid4())
    add_rows(
        db,
        active,
        [
            (E.FACE_NOT_DETECTED, 40, {"phase": "started", "episode_id": eid}),
            (
                E.FACE_NOT_DETECTED,
                30,
                {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"},
            ),
            (E.FOCUS_LOST, 28, {"reason": "deactivated"}),
            (E.FOCUS_REGAINED, 20, {"duration_ms": 8000}),
        ],
    )
    report(client, active, "PASTE_ATTEMPT", shortcut="CTRL+V", blocked=True, channel="keyboard")

    body = risk(client, helpers, active["attempt"]["id"])
    assert body["attempt_id"] == active["attempt"]["id"]
    assert body["policy_version"] == "6A-v1"
    assert body["level"] in {"NORMAL", "LOW", "MEDIUM", "HIGH"}
    assert body["current_score"] > 0 and body["peak_score"] >= body["current_score"]
    kinds = {c["event_type"]: c for c in body["contributors"]}
    assert set(kinds) == {"FACE_NOT_DETECTED", "FOCUS_LOST", "PASTE_ATTEMPT"}
    assert kinds["FACE_NOT_DETECTED"]["total_seconds"] == pytest.approx(10, abs=0.5)
    assert all(c["reason"] for c in body["contributors"])
    assert body["correlated_window_count"] == 1  # face (AI) and focus (window) within 30 s
    assert "not a determination that the candidate cheated" in body["interpretation"]
    assert {"event_type": "SESSION_STARTED", "count": 1, "reason": "Session lifecycle."} in body["excluded"]


def test_an_attempt_without_signals_is_normal(client, helpers: Helpers, active):
    body = risk(client, helpers, active["attempt"]["id"])
    assert (body["current_score"], body["level"], body["peak_score"], body["contributors"]) == (
        0,
        "NORMAL",
        0,
        [],
    )


def test_the_response_carries_no_pii_and_no_verdict(client, helpers: Helpers, active):
    text = str(risk(client, helpers, active["attempt"]["id"])).lower()
    for leaked in ("candidate@test.local", "roll_number", "password", "token", "email"):
        assert leaked not in text
    for verdict in ('cheated":', "cheating_score", "verdict", 'rejected":', "probability"):
        assert verdict not in text


# -- authorization (BOLA / IDOR) ----------------------------------------------------------------------


def test_a_candidate_cannot_read_any_risk_including_their_own(client, helpers: Helpers, active):
    url = RISK.format(active["attempt"]["id"])
    assert client.get(url, headers=active["headers"]).status_code == 403


def test_another_candidate_cannot_read_it(client, helpers: Helpers, active):
    other = intruder(client, helpers, active["exam"])
    assert client.get(RISK.format(active["attempt"]["id"]), headers=other).status_code == 403


def test_anonymous_requests_are_refused(client, active):
    assert client.get(RISK.format(active["attempt"]["id"])).status_code == 401


def test_unknown_and_unproctored_attempts_are_not_found(client, helpers: Helpers, users):
    risk(client, helpers, str(uuid.uuid4()), expect=404)
    exam = unproctored_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    risk(client, helpers, attempt["id"], expect=404)


@pytest.mark.parametrize("bad", ["not-a-uuid", "123", "' OR 1=1 --"])
def test_malformed_attempt_ids_are_rejected(client, helpers: Helpers, users, bad):
    assert client.get(RISK.format(bad), headers=admin_headers(helpers)).status_code == 422


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_risk_cannot_be_written_by_anyone(client, helpers: Helpers, active, method):
    url = RISK.format(active["attempt"]["id"])
    for headers in (admin_headers(helpers), active["headers"]):
        response = client.request(method, url, headers=headers, json={"current_score": 0, "level": "NORMAL"})
        assert response.status_code == 405


def test_candidate_endpoints_never_expose_risk(client, active):
    attempt_id = active["attempt"]["id"]
    for path in (f"{ME}/attempts/{attempt_id}", f"{ME}/attempts/{attempt_id}/proctoring"):
        body = client.get(path, headers=active["headers"]).json()
        assert "risk" not in str(body).lower()


def test_a_client_cannot_inject_risk_through_events(client, helpers: Helpers, active):
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "PASTE_ATTEMPT", "metadata": {"shortcut": "CTRL+V", "risk_score": 0}},
        expect=422,
    )
    for server_only in ("SESSION_ENDED", "CAMERA_DISCONNECTED"):
        post_event(
            client,
            active["headers"],
            active["attempt"]["id"],
            {"event_type": server_only, "metadata": {}},
            expect=422,
        )
    assert risk(client, helpers, active["attempt"]["id"])["contributors"] == []


# -- server authority and determinism ------------------------------------------------------------------


def test_the_clients_duration_and_timestamps_are_not_trusted(client, helpers: Helpers, active):
    long_ago = (utcnow() - timedelta(hours=3)).isoformat()
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "FOCUS_LOST", "metadata": {"reason": "deactivated"}},
        client_reported_at=long_ago,
    )
    report(client, active, "FOCUS_REGAINED", duration_ms=3_600_000)  # the client claims one hour
    focus = next(
        c
        for c in risk(client, helpers, active["attempt"]["id"])["contributors"]
        if c["event_type"] == "FOCUS_LOST"
    )
    assert focus["total_seconds"] < 5  # the server's own clock: seconds, not an hour


def test_a_finished_attempts_risk_is_fixed_at_its_end_and_repeatable(client, db, helpers: Helpers, active):
    eid = str(uuid.uuid4())
    add_rows(
        db,
        active,
        [(E.MULTIPLE_FACES_DETECTED, 30, {"phase": "started", "episode_id": eid, "face_count": 2})],
    )
    submit(client, active["headers"], active["attempt"]["id"])
    ended_at = session_row(db, active["attempt"]).ended_at

    results = [risk(client, helpers, active["attempt"]["id"]) for _ in range(3)]
    for body in results:
        body.pop("calculated_at")
    assert results[0] == results[1] == results[2]
    assert results[0]["as_of"].replace("Z", "+00:00") == ended_at.isoformat()
    faces = results[0]["contributors"][0]
    assert faces["event_type"] == "MULTIPLE_FACES_DETECTED"  # closed as session_ended by the server


# -- cost -------------------------------------------------------------------------------------------


def count_queries(db):
    statements: list[str] = []

    def before(conn, cursor, statement, *args):
        statements.append(statement)

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", before)
    return statements, lambda: event.remove(engine, "before_cursor_execute", before)


def test_query_count_does_not_grow_with_the_number_of_events(client, db, helpers: Helpers, active):
    headers = admin_headers(helpers)  # sign-in happens before counting
    url = RISK.format(active["attempt"]["id"])
    statements, stop = count_queries(db)
    client.get(url, headers=headers)
    few = len(statements)
    add_rows(db, active, [(E.PASTE_ATTEMPT, 500 - i, {"shortcut": "CTRL+V"}) for i in range(300)])
    statements.clear()
    client.get(url, headers=headers)
    stop()
    assert len(statements) == few  # no N+1: one events query, whatever the count


def test_a_full_session_is_evaluated_quickly(client, db, helpers: Helpers, active):
    rows = []
    for i in range(1250):  # 5000 rows — the per-session ceiling
        eid = str(uuid.uuid4())
        rows += [
            (E.HEAD_ORIENTATION_CHANGED, 5000 - i * 4, {"phase": "started", "episode_id": eid}),
            (
                E.HEAD_ORIENTATION_CHANGED,
                4999 - i * 4,
                {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"},
            ),
            (E.FOCUS_LOST, 4998 - i * 4, {"reason": "deactivated"}),
            (E.FOCUS_REGAINED, 4997 - i * 4, {"duration_ms": 1000}),
        ]
    add_rows(db, active, rows)
    headers = admin_headers(helpers)
    started = time.perf_counter()
    body = risk(client, helpers, active["attempt"]["id"])
    elapsed = time.perf_counter() - started
    assert body["signal_count"] == 2500
    assert elapsed < 5.0, f"risk for a full session took {elapsed:.2f}s"
    del headers

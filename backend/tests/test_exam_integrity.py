"""Exam integrity (2026-10-05): where focus went, closing attempts, framing, and proctor messages.

What is asserted:
* a departure to another application or desktop (`left_to` app/desktop) counts as a tab switch however
  short it was; a short one to Windows' own surfaces (`system`) or an unclassified one keeps the grace;
* the app's refused attempt to close AssessX is recorded as a fact (EXAM_CLOSE_ATTEMPT) and only with
  its own field;
* the framing observation (UPPER_BODY_NOT_VISIBLE) is an AI episode with its measurement, bounded;
* a proctor can send a running exam a short message, which reaches the candidate with the attempt's
  control state until they acknowledge it; the proctor sees who sent it and when it was read; it is
  audited by length only; candidates cannot send messages or acknowledge anyone else's; a finished exam
  takes no messages.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditAction, AuditLog
from app.services.risk import policy
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import start
from tests.test_exam_session import session, submit
from tests.test_proctoring import activate, intruder, proctored_exam
from tests.test_proctoring_events import post_event

ADMIN = "/api/v1/admin/attempts"
ME = "/api/v1/candidates/me"


@pytest.fixture
def active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers, "admin": admin_headers(helpers)}


def event(client, active, event_type: str, metadata: dict, expect: int = 201):
    return post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": event_type, "metadata": metadata},
        expect=expect,
    )


def switches(client, active) -> int:
    return session(client, active["headers"], active["attempt"]["id"])["control"]["tab_switches"]


def message(client, active, body: str, expect: int = 200, headers=None):
    response = client.post(
        f"{ADMIN}/{active['attempt']['id']}/messages", json={"body": body}, headers=headers or active["admin"]
    )
    assert response.status_code == expect, response.text
    return response.json()


# -- where focus went ------------------------------------------------------------------------------------


def test_a_brief_switch_to_another_app_or_desktop_counts(client, active):
    event(client, active, "FOCUS_LOST", {"reason": "deactivated", "left_to": "app"})
    event(client, active, "FOCUS_REGAINED", {"duration_ms": 300, "left_to": "app"})
    assert switches(client, active) == 1
    event(client, active, "FOCUS_REGAINED", {"duration_ms": 150, "left_to": "desktop"})
    assert switches(client, active) == 2


def test_a_brief_system_popup_or_an_unclassified_return_keeps_the_grace(client, active):
    event(client, active, "FOCUS_REGAINED", {"duration_ms": 900, "left_to": "system"})
    event(client, active, "FOCUS_REGAINED", {"duration_ms": 800})
    assert switches(client, active) == 0
    event(client, active, "FOCUS_REGAINED", {"duration_ms": 5000, "left_to": "system"})  # long: counts
    assert switches(client, active) == 1


def test_left_to_accepts_only_known_targets(client, active):
    event(client, active, "FOCUS_REGAINED", {"duration_ms": 300, "left_to": "chrome.exe"}, expect=422)


# -- closing AssessX during the exam ---------------------------------------------------------------------


def test_a_refused_close_is_recorded_as_a_fact(client, active):
    recorded = event(client, active, "EXAM_CLOSE_ATTEMPT", {"blocked": True})
    assert recorded["category"] == "WINDOW" and recorded["metadata"] == {"blocked": True}
    event(client, active, "EXAM_CLOSE_ATTEMPT", {"blocked": True, "window_title": "x"}, expect=422)
    assert switches(client, active) == 0  # not a tab switch


# -- framing: head and chest in view --------------------------------------------------------------------


def test_framing_is_an_ai_episode_with_its_measurement(client, active):
    eid = str(uuid.uuid4())
    started = event(
        client,
        active,
        "UPPER_BODY_NOT_VISIBLE",
        {
            "phase": "started",
            "episode_id": eid,
            "detector": "framing",
            "shoulders_visible": 0,
            "face_cut_off": True,
        },
    )
    assert started["category"] == "AI_OBSERVATION"
    event(
        client,
        active,
        "UPPER_BODY_NOT_VISIBLE",
        {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"},
    )
    bad = {"phase": "started", "episode_id": str(uuid.uuid4()), "shoulders_visible": 3}
    event(client, active, "UPPER_BODY_NOT_VISIBLE", bad, expect=422)


def test_new_event_types_are_recorded_but_not_scored():
    from app.models.proctoring_event import ProctoringEventType as E

    for kind in (E.UPPER_BODY_NOT_VISIBLE, E.EXAM_CLOSE_ATTEMPT):
        assert kind in policy.EXCLUDED and kind not in policy.RULES


# -- proctor messages ------------------------------------------------------------------------------------


def test_a_message_reaches_the_candidate_until_acknowledged(client, db, active):
    sent = message(client, active, "  Please keep your phone off the desk.  ")
    [row] = sent["sent_messages"]
    assert row["body"] == "Please keep your phone off the desk." and row["acknowledged_at"] is None
    assert row["sent_by"]["name"]

    control = session(client, active["headers"], active["attempt"]["id"])["control"]
    [shown] = control["messages"]
    assert shown == {"id": row["id"], "body": row["body"], "sent_at": shown["sent_at"]}
    assert set(shown) == {"id", "body", "sent_at"}  # no sender, no admin fields for the candidate

    acknowledged = client.post(
        f"{ME}/attempts/{active['attempt']['id']}/messages/{row['id']}/acknowledge", headers=active["headers"]
    )
    assert acknowledged.status_code == 200 and acknowledged.json()["messages"] == []
    again = client.post(
        f"{ME}/attempts/{active['attempt']['id']}/messages/{row['id']}/acknowledge", headers=active["headers"]
    )
    assert again.status_code == 200  # idempotent

    admin_view = client.get(f"{ADMIN}/{active['attempt']['id']}/control", headers=active["admin"]).json()
    assert admin_view["sent_messages"][0]["acknowledged_at"] is not None

    [audited] = db.scalars(select(AuditLog).where(AuditLog.action == AuditAction.ATTEMPT_MESSAGE_SENT)).all()
    assert audited.details["length"] == len(row["body"])
    assert "phone" not in str(audited.details)  # never the text


def test_messages_are_bounded_and_only_for_running_exams(client, active):
    message(client, active, "", expect=422)
    message(client, active, "x" * 301, expect=422)
    message(client, active, "x" * 300)
    submit(client, active["headers"], active["attempt"]["id"])
    assert message(client, active, "Too late", expect=409)["error"]["code"] == "attempt_locked"


def test_only_admins_send_and_only_the_owner_acknowledges(client, helpers, active):
    message(client, active, "Hello", expect=403, headers=active["headers"])
    sent = message(client, active, "Look at the screen, please.")
    message_id = sent["sent_messages"][0]["id"]
    other = intruder(client, helpers, active["exam"])
    response = client.post(
        f"{ME}/attempts/{active['attempt']['id']}/messages/{message_id}/acknowledge", headers=other
    )
    assert response.status_code == 404
    wrong = client.post(
        f"{ME}/attempts/{active['attempt']['id']}/messages/{uuid.uuid4()}/acknowledge",
        headers=active["headers"],
    )
    assert wrong.status_code == 404
    response = client.post(f"{ADMIN}/{active['attempt']['id']}/messages", json={"body": "hi"})
    assert response.status_code == 401

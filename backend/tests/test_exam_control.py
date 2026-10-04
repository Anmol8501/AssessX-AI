"""Exam control: the tab-switch rule, and holding (freezing), releasing and ending an attempt.

What is asserted: a return to the exam window counts as a tab switch only after more than 2 s away;
the first two are warnings and the third puts the attempt on hold automatically; while on hold the
candidate can neither save nor submit, the clock keeps running, and further switches are not counted;
an administrator can hold an attempt (with a private note the candidate never sees), release it (the
count is kept, so the next switch holds it again), or end it, which submits and grades the answers
saved so far; time running out while held ends the attempt as usual; the state reaches the candidate
with the attempt and its clock and the wall with each tile; only administrators can control attempts;
every hold, release and end is audited, never with the note's text.
"""

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditAction, AuditLog
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, question_of, save, start
from tests.test_exam_session import session, submit, wind_clock_past_deadline
from tests.test_proctoring import activate, proctored_exam
from tests.test_proctoring_events import post_event

ADMIN = "/api/v1/admin/attempts"


@pytest.fixture
def active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {
        "attempt": attempt,
        "headers": headers,
        "admin": admin_headers(helpers),
        "candidate_id": users["candidate"].id,
    }


def away(client, active, ms: int) -> None:
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "FOCUS_REGAINED", "metadata": {"duration_ms": ms}},
    )


def control(client, active) -> dict:
    return session(client, active["headers"], active["attempt"]["id"])["control"]


def answer(client, active, expect: int = 200):
    mcq = question_of(active["attempt"], "MCQ")
    return save(
        client, active["headers"], active["attempt"]["id"], mcq["id"], [mcq["options"][0]["id"]], expect
    )


def admin_call(client, active, action: str, expect: int = 200, body: dict | None = None, headers=None):
    response = client.post(
        f"{ADMIN}/{active['attempt']['id']}/{action}", json=body or {}, headers=headers or active["admin"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def audit(db) -> list[AuditLog]:
    return list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.action.in_([a for a in AuditAction if a.value.startswith("ATTEMPT_")]))
            .order_by(AuditLog.occurred_at)
        )
    )


# -- the tab-switch rule -----------------------------------------------------------------------------


def test_short_absences_are_not_tab_switches(client, active):
    away(client, active, 400)
    away(client, active, 2000)  # exactly the grace period: not a switch
    state = control(client, active)
    assert state == {
        "tab_switches": 0,
        "tab_switch_limit": 3,
        "on_hold": False,
        "hold_reason": None,
        "held_at": None,
        "ended_by_admin": False,
    }


def test_two_warnings_then_the_third_switch_holds_the_exam(client, db, active):
    away(client, active, 5000)
    assert control(client, active)["tab_switches"] == 1
    away(client, active, 3000)
    assert control(client, active) | {"held_at": None} == {
        "tab_switches": 2,
        "tab_switch_limit": 3,
        "on_hold": False,
        "hold_reason": None,
        "held_at": None,
        "ended_by_admin": False,
    }
    answer(client, active)  # still answering after two warnings

    away(client, active, 2500)
    state = control(client, active)
    assert (
        state["on_hold"] is True and state["hold_reason"] == "TAB_SWITCH_LIMIT" and state["tab_switches"] == 3
    )

    error = answer(client, active, expect=409)
    assert error["error"]["code"] == "attempt_on_hold"
    assert (
        submit(client, active["headers"], active["attempt"]["id"], expect=409)["error"]["code"]
        == "attempt_on_hold"
    )
    away(client, active, 9000)  # events are still recorded, but nothing more is counted while held
    assert control(client, active)["tab_switches"] == 3
    detail = client.get(f"{ME}/attempts/{active['attempt']['id']}", headers=active["headers"]).json()
    assert detail["status"] == "IN_PROGRESS" and detail["control"]["on_hold"] is True  # frozen, not finished

    [held] = audit(db)
    assert held.action.value == "ATTEMPT_HELD" and held.details["trigger"] == "AUTOMATIC"
    assert held.details["tab_switches"] == 3 and held.actor_id == active["candidate_id"]


# -- the administrator's controls ---------------------------------------------------------------------


def test_an_admin_holds_releases_and_the_count_is_kept(client, db, active):
    secret = "Second person visible behind the candidate."
    away(client, active, 4000)
    held = admin_call(client, active, "hold", body={"note": secret})
    assert held["on_hold"] is True and held["hold_reason"] == "ADMIN" and held["hold_note"] == secret
    assert held["held_by"]["name"]
    assert admin_call(client, active, "hold")["on_hold"] is True  # holding twice changes nothing

    state = control(client, active)
    assert state["on_hold"] is True and state["hold_reason"] == "ADMIN"
    assert secret not in str(
        client.get(f"{ME}/attempts/{active['attempt']['id']}", headers=active["headers"]).json()
    )
    answer(client, active, expect=409)

    released = admin_call(client, active, "release")
    assert released["on_hold"] is False and released["tab_switches"] == 1 and released["hold_note"] is None
    assert admin_call(client, active, "release")["on_hold"] is False  # releasing twice changes nothing
    answer(client, active)

    assert [a.action.value for a in audit(db)] == ["ATTEMPT_HELD", "ATTEMPT_RELEASED"]
    assert audit(db)[0].details["note_length"] == len(secret) and secret not in str(
        [a.details for a in audit(db)]
    )


def test_after_a_release_the_next_switch_holds_again(client, active):
    # Distinct lengths: the server folds an identical report within 1 s, which two real switches
    # (each more than 2 s away) can never be.
    for ms in (3000, 3100, 3200):
        away(client, active, ms)
    assert control(client, active)["on_hold"] is True
    admin_call(client, active, "release")
    answer(client, active)
    away(client, active, 3300)
    state = control(client, active)
    assert state["on_hold"] is True and state["tab_switches"] == 4


def test_an_admin_ends_the_exam_and_the_saved_answers_are_graded(client, db, active):
    answer(client, active)
    admin_call(client, active, "hold")
    ended = admin_call(client, active, "end")
    assert ended["status"] == "SUBMITTED" and ended["ended_by_admin"] is True and ended["ended_by"]["name"]
    assert admin_call(client, active, "end")["status"] == "SUBMITTED"  # idempotent
    result = client.get(f"{ME}/attempts/{active['attempt']['id']}/result", headers=active["headers"])
    assert result.status_code == 200, result.text
    assert admin_call(client, active, "hold", expect=409)["error"]["code"] == "attempt_locked"
    assert admin_call(client, active, "release", expect=409)["error"]["code"] == "attempt_locked"
    assert [a.action.value for a in audit(db)] == ["ATTEMPT_HELD", "ATTEMPT_ENDED_BY_ADMIN"]


def test_time_running_out_while_held_ends_the_exam_as_usual(client, db, active):
    admin_call(client, active, "hold")
    wind_clock_past_deadline(db, active["attempt"])
    assert session(client, active["headers"], active["attempt"]["id"])["status"] == "TIME_EXPIRED"
    assert admin_call(client, active, "release", expect=409)["error"]["code"] == "attempt_locked"


def test_the_wall_shows_tab_switches_and_the_hold(client, active):
    away(client, active, 3000)
    admin_call(client, active, "hold")
    tile = client.get(f"/api/v1/admin/monitoring/sessions/{active['attempt']['id']}", headers=active["admin"])
    assert tile.status_code == 200, tile.text
    body = tile.json()
    assert body["tab_switches"] == 1 and body["on_hold"] is True and body["hold_reason"] == "ADMIN"


# -- access ----------------------------------------------------------------------------------------------


def test_only_administrators_control_attempts(client, active):
    for action in ("hold", "release", "end"):
        admin_call(client, active, action, expect=403, headers=active["headers"])
        response = client.post(f"{ADMIN}/{active['attempt']['id']}/{action}", json={})
        assert response.status_code == 401
    response = client.get(f"{ADMIN}/{active['attempt']['id']}/control", headers=active["headers"])
    assert response.status_code == 403
    missing = client.post(
        f"{ADMIN}/00000000-0000-0000-0000-000000000000/hold", json={}, headers=active["admin"]
    )
    assert missing.status_code == 404
    admin_call(client, active, "hold", expect=422, body={"note": "x" * 501})
    admin_call(client, active, "hold", expect=422, body={"reason": "TAB_SWITCH_LIMIT"})
    assert control(client, active)["on_hold"] is False

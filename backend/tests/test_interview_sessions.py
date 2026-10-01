"""Phase 7A: the candidate's interview session — lifecycle, progression, follow-ups, the clock.

What is asserted: a candidate starts (201) or resumes (200) their single session; the server presents
the questions in plan order, the configured follow-up after its primary within the budget, and
completes when the plan is exhausted; a refresh or reconnect returns the same question and never
advances; an answer must name the current question and is saved once, immutably; a late, replayed or
stale answer is refused and saves nothing; the deadline is the server's (`expires_at` fixed at start,
expiry completes the session as of the deadline, client times are not accepted); ending early leaves
the current question unanswered; answers are stored as written and never evaluated; and every step is
audited with ids and lengths — never the answer's text.
"""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.models.base import utcnow
from app.models.interview import InterviewSession, InterviewSessionItem
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_interview_config import ME, assign, call, published_interview

SESSIONS = f"{ME}/interview-sessions"


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


@pytest.fixture
def candidate(helpers: Helpers, users):
    return candidate_headers(helpers)


@pytest.fixture
def ready(client, admin, users):
    """3 primaries, a follow-up on the first two, budget 1, assigned to the candidate."""
    ctx = published_interview(client, admin, questions=3, follow_ups=(0, 1), max_follow_ups=1)
    assign(client, admin, ctx["id"], users["candidate"].id)
    return ctx


def start(client, headers, interview_id: str, expect: int = 201) -> dict:
    return call(client, "POST", f"{ME}/interviews/{interview_id}/session", headers, expect)


def answer(client, headers, state: dict, text: str = "My answer.", expect: int = 200, item_id=None) -> dict:
    body = {"item_id": item_id or state["current"]["item_id"], "answer_text": text}
    return call(client, "POST", f"{SESSIONS}/{state['session_id']}/answers", headers, expect, body)


def session_row(db, state: dict) -> InterviewSession:
    return db.get(InterviewSession, uuid.UUID(state["session_id"]))


def expire(db, state: dict) -> None:
    row = session_row(db, state)
    row.started_at = utcnow() - timedelta(minutes=40)
    row.expires_at = utcnow() - timedelta(seconds=1)
    db.flush()


# -- listing and starting ---------------------------------------------------------------------------


def test_the_candidate_sees_their_assigned_published_interviews(client, admin, candidate, ready):
    [listed] = call(client, "GET", f"{ME}/interviews", candidate, 200)
    assert listed["interview_id"] == ready["id"] and listed["session_status"] == "NOT_STARTED"
    detail = call(client, "GET", f"{ME}/interviews/{ready['id']}", candidate, 200)
    assert detail["instructions"] == "Answer in your own words." and detail["topics"] == ["Python", "SQL"]


def test_starting_creates_one_server_owned_session_and_presents_question_one(client, candidate, ready):
    before = utcnow()
    state = start(client, candidate, ready["id"])
    assert state["status"] == "ACTIVE" and state["completion_reason"] is None
    assert state["progress"] == {"primary_total": 3, "primary_answered": 0, "follow_ups_answered": 0}
    current = state["current"]
    assert (
        current["kind"] == "PRIMARY" and current["number"] == 1 and current["text"] == "Primary question 1?"
    )
    started = state["started_at"]
    assert started >= before.isoformat()[:19]
    assert 29 * 60 <= state["remaining_seconds"] <= 30 * 60

    resumed = start(client, candidate, ready["id"], expect=200)  # resume, not restart
    assert (
        resumed["session_id"] == state["session_id"] and resumed["current"]["item_id"] == current["item_id"]
    )
    assert resumed["started_at"] == started


def test_a_refresh_or_reconnect_returns_the_same_question_and_never_advances(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    for _ in range(5):
        again = call(client, "GET", f"{SESSIONS}/{state['session_id']}", candidate, 200)
        assert again["current"] == state["current"] and again["progress"] == state["progress"]
    assert db.scalar(select(func.count()).select_from(InterviewSessionItem)) == 1


# -- progression ------------------------------------------------------------------------------------


def test_a_full_interview_in_plan_order_with_a_bounded_follow_up(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    seen = []
    while state["status"] == "ACTIVE":
        seen.append((state["current"]["kind"], state["current"]["number"], state["current"]["text"]))
        state = answer(client, candidate, state, text=f"Answer {len(seen)}.")
    assert seen == [
        ("PRIMARY", 1, "Primary question 1?"),
        ("FOLLOW_UP", 1, "Follow-up to question 1?"),  # the configured follow-up, shares its number
        ("PRIMARY", 2, "Primary question 2?"),  # question 2 has a follow-up, but the budget (1) is spent
        ("PRIMARY", 3, "Primary question 3?"),
    ]
    assert state["completion_reason"] == "ALL_ANSWERED" and state["current"] is None
    assert state["remaining_seconds"] == 0 and state["completed_at"]
    assert state["progress"] == {"primary_total": 3, "primary_answered": 3, "follow_ups_answered": 1}

    items = db.scalars(select(InterviewSessionItem).order_by(InterviewSessionItem.sequence)).all()
    assert [i.answer_text for i in items] == ["Answer 1.", "Answer 2.", "Answer 3.", "Answer 4."]
    assert len({i.question_id for i in items}) == 4  # no question twice
    assert session_row(db, state).follow_ups_used == 1


def test_follow_ups_are_skipped_when_disabled(client, admin, candidate, users):
    ctx = published_interview(
        client,
        admin,
        questions=2,
        follow_ups=(0, 1),
        follow_ups_enabled=False,
        question_count=2,
        max_follow_ups=0,
    )
    assign(client, admin, ctx["id"], users["candidate"].id)
    state = start(client, candidate, ctx["id"])
    kinds = []
    while state["status"] == "ACTIVE":
        kinds.append(state["current"]["kind"])
        state = answer(client, candidate, state)
    assert kinds == ["PRIMARY", "PRIMARY"]


def test_answers_are_stored_as_written_and_never_scored(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    text = "A process has its own address space; threads share one.\n\nThey are scheduled by the OS."
    after = answer(client, candidate, state, text=f"  {text}  ")
    item = db.scalar(select(InterviewSessionItem).where(InterviewSessionItem.answer_text.is_not(None)))
    assert item.answer_text == text  # trimmed at the ends only
    assert not {"score", "evaluation", "correct", "rating"} & set(
        str(after).lower().replace('"', " ").split()
    )


# -- answer rules -----------------------------------------------------------------------------------


def test_an_answer_must_name_the_current_question(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    error = answer(client, candidate, state, item_id=str(uuid.uuid4()), expect=409)
    assert error["error"]["code"] == "stale_question"
    assert error["error"]["details"]["current_item_id"] == state["current"]["item_id"]
    # A question id (not an item id) is refused too — the client cannot pick a question.
    answer(client, candidate, state, item_id=ready["primaries"][2]["id"], expect=409)
    assert (
        db.scalar(
            select(func.count())
            .select_from(InterviewSessionItem)
            .where(InterviewSessionItem.answer_text.is_not(None))
        )
        == 0
    )


def test_a_replayed_answer_is_refused_and_changes_nothing(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    first = answer(client, candidate, state, text="Original answer.")
    replay = answer(client, candidate, state, text="Edited answer.", expect=409)  # same item again
    assert replay["error"]["code"] == "stale_question"
    assert replay["error"]["details"]["current_item_id"] == first["current"]["item_id"]
    answered = db.scalars(
        select(InterviewSessionItem).where(InterviewSessionItem.answer_text.is_not(None))
    ).all()
    assert [i.answer_text for i in answered] == ["Original answer."]  # immutable
    assert (
        call(client, "GET", f"{SESSIONS}/{state['session_id']}", candidate, 200)["current"]
        == first["current"]
    )


@pytest.mark.parametrize(
    "body",
    [
        {"item_id": None, "answer_text": "x"},  # missing item
        {"item_id": "not-a-uuid", "answer_text": "x"},
        {"answer_text": "   "},
        {"answer_text": ""},
        {"answer_text": "x" * 10_001},
        {"answer_text": "x", "status": "COMPLETED"},
        {"answer_text": "x", "question_index": 8},
        {"answer_text": "x", "remaining_seconds": 9999},
        {"answer_text": "x", "score": 100},
        {"answer_text": "x", "candidate_id": str(uuid.uuid4())},
        {"answer_text": "x", "submitted_at": "2020-01-01T00:00:00Z"},
    ],
)
def test_malformed_or_tampered_answers_are_rejected(client, candidate, ready, body):
    state = start(client, candidate, ready["id"])
    payload = {k: v for k, v in {"item_id": state["current"]["item_id"], **body}.items() if v is not None}
    call(client, "POST", f"{SESSIONS}/{state['session_id']}/answers", candidate, 422, payload)
    assert (
        call(client, "GET", f"{SESSIONS}/{state['session_id']}", candidate, 200)["progress"][
            "primary_answered"
        ]
        == 0
    )


def test_the_maximum_answer_length_is_accepted(client, candidate, ready):
    state = start(client, candidate, ready["id"])
    assert answer(client, candidate, state, text="x" * 10_000)["progress"]["primary_answered"] == 1


# -- the clock --------------------------------------------------------------------------------------


def test_the_deadline_is_fixed_at_start_from_the_configured_duration(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    row = session_row(db, state)
    assert row.expires_at - row.started_at == timedelta(minutes=30)
    assert row.has_expired_at(row.expires_at)  # the final instant is not a free tick
    assert not row.has_expired_at(row.expires_at - timedelta(microseconds=1))


def test_an_answer_after_the_deadline_is_refused_and_the_session_ends_at_its_deadline(
    client, db, candidate, ready
):
    state = start(client, candidate, ready["id"])
    expire(db, state)
    error = answer(client, candidate, state, expect=409)
    assert error["error"]["code"] == "interview_completed"
    assert error["error"]["details"]["completion_reason"] == "TIME_EXPIRED"
    row = session_row(db, state)
    assert row.status.value == "COMPLETED" and row.completed_at == row.expires_at  # not "now"
    item = db.scalar(select(InterviewSessionItem))
    assert item.state.value == "PRESENTED" and item.answer_text is None  # nothing invented


def test_reading_the_state_applies_the_clock(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    expire(db, state)
    after = call(client, "GET", f"{SESSIONS}/{state['session_id']}", candidate, 200)
    assert after["status"] == "COMPLETED" and after["completion_reason"] == "TIME_EXPIRED"
    assert after["remaining_seconds"] == 0 and after["current"] is None
    resumed = start(client, candidate, ready["id"], expect=200)  # no restart after expiry
    assert resumed["status"] == "COMPLETED"


def test_client_supplied_times_are_ignored(client, candidate, ready):
    state = start(client, candidate, ready["id"])
    headers = {**candidate, "Date": "Thu, 01 Jan 2099 00:00:00 GMT", "X-Client-Time": "2099-01-01T00:00:00Z"}
    after = answer(client, headers, state)
    assert after["status"] == "ACTIVE" and after["expires_at"] == state["expires_at"]


# -- completion -------------------------------------------------------------------------------------


def test_ending_early_leaves_the_current_question_unanswered_and_is_idempotent(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    state = answer(client, candidate, state)
    ended = call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    assert ended["status"] == "COMPLETED" and ended["completion_reason"] == "ENDED_BY_CANDIDATE"
    again = call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    assert again["completed_at"] == ended["completed_at"]
    assert answer(client, candidate, state, expect=409)["error"]["code"] == "interview_completed"
    answered = db.scalar(
        select(func.count())
        .select_from(InterviewSessionItem)
        .where(InterviewSessionItem.answer_text.is_not(None))
    )
    assert answered == 1


def test_a_completed_interview_cannot_be_restarted(client, candidate, ready):
    state = start(client, candidate, ready["id"])
    call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    again = start(client, candidate, ready["id"], expect=200)
    assert again["session_id"] == state["session_id"] and again["status"] == "COMPLETED"


def test_admin_progress_reflects_the_session_without_answers(client, db, admin, candidate, ready, users):
    state = start(client, candidate, ready["id"])
    answer(client, candidate, state, text="Secret answer text.")
    [row] = call(client, "GET", f"/api/v1/interviews/{ready['id']}/assignments", admin, 200)
    assert row["session_status"] == "ACTIVE" and row["primary_answered"] == 1 and row["primary_total"] == 3
    assert "Secret answer text" not in str(row)
    expire(db, state)
    [row] = call(client, "GET", f"/api/v1/interviews/{ready['id']}/assignments", admin, 200)
    assert row["session_status"] == "COMPLETED" and row["completion_reason"] == "TIME_EXPIRED"
    assert session_row(db, state).status.value == "ACTIVE"  # an admin's read changes nothing


# -- audit ------------------------------------------------------------------------------------------


def test_the_session_is_audited_without_answer_text(client, db, candidate, ready, users):
    state = start(client, candidate, ready["id"])
    secret = "My private reasoning about threads."
    state = answer(client, candidate, state, text=secret)
    call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.interview_session_id == uuid.UUID(state["session_id"]))
        .order_by(AuditLog.occurred_at)
    ).all()
    assert [r.action.value for r in rows] == [
        "INTERVIEW_SESSION_STARTED",
        "INTERVIEW_ANSWER_SUBMITTED",
        "INTERVIEW_SESSION_COMPLETED",
    ]
    assert {r.actor_id for r in rows} == {users["candidate"].id}
    submitted = rows[1].details
    assert (
        submitted["length"] == len(secret) and submitted["kind"] == "PRIMARY" and submitted["sequence"] == 1
    )
    assert secret not in str([r.details for r in rows])
    assert rows[2].details == {"reason": "ENDED_BY_CANDIDATE"}


def test_expiry_is_audited_as_the_servers_clock(client, db, candidate, ready):
    state = start(client, candidate, ready["id"])
    expire(db, state)
    call(client, "GET", f"{SESSIONS}/{state['session_id']}", candidate, 200)
    row = db.scalars(select(AuditLog).where(AuditLog.action == "INTERVIEW_SESSION_COMPLETED")).one()
    assert row.details == {"reason": "TIME_EXPIRED", "ended_by": "server_clock"}

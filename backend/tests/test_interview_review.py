# ruff: noqa: F811 — pytest fixtures are imported from tests.test_interview_adaptive_api
"""Phase 7C: the human review of an interview — lifecycle, authorship, separation, security, audit.

What is asserted: a review starts (idempotently), takes immutable human notes and agree/disagree marks,
and completes only with a human-chosen outcome and rationale, once the interview has ended and no
evaluation is pending; the reviewer and every time are the server's; a stale version, a second
completion or a same-outcome revision is refused, and a revision keeps every earlier decision; the
decision records the report figures it was made on; nothing the AI produces ever sets a review status or
outcome, and nothing a reviewer does changes an AI evaluation, an answer or the session; interview reviews
and proctoring reviews never touch each other; candidates and anonymous callers are refused everywhere;
ids from other interviews or sessions are 404; forged privileged fields and verdict-style outcomes are
422; the audit trail records every action without note text, and the database enforces the states.
"""

import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models.attempt import AssessmentAttempt
from app.models.audit_log import AuditAction, AuditLog
from app.models.interview import InterviewSession, InterviewSessionItem
from app.models.interview_evaluation import InterviewEvaluation
from app.models.interview_review import InterviewReview, InterviewReviewDecision
from app.models.proctoring_event import ProctoringEvent
from app.models.review import AttemptReview
from app.models.user import UserRole
from app.services.users import UserService
from tests.conftest import ADMIN_PASSWORD, Helpers
from tests.test_interview_adaptive_api import (  # noqa: F401 — fixtures
    Stuck,
    admin,
    answer,
    candidate,
    install,
    interview,
    read,
    start,
)
from tests.test_interview_config import BASE, ME, call

SESSIONS = f"{ME}/interview-sessions"
OUTCOMES = ["MEETS_EXPECTATIONS", "NEEDS_FURTHER_ASSESSMENT", "DOES_NOT_MEET_EXPECTATIONS", "INCONCLUSIVE"]


def base(ctx, state) -> str:
    return f"{BASE}/{ctx['id']}/sessions/{state['session_id']}"


def decide(client, headers, url, outcome, version, verb="complete", expect=200, **extra):
    body = {
        "outcome": outcome,
        "rationale": "Read every answer and its evaluation.",
        "expected_version": version,
    }
    return call(client, "POST", f"{url}/review/{verb}", headers, expect, {**body, **extra})


@pytest.fixture
def other_admin(db, helpers: Helpers, users):
    user = UserService(db).create(
        name="Bea Admin",
        email="admin2@test.local",
        password=ADMIN_PASSWORD,
        role=UserRole.ADMIN,
        username="bea",
    )
    db.flush()
    response = helpers.login_admin("admin2@test.local", ADMIN_PASSWORD, username="bea")
    return {"user": user, "headers": helpers.bearer(response.json()["token"])}


@pytest.fixture
def done(client, admin, candidate, users, install):
    """A completed, fully evaluated two-question interview."""
    install()
    ctx = interview(
        client, admin, users, adaptive=False, question_count=2, max_follow_ups=0, follow_ups_enabled=False
    )
    state = start(client, candidate, ctx["id"])
    for text_ in ("[[stub:strong]] First.", "[[stub:weak]] Second."):
        answer(client, candidate, state, text=text_)
        state = read(client, candidate, state)
    assert state["status"] == "COMPLETED"
    return {"ctx": ctx, "state": state, "url": base(ctx, state)}


def audit_actions(db, session_id) -> list[str]:
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.interview_session_id == uuid.UUID(session_id),
            AuditLog.action.in_([a for a in AuditAction if a.value.startswith("INTERVIEW_REVIEW_")]),
        )
        .order_by(AuditLog.occurred_at)
    )
    return [r.action.value for r in rows]


# -- lifecycle -------------------------------------------------------------------------------------------


def test_a_review_is_started_noted_marked_and_completed_by_a_human(client, db, admin, users, done):
    url = done["url"]
    started = call(client, "POST", f"{url}/review", admin, 201)["review"]
    assert started["status"] == "IN_REVIEW" and started["version"] == 1 and started["outcome"] is None
    assert started["started_by"]["id"] == str(users["admin"].id)
    assert call(client, "POST", f"{url}/review", admin, 200)["review"]["version"] == 1  # idempotent

    noted = call(client, "POST", f"{url}/review/notes", admin, 201, {"body": "Relevant to the role's needs."})
    [note] = noted["review"]["notes"]
    assert note["authored_by"] == "HUMAN" and note["author"]["id"] == str(users["admin"].id)

    item = noted["questions"][1]
    marked = call(client, "PUT", f"{url}/review/marks/{item['item_id']}", admin, 200, {"mark": "DISAGREE"})
    question = marked["questions"][1]
    assert question["review_mark"]["mark"] == "DISAGREE" and question["review_mark"]["authored_by"] == "HUMAN"
    assert question["evaluation"]["overall_score"] == 20  # the AI score is untouched by disagreement

    report = decide(client, admin, url, "NEEDS_FURTHER_ASSESSMENT", 1)
    review = report["review"]
    assert (
        review["status"] == "REVIEWED"
        and review["outcome"] == "NEEDS_FURTHER_ASSESSMENT"
        and review["version"] == 2
    )
    assert review["completed_by"]["id"] == str(users["admin"].id)
    [decision] = review["decisions"]
    assert decision["authored_by"] == "HUMAN" and decision["revision"] == 1
    basis = decision["basis"]
    assert basis["ai_score"] == report["summary"]["ai_score"] == 55  # mean(90, 20)
    assert basis["evaluation_state"] == "COMPLETE" and basis["report_policy_version"] == "7C-v1"
    assert basis["rubric_versions"] == ["technical-v1"]
    assert "not an AI decision" in review["note"]
    assert [h["action"] for h in review["history"]] == audit_actions(db, done["state"]["session_id"])


def test_an_outcome_needs_an_ended_interview_and_finished_evaluations(
    client, admin, candidate, users, install
):
    install(runner_cls=Stuck)
    ctx = interview(
        client, admin, users, adaptive=False, question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    state = start(client, candidate, ctx["id"])
    url = base(ctx, state)
    call(client, "POST", f"{url}/review", admin, 201)
    assert (
        decide(client, admin, url, "INCONCLUSIVE", 1, expect=409)["error"]["code"] == "interview_in_progress"
    )
    answer(client, candidate, state)  # pending evaluation (stuck)
    call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    report = call(client, "GET", f"{url}/report", admin, 200)
    assert report["review"]["blocked_reason"] == "EVALUATIONS_PENDING"
    assert decide(client, admin, url, "INCONCLUSIVE", 1, expect=409)["error"]["code"] == "evaluations_pending"


def test_nothing_is_recorded_before_the_review_is_started(client, admin, done):
    url = done["url"]
    item = call(client, "GET", f"{url}/report", admin, 200)["questions"][0]["item_id"]
    for method, path, body in [
        ("POST", "/review/notes", {"body": "x"}),
        ("PUT", f"/review/marks/{item}", {"mark": "AGREE"}),
        ("POST", "/review/complete", {"outcome": "INCONCLUSIVE", "rationale": "x", "expected_version": 1}),
    ]:
        assert call(client, method, url + path, admin, 409, body)["error"]["code"] == "review_not_started"


def test_a_completed_review_changes_only_by_a_revision(client, admin, other_admin, users, done):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    decide(client, admin, url, "MEETS_EXPECTATIONS", 1)
    assert decide(client, admin, url, "INCONCLUSIVE", 2, expect=409)["error"]["code"] == "review_conflict"
    decide(
        client, other_admin["headers"], url, "MEETS_EXPECTATIONS", 2, verb="revise", expect=422
    )  # same outcome
    stale = decide(client, other_admin["headers"], url, "INCONCLUSIVE", 1, verb="revise", expect=409)
    assert stale["error"]["details"]["completed_by"] == users["admin"].name

    revised = decide(client, other_admin["headers"], url, "DOES_NOT_MEET_EXPECTATIONS", 2, verb="revise")[
        "review"
    ]
    assert revised["outcome"] == "DOES_NOT_MEET_EXPECTATIONS" and revised["version"] == 3
    assert [d["outcome"] for d in revised["decisions"]] == [
        "DOES_NOT_MEET_EXPECTATIONS",
        "MEETS_EXPECTATIONS",
    ]
    assert revised["decisions"][1]["decided_by"]["id"] == str(users["admin"].id)  # revision 1 preserved
    assert revised["completed_by"]["id"] == str(other_admin["user"].id)


def test_a_stale_decision_never_overwrites_another_reviewers(client, admin, other_admin, done):
    url = done["url"]
    seen = call(client, "POST", f"{url}/review", admin, 201)["review"]["version"]
    decide(client, admin, url, "MEETS_EXPECTATIONS", seen)
    error = decide(client, other_admin["headers"], url, "DOES_NOT_MEET_EXPECTATIONS", seen, expect=409)
    assert (
        error["error"]["code"] == "review_conflict"
        and error["error"]["details"]["outcome"] == "MEETS_EXPECTATIONS"
    )


def test_marks_need_a_completed_evaluation_of_this_session(client, admin, candidate, users, done, install):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    call(client, "PUT", f"{url}/review/marks/{uuid.uuid4()}", admin, 404, {"mark": "AGREE"})
    call(client, "PUT", f"{url}/review/marks/not-a-uuid", admin, 422, {"mark": "AGREE"})
    item = call(client, "GET", f"{url}/report", admin, 200)["questions"][0]["item_id"]
    call(client, "PUT", f"{url}/review/marks/{item}", admin, 422, {"mark": "HIRE"})
    # An answer from another interview's session is not part of this session.
    other = interview(
        client,
        admin,
        users,
        adaptive=False,
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
        title="O",
    )
    other_state = start(client, candidate, other["id"])
    call(
        client,
        "PUT",
        f"{url}/review/marks/{other_state['current']['item_id']}",
        admin,
        404,
        {"mark": "AGREE"},
    )


# -- AI and human kept apart ---------------------------------------------------------------------------


def test_reviewing_never_changes_ai_evaluations_answers_or_the_session(client, db, admin, done):
    url = done["url"]

    def snapshot():
        return [
            (e.overall_score, e.status.value, tuple(sorted(e.dimension_scores.items())), e.feedback)
            for e in db.scalars(select(InterviewEvaluation).order_by(InterviewEvaluation.requested_at))
        ]

    def answers():
        items = db.scalars(select(InterviewSessionItem).order_by(InterviewSessionItem.sequence))
        return [i.answer_text for i in items]

    before, before_answers = snapshot(), answers()
    session = db.get(InterviewSession, uuid.UUID(done["state"]["session_id"]))
    status_before = (session.status, session.completed_at)
    report = call(client, "POST", f"{url}/review", admin, 201)
    for q in report["questions"]:
        call(client, "PUT", f"{url}/review/marks/{q['item_id']}", admin, 200, {"mark": "DISAGREE"})
    call(client, "POST", f"{url}/review/notes", admin, 201, {"body": "Human note."})
    decide(client, admin, url, "DOES_NOT_MEET_EXPECTATIONS", 1)
    db.expire_all()
    assert snapshot() == before and answers() == before_answers
    session = db.get(InterviewSession, uuid.UUID(done["state"]["session_id"]))
    assert (session.status, session.completed_at) == status_before
    assert "Human note." not in str(snapshot())  # human text never enters the AI record


@pytest.mark.parametrize("score_text", ["[[stub:strong]] Excellent.", "[[stub:weak]] Poor."])
def test_no_ai_score_ever_sets_a_review(client, db, admin, candidate, users, install, score_text):
    install()
    ctx = interview(
        client, admin, users, adaptive=False, question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state, text=score_text)
    state = read(client, candidate, state)
    report = call(client, "GET", f"{base(ctx, state)}/report", admin, 200)
    assert report["summary"]["ai_score"] in (90, 20)
    assert report["review"]["status"] == "UNREVIEWED" and report["review"]["outcome"] is None
    assert db.scalar(select(func.count()).select_from(InterviewReview)) == 0


def test_interview_and_proctoring_reviews_never_touch_each_other(client, db, admin, done):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    decide(client, admin, url, "DOES_NOT_MEET_EXPECTATIONS", 1)
    for model in (AttemptReview, ProctoringEvent, AssessmentAttempt):
        assert db.scalar(select(func.count()).select_from(model)) == 0, model.__name__


# -- security ----------------------------------------------------------------------------------------------


def test_candidates_and_anonymous_callers_are_refused_everywhere(client, admin, candidate, done):
    url = done["url"]
    item = call(client, "GET", f"{url}/report", admin, 200)["questions"][0]["item_id"]
    routes = [
        ("GET", f"{BASE}/reports", None),
        ("GET", f"{url}/report", None),
        ("POST", f"{url}/review", None),
        ("POST", f"{url}/review/notes", {"body": "x"}),
        ("PUT", f"{url}/review/marks/{item}", {"mark": "AGREE"}),
        (
            "POST",
            f"{url}/review/complete",
            {"outcome": "INCONCLUSIVE", "rationale": "x", "expected_version": 1},
        ),
        (
            "POST",
            f"{url}/review/revise",
            {"outcome": "INCONCLUSIVE", "rationale": "x", "expected_version": 1},
        ),
    ]
    for method, path, body in routes:
        call(client, method, path, candidate, 403, body)
        call(client, method, path, None, 401, body)
    assert call(client, "GET", f"{url}/report", admin, 200)["review"]["status"] == "UNREVIEWED"


def test_a_session_is_only_reachable_through_its_own_interview(client, admin, users, done):
    other = interview(
        client,
        admin,
        users,
        adaptive=False,
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
        title="O",
    )
    wrong = f"{BASE}/{other['id']}/sessions/{done['state']['session_id']}"
    for method, path, body in [
        ("GET", "/report", None),
        ("POST", "/review", None),
        ("POST", "/review/notes", {"body": "x"}),
    ]:
        call(client, method, wrong + path, admin, 404, body)
    call(client, "GET", f"{BASE}/{done['ctx']['id']}/sessions/{uuid.uuid4()}/report", admin, 404)


@pytest.mark.parametrize(
    "forged",
    [
        {"reviewer_id": str(uuid.uuid4())},
        {"decided_by_id": str(uuid.uuid4())},
        {"completed_at": "2020-01-01T00:00:00Z"},
        {"status": "REVIEWED"},
        {"ai_score": 100},
        {"candidate_id": str(uuid.uuid4())},
        {"evaluator_version": "trusted"},
        {"organization_id": str(uuid.uuid4())},
    ],
)
def test_privileged_fields_cannot_be_sent(client, db, admin, done, forged):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    decide(client, admin, url, "INCONCLUSIVE", 1, expect=422, **forged)
    call(client, "POST", f"{url}/review/notes", admin, 422, {"body": "x", **forged})
    assert db.scalar(select(InterviewReview)).status.value == "IN_REVIEW"


@pytest.mark.parametrize(
    "body",
    [
        {"outcome": "HIRE", "rationale": "x", "expected_version": 1},
        {"outcome": "REJECT", "rationale": "x", "expected_version": 1},
        {"outcome": "CHEATED", "rationale": "x", "expected_version": 1},
        {
            "outcome": "CLEARED",
            "rationale": "x",
            "expected_version": 1,
        },  # a proctoring outcome, not an interview one
        {"rationale": "x", "expected_version": 1},
        {"outcome": "INCONCLUSIVE", "rationale": "   ", "expected_version": 1},
        {"outcome": "INCONCLUSIVE", "rationale": "x" * 4001, "expected_version": 1},
        {"outcome": "INCONCLUSIVE", "rationale": "x"},
    ],
)
def test_invalid_decisions_are_rejected(client, db, admin, done, body):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    call(client, "POST", f"{url}/review/complete", admin, 422, body)
    assert db.scalar(select(func.count()).select_from(InterviewReviewDecision)) == 0


def test_notes_are_immutable_and_never_logged(client, db, admin, done, caplog):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    secret = "The candidate's example about indexing was strong."
    note = call(client, "POST", f"{url}/review/notes", admin, 201, {"body": secret})["review"]["notes"][0]
    for method in ("PATCH", "PUT", "DELETE"):
        assert client.request(method, f"{url}/review/notes", headers=admin).status_code == 405
        response = client.request(
            method, f"{url}/review/notes/{note['note_id']}", headers=admin, json={"body": "x"}
        )
        assert response.status_code in (404, 405)
    details = str([r.details for r in db.scalars(select(AuditLog))])
    assert secret not in details and secret not in caplog.text


def test_audit_trail_and_database_constraints(client, db, admin, users, done):
    url = done["url"]
    call(client, "POST", f"{url}/review", admin, 201)
    call(client, "POST", f"{url}/review/notes", admin, 201, {"body": "Note."})
    item = call(client, "GET", f"{url}/report", admin, 200)["questions"][0]["item_id"]
    call(client, "PUT", f"{url}/review/marks/{item}", admin, 200, {"mark": "AGREE"})
    decide(client, admin, url, "MEETS_EXPECTATIONS", 1)
    assert audit_actions(db, done["state"]["session_id"]) == [
        "INTERVIEW_REVIEW_STARTED",
        "INTERVIEW_REVIEW_NOTE_ADDED",
        "INTERVIEW_REVIEW_ANSWER_MARKED",
        "INTERVIEW_REVIEW_COMPLETED",
    ]
    review = db.scalar(select(InterviewReview))
    for statement in (
        "UPDATE interview_reviews SET status = 'REVIEWED', outcome = NULL WHERE id = :id",
        "UPDATE interview_reviews SET outcome = 'HIRED' WHERE id = :id",
        "UPDATE interview_reviews SET version = 0 WHERE id = :id",
    ):
        with pytest.raises(IntegrityError), db.begin_nested():
            db.execute(text(statement), {"id": review.id})
    with pytest.raises(Exception, match="append-only"), db.begin_nested():
        db.execute(text("DELETE FROM audit_logs WHERE action = 'INTERVIEW_REVIEW_COMPLETED'"))

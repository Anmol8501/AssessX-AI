"""Phase 7B: AI answer evaluation and the adaptive interview, end to end through the API.

The evaluator is substituted (the runner dependency) with one bound to the test transaction and a
programmable provider — the labelled stub, or fakes. FastAPI's TestClient runs background tasks after
each response, exactly as production does after sending it.

What is asserted: with an evaluator the answer response says "processing" and carries no question, the
evaluation runs on the stored answer, and the next question follows; a strong answer raises the
difficulty one level within bounds and a weak one lowers it; a follow-up is asked when the evaluation
says the answer was weak, not when it was strong; a failed, invalid or late evaluation never becomes a
score and the interview moves on by the fallback (7A) rule; a dead run is re-scheduled and bounded;
running an evaluation twice records it once; candidates never receive scores and cannot send them;
administrators can read evaluations (read-only, no prompt), others cannot; the session clock and
completion are unaffected; nothing reaches Phase 6; and no answer text reaches the audit log.
"""

import uuid
from contextlib import contextmanager
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.api.v1.candidate_interviews import get_evaluation_runner
from app.core.config import get_settings
from app.models.audit_log import AuditLog
from app.models.base import utcnow
from app.models.interview import InterviewSession, InterviewSessionItem
from app.models.interview_evaluation import EvaluationFailure, InterviewEvaluation
from app.models.proctoring_event import ProctoringEvent
from app.models.review import AttemptReview
from app.services.interview.llm import ProviderError, ProviderResult, StubProvider
from app.services.interview.prompts import SYSTEM_PROMPT
from app.services.interview.runner import MAX_RUNS, EvaluationRunner
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_interview_config import BASE, ME, add_follow_up, add_question, assign, call, create

SESSIONS = f"{ME}/interview-sessions"


class Recording:
    """A provider wrapper that records every request (to prove what was evaluated)."""

    def __init__(self, inner) -> None:
        self.inner, self.name, self.model, self.requests = inner, inner.name, inner.model, []

    def evaluate(self, request):
        self.requests.append(request)
        return self.inner.evaluate(request)


class Failing:
    name, model = "fake", "fake-model"

    def __init__(self, failure=EvaluationFailure.PROVIDER_ERROR, retryable=False) -> None:
        self.failure, self.retryable, self.calls = failure, retryable, 0

    def evaluate(self, request):
        self.calls += 1
        raise ProviderError(self.failure, self.retryable)


class Stuck(EvaluationRunner):
    """A runner whose background work never happens (a crashed or restarted process)."""

    scheduled: list[uuid.UUID]

    def run(self, evaluation_id):
        self.scheduled.append(evaluation_id)


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


@pytest.fixture
def candidate(helpers: Helpers, users):
    return candidate_headers(helpers)


@pytest.fixture
def install(client, db):
    """Installs an evaluator for the API; returns the runner."""

    @contextmanager
    def scope():
        yield db
        db.flush()

    settings = get_settings().model_copy(update={"llm_max_retries": 1, "evaluation_wait_seconds": 25})

    def make(provider=None, runner_cls=EvaluationRunner):
        runner = runner_cls(scope, provider or StubProvider(), settings, sleep=lambda _: None)
        if isinstance(runner, Stuck):
            runner.scheduled = []
        client.app.dependency_overrides[get_evaluation_runner] = lambda: runner
        return runner

    return make


def interview(client, admin, users, *, adaptive=True, follow_up_on=(), question_count=3, **config) -> dict:
    """Two primaries per level (EASY, MEDIUM, HARD), in that authored order; optional follow-ups."""
    body = {
        "question_count": question_count,
        "max_follow_ups": 2,
        "difficulty": "HARD",
        "adaptive_difficulty": adaptive,
        "min_difficulty": "EASY",
        "starting_difficulty": "MEDIUM",
        **config,
    }
    created = create(client, admin, **body)
    questions = {}
    for level in ("EASY", "MEDIUM", "HARD"):
        for n in (1, 2):
            q = add_question(client, admin, created["id"], difficulty=level, text=f"{level} question {n}?")
            questions[f"{level}{n}"] = q
    for key in follow_up_on:
        add_follow_up(client, admin, created["id"], questions[key]["id"], text=f"Follow-up to {key}?")
    call(client, "POST", f"{BASE}/{created['id']}/publish", admin, 200)
    assign(client, admin, created["id"], users["candidate"].id)
    return {"id": created["id"], "questions": questions}


def start(client, headers, interview_id) -> dict:
    return call(client, "POST", f"{ME}/interviews/{interview_id}/session", headers, 201)


def answer(client, headers, state, text="A reasonable answer.", expect=200) -> dict:
    body = {"item_id": state["current"]["item_id"], "answer_text": text}
    return call(client, "POST", f"{SESSIONS}/{state['session_id']}/answers", headers, expect, body)


def read(client, headers, state) -> dict:
    return call(client, "GET", f"{SESSIONS}/{state['session_id']}", headers, 200)


def evaluations(db) -> list[InterviewEvaluation]:
    return list(db.scalars(select(InterviewEvaluation).order_by(InterviewEvaluation.requested_at)))


def audit(db, action: str) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.occurred_at)))


# -- processing and evaluation ----------------------------------------------------------------------


def test_an_answer_is_processed_then_the_next_question_follows(client, db, admin, candidate, users, install):
    provider = install(Recording(StubProvider())).provider
    ctx = interview(client, admin, users, adaptive=False)
    state = start(client, candidate, ctx["id"])
    after = answer(client, candidate, state, text="  A reasonable answer about Python.  ")
    assert after["processing"] is True and after["current"] is None and after["status"] == "ACTIVE"

    nxt = read(client, candidate, state)  # the evaluation ran after the response
    assert nxt["processing"] is False and nxt["current"]["number"] == 2
    [evaluation] = evaluations(db)
    assert evaluation.status.value == "COMPLETED" and evaluation.overall_score == 60
    assert (evaluation.provider, evaluation.model, evaluation.evaluator_version) == ("stub", "stub", "7B-v1")
    assert (evaluation.rubric_version, evaluation.prompt_version) == ("technical-v1", "7b-prompt-v1")
    # What was evaluated is the stored answer — never text from anywhere else.
    item = db.get(InterviewSessionItem, evaluation.item_id)
    assert provider.requests[0].answer == item.answer_text == "A reasonable answer about Python."
    for body in (after, nxt):
        text = str(body).lower()
        assert not any(
            w in text for w in ("overall_score", "feedback", "confidence", "dimension", "rubric", "stub")
        )


def test_a_strong_answer_raises_and_a_weak_one_lowers_the_difficulty_within_bounds(
    client, db, admin, candidate, users, install
):
    install()
    ctx = interview(client, admin, users, question_count=4)
    state = start(client, candidate, ctx["id"])
    assert state["current"]["difficulty"] == "MEDIUM"  # the configured starting level

    answer(client, candidate, state, text="[[stub:strong]] A thorough answer.")
    state = read(client, candidate, state)
    assert state["current"]["difficulty"] == "HARD"
    answer(client, candidate, state, text="[[stub:strong]] Again thorough.")
    state = read(client, candidate, state)
    assert state["current"]["difficulty"] == "HARD"  # the maximum holds
    answer(client, candidate, state, text="[[stub:weak]] Not sure.")
    state = read(client, candidate, state)
    assert state["current"]["difficulty"] == "MEDIUM"  # one level down, never a jump

    session = db.get(InterviewSession, uuid.UUID(state["session_id"]))
    assert session.current_difficulty.value == "MEDIUM" and session.difficulty_changes == 2
    items = db.scalars(select(InterviewSessionItem).order_by(InterviewSessionItem.sequence)).all()
    assert [i.selected_by.value for i in items] == ["PLAN", "ADAPTIVE", "ADAPTIVE", "ADAPTIVE"]
    assert len({i.question_id for i in items}) == len(items)  # no repeats
    decisions = audit(db, "INTERVIEW_ADAPTIVE_DECISION")
    assert [d.details["difficulty_change"] for d in decisions] == [1, 0, -1]
    assert (
        decisions[0].details["reason"] == "strong_answer"
        and decisions[0].details["policy_version"] == "7B-v1"
    )


def test_the_evaluation_decides_the_follow_up(client, db, admin, candidate, users, install):
    install()
    ctx = interview(
        client,
        admin,
        users,
        adaptive=False,
        follow_up_on=("EASY1", "EASY2"),
        difficulty="EASY",
        starting_difficulty="EASY",
        question_count=2,
    )
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state, text="[[stub:strong]] Complete answer.")
    state = read(client, candidate, state)
    assert state["current"]["kind"] == "PRIMARY"  # strong: the configured follow-up is not needed
    answer(client, candidate, state, text="[[stub:weak]] Partial answer.")
    state = read(client, candidate, state)
    assert state["current"]["kind"] == "FOLLOW_UP" and state["current"]["text"] == "Follow-up to EASY2?"
    answer(client, candidate, state, text="Follow-up answer.")
    done = read(client, candidate, state)
    assert done["status"] == "COMPLETED" and done["completion_reason"] == "ALL_ANSWERED"
    assert len(evaluations(db)) == 3  # the follow-up answer is evaluated too


# -- failures and fallback --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("provider", "reason"),
    [
        (Failing(), "PROVIDER_ERROR"),
        (Failing(EvaluationFailure.RATE_LIMITED, retryable=True), "RATE_LIMITED"),
        (StubProvider(), "INVALID_OUTPUT"),  # with [[stub:invalid]] below
    ],
)
def test_a_failed_evaluation_is_never_a_score_and_the_interview_moves_on(
    client, db, admin, candidate, users, install, provider, reason
):
    install(provider)
    ctx = interview(client, admin, users, adaptive=True, follow_up_on=("MEDIUM1",))
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state, text="[[stub:invalid]] An answer.")
    state = read(client, candidate, state)
    [evaluation] = evaluations(db)
    assert evaluation.status.value == "FAILED" and evaluation.failure_reason.value == reason
    assert (
        evaluation.overall_score is None
        and evaluation.dimension_scores is None
        and evaluation.confidence is None
    )
    # Fallback: the 7A rule (the configured follow-up), difficulty unchanged, recorded as FALLBACK.
    assert state["current"]["kind"] == "FOLLOW_UP"
    item = db.scalar(select(InterviewSessionItem).where(InterviewSessionItem.sequence == 2))
    assert item.selected_by.value == "FALLBACK"
    session = db.get(InterviewSession, uuid.UUID(state["session_id"]))
    assert session.difficulty_changes == 0
    if isinstance(provider, Failing) and provider.retryable:
        assert provider.calls == 2  # 1 + llm_max_retries, then it gives up — bounded
    assert len(audit(db, "INTERVIEW_EVALUATION_FAILED")) == 1


def test_a_late_evaluation_does_not_hold_the_candidate_and_is_recorded_when_it_arrives(
    client, db, admin, candidate, users, install
):
    stuck = install(runner_cls=Stuck)
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    assert read(client, candidate, state)["processing"] is True  # within the wait: still processing

    item = db.scalar(select(InterviewSessionItem).where(InterviewSessionItem.sequence == 1))
    item.presented_at = utcnow() - timedelta(seconds=60)
    item.answered_at = utcnow() - timedelta(seconds=26)  # the wait (25 s) has run out
    db.flush()
    moved = read(client, candidate, state)
    assert moved["processing"] is False and moved["current"]["number"] == 2
    assert moved["current"]["difficulty"] == "MEDIUM"  # no signal: difficulty unchanged
    [evaluation] = evaluations(db)
    assert evaluation.status.value == "PENDING"

    # The evaluation arrives later: it is recorded, and the interview is not moved on a second time.
    real = EvaluationRunner(stuck.scope, StubProvider(), stuck.settings, sleep=lambda _: None)
    real.run(evaluation.id)
    db.refresh(evaluation)
    assert evaluation.status.value == "COMPLETED"
    assert db.scalar(select(func.count()).select_from(InterviewSessionItem)) == 2


def test_an_abandoned_evaluation_is_rescheduled_and_its_runs_are_bounded(
    client, db, admin, candidate, users, install
):
    stuck = install(runner_cls=Stuck)
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    [evaluation] = evaluations(db)
    assert stuck.scheduled == [evaluation.id]  # scheduled once, by the answer

    evaluation.requested_at = utcnow() - timedelta(seconds=30)  # never picked up (process restarted)
    db.flush()
    read(client, candidate, state)
    assert stuck.scheduled == [evaluation.id, evaluation.id]  # the next read re-schedules it

    evaluation.attempts = MAX_RUNS  # every run already used
    db.flush()
    EvaluationRunner(stuck.scope, StubProvider(), stuck.settings).run(evaluation.id)
    db.refresh(evaluation)
    assert evaluation.status.value == "FAILED" and evaluation.failure_reason.value == "TIMEOUT"
    assert evaluation.overall_score is None


def test_running_an_evaluation_twice_records_it_once(client, db, admin, candidate, users, install):
    runner = install(Recording(StubProvider()))
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    [evaluation] = evaluations(db)
    runner.run(evaluation.id)  # a duplicate (retry, double schedule)
    runner.run(evaluation.id)
    assert len(runner.provider.requests) == 1
    assert len(audit(db, "INTERVIEW_EVALUATION_COMPLETED")) == 1
    assert db.scalar(select(func.count()).select_from(InterviewSessionItem)) == 2


def test_the_clock_and_completion_are_unaffected_by_evaluation(client, db, admin, candidate, users, install):
    stuck = install(runner_cls=Stuck)
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    session = db.get(InterviewSession, uuid.UUID(state["session_id"]))
    session.started_at = utcnow() - timedelta(minutes=40)
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.flush()
    ended = read(client, candidate, state)
    assert ended["status"] == "COMPLETED" and ended["completion_reason"] == "TIME_EXPIRED"
    [evaluation] = evaluations(db)
    EvaluationRunner(stuck.scope, StubProvider(), stuck.settings).run(evaluation.id)
    db.refresh(evaluation)
    assert evaluation.status.value == "COMPLETED"  # the answer was submitted in time, so it is evaluated
    assert db.scalar(select(func.count()).select_from(InterviewSessionItem)) == 1  # but nothing new is asked


def test_ending_early_while_processing(client, db, admin, candidate, users, install):
    install(runner_cls=Stuck)
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    ended = call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    assert ended["status"] == "COMPLETED" and ended["processing"] is False


# -- tampering and access ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "forged",
    [
        {"score": 100},
        {"overall_score": 100},
        {"rubric_version": "admin-v2"},
        {"evaluator_version": "trusted"},
        {"model": "gpt-best"},
        {"confidence": 1},
        {"evaluation": {"overall_score": 100}},
        {"difficulty": "EASY"},
        {"final_score": 100},
    ],
)
def test_candidates_cannot_send_evaluation_fields(client, db, admin, candidate, users, install, forged):
    install()
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    body = {"item_id": state["current"]["item_id"], "answer_text": "Answer.", **forged}
    call(client, "POST", f"{SESSIONS}/{state['session_id']}/answers", candidate, 422, body)
    assert evaluations(db) == []


def test_admins_read_evaluations_and_nobody_else_can(
    client, db, helpers: Helpers, admin, candidate, users, install
):
    install()
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state, text="[[stub:strong]] Detailed answer.")
    url = f"{BASE}/{ctx['id']}/assignments/{users['candidate'].id}/evaluations"
    body = call(client, "GET", url, admin, 200)
    first = body["answers"][0]
    assert first["answer_text"] == "[[stub:strong]] Detailed answer." and first["selected_by"] == "PLAN"
    assert first["evaluation"]["overall_score"] == 90 and first["evaluation"]["model"] == "stub"
    assert body["answers"][1]["evaluation"] is None  # the presented question has no answer yet
    assert "does not make hiring decisions" in body["note"]
    assert SYSTEM_PROMPT[:40] not in str(body) and "<candidate_answer>" not in str(body)

    call(client, "GET", url, candidate, 403)
    call(client, "GET", url, None, 401)
    call(client, "GET", f"{BASE}/{ctx['id']}/assignments/{users['admin'].id}/evaluations", admin, 404)
    other = create(client, admin, title="Other")
    call(client, "GET", f"{BASE}/{other['id']}/assignments/{users['candidate'].id}/evaluations", admin, 404)


def test_adaptive_configuration_is_validated(client, admin, users):
    create(
        client,
        admin,
        adaptive_difficulty=True,
        min_difficulty="MEDIUM",
        starting_difficulty="MEDIUM",
        difficulty="HARD",
    )
    for bad in (
        {"min_difficulty": "HARD", "starting_difficulty": "EASY"},
        {"starting_difficulty": "HARD", "difficulty": "MEDIUM"},
        {"min_difficulty": "HARD", "difficulty": "EASY"},
        {"min_difficulty": "IMPOSSIBLE"},
    ):
        call(client, "POST", BASE, admin, 422, {**_config(), **bad})
    # The publish gate counts the adaptive pool within [min, max].
    created = create(
        client,
        admin,
        adaptive_difficulty=True,
        min_difficulty="MEDIUM",
        starting_difficulty="MEDIUM",
        difficulty="HARD",
        question_count=2,
        max_follow_ups=0,
    )
    add_question(client, admin, created["id"], difficulty="EASY")  # below the minimum: not eligible
    add_question(client, admin, created["id"], difficulty="HARD")
    detail = call(client, "GET", f"{BASE}/{created['id']}", admin, 200)
    assert detail["eligible_question_count"] == 1 and detail["issues"]


def _config() -> dict:
    from tests.test_interview_config import CONFIG

    return dict(CONFIG)


def test_evaluation_touches_no_proctoring_data_and_audits_no_answer_text(
    client, db, admin, candidate, users, install
):
    install()
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    secret = "[[stub:weak]] My private answer text about Python internals."
    answer(client, candidate, state, text=secret)
    read(client, candidate, state)
    assert db.scalar(select(func.count()).select_from(ProctoringEvent)) == 0
    assert db.scalar(select(func.count()).select_from(AttemptReview)) == 0
    details = str([r.details for r in db.scalars(select(AuditLog))])
    assert "private answer text" not in details and "Stub evaluation" not in details
    completed = audit(db, "INTERVIEW_EVALUATION_COMPLETED")[0].details
    assert completed["initiated_by"] == "evaluator" and completed["overall_score"] == 20
    assert {"provider_calls", "latency_ms", "evaluator_version", "rubric_version"} <= set(completed)


def test_without_an_evaluator_answers_are_recorded_as_not_evaluated(client, db, admin, candidate, users):
    ctx = interview(
        client,
        admin,
        users,
        adaptive=False,
        follow_up_on=("EASY1",),
        difficulty="EASY",
        starting_difficulty="EASY",
        question_count=2,
    )
    state = start(client, candidate, ctx["id"])
    after = answer(client, candidate, state)
    assert after["processing"] is False and after["current"]["kind"] == "FOLLOW_UP"  # 7A rule, at once
    [evaluation] = evaluations(db)
    assert evaluation.status.value == "UNAVAILABLE" and evaluation.failure_reason.value == "NOT_CONFIGURED"
    assert evaluation.overall_score is None
    assert (
        audit(db, "INTERVIEW_ADAPTIVE_DECISION") == [] and audit(db, "INTERVIEW_EVALUATION_REQUESTED") == []
    )


def test_the_provider_payload_is_validated_before_anything_is_stored(
    client, db, admin, candidate, users, install
):
    class Lying:
        name, model = "fake", "fake-model"

        def evaluate(self, request):
            return ProviderResult(payload={"overall_score": 100, "verdict": "HIRE", "status": "REJECTED"})

    install(Lying())
    ctx = interview(client, admin, users)
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    state = read(client, candidate, state)
    [evaluation] = evaluations(db)
    assert evaluation.status.value == "FAILED" and evaluation.failure_reason.value == "INVALID_OUTPUT"
    assert evaluation.overall_score is None and state["status"] == "ACTIVE"  # the model cannot end or reject

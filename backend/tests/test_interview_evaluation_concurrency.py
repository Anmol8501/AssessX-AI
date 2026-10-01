"""Phase 7B: real races on committed data — duplicate evaluation runs, and an evaluation finishing while
the candidate's poll applies the fallback.

Two threads on separate connections act at once. The evaluation row's lock and lease make exactly one
run call the provider; the session lock plus the "only while nothing is presented" rule make the
interview move on exactly once, whichever of the evaluator and the poll gets there first.
"""

import threading
import time
import uuid
from contextlib import contextmanager
from datetime import timedelta

from sqlalchemy import func, select

from app.core.config import get_settings
from app.models.audit_log import AuditLog
from app.models.base import utcnow
from app.models.interview import InterviewSessionItem
from app.models.interview_evaluation import InterviewEvaluation
from app.models.user import User
from app.services.interview.llm import StubProvider
from app.services.interview.runner import EvaluationRunner
from app.services.interview.sessions import EvaluatorInfo, InterviewSessionService
from tests.conftest import TestingSession, engine
from tests.test_interview_concurrency import committed  # noqa: F401 — the committed-data fixture

CONFIGURED = EvaluatorInfo(provider="stub", model="stub", configured=True, wait_seconds=25)


@contextmanager
def scope():
    db = TestingSession(bind=engine)
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class Slow(StubProvider):
    def __init__(self) -> None:
        self.calls = 0
        self.lock = threading.Lock()

    def evaluate(self, request):
        with self.lock:
            self.calls += 1
        time.sleep(0.3)
        return super().evaluate(request)


def answer_pending(committed) -> uuid.UUID:  # noqa: F811
    """Submits the current answer with an evaluator configured: a PENDING evaluation, session processing."""
    state = committed["state"]
    with scope() as db:
        candidate = db.get(User, committed["candidate_id"])
        _, to_run = InterviewSessionService(db, CONFIGURED).answer(
            uuid.UUID(state["session_id"]),
            candidate,
            uuid.UUID(state["current"]["item_id"]),
            "A committed answer.",
        )
    return to_run[0]


def in_parallel(*actions) -> list[object]:
    barrier = threading.Barrier(len(actions))
    results: list[object] = [None] * len(actions)

    def run(index: int) -> None:
        try:
            barrier.wait(timeout=10)
            results[index] = actions[index]()
        except Exception as error:  # surfaced by the assertions
            results[index] = error

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(actions))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results


def test_two_runs_of_one_evaluation_call_the_provider_once(committed):  # noqa: F811
    evaluation_id = answer_pending(committed)
    provider = Slow()
    settings = get_settings()
    runners = [EvaluationRunner(scope, provider, settings, sleep=lambda _: None) for _ in range(2)]
    results = in_parallel(lambda: runners[0].run(evaluation_id), lambda: runners[1].run(evaluation_id))
    assert not any(isinstance(r, Exception) for r in results), results
    assert provider.calls == 1

    with TestingSession(bind=engine) as check:
        evaluation = check.get(InterviewEvaluation, evaluation_id)
        assert evaluation.status.value == "COMPLETED" and evaluation.attempts == 1
        completed = check.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.action == "INTERVIEW_EVALUATION_COMPLETED")
        )
        assert completed == 1
        session_id = uuid.UUID(committed["state"]["session_id"])
        items = check.scalars(
            select(InterviewSessionItem).where(InterviewSessionItem.session_id == session_id)
        ).all()
        assert sorted((i.sequence, i.state.value) for i in items) == [(1, "ANSWERED"), (2, "PRESENTED")]


def test_an_evaluation_finishing_during_a_fallback_poll_moves_the_interview_on_once(committed):  # noqa: F811
    evaluation_id = answer_pending(committed)
    session_id = uuid.UUID(committed["state"]["session_id"])
    with scope() as db:  # the wait has run out: a poll would now apply the fallback
        item = db.scalar(select(InterviewSessionItem).where(InterviewSessionItem.session_id == session_id))
        item.presented_at = utcnow() - timedelta(seconds=60)
        item.answered_at = utcnow() - timedelta(seconds=30)

    runner = EvaluationRunner(scope, StubProvider(), get_settings(), sleep=lambda _: None)

    def poll():
        with scope() as db:
            candidate = db.get(User, committed["candidate_id"])
            InterviewSessionService(db, CONFIGURED).state(session_id, candidate)

    results = in_parallel(lambda: runner.run(evaluation_id), poll)
    assert not any(isinstance(r, Exception) for r in results), results

    with TestingSession(bind=engine) as check:
        items = check.scalars(
            select(InterviewSessionItem).where(InterviewSessionItem.session_id == session_id)
        ).all()
        assert sorted((i.sequence, i.state.value) for i in items) == [(1, "ANSWERED"), (2, "PRESENTED")]
        assert check.get(InterviewEvaluation, evaluation_id).status.value == "COMPLETED"

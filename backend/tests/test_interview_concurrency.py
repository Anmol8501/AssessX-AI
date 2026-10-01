"""Phase 7A: real races on committed data — a double-submitted answer and a double-clicked start.

The rest of the suite runs inside one rolled-back transaction, which cannot show a race. Here the setup
is committed and two threads, each on its own database connection, act at the same moment through the
session service. The session row's `FOR UPDATE` lock (and the unique constraints behind it) serialise
them: one answer is saved and the interview advances once; two starts yield one session. Everything
committed is removed afterwards (the same TRUNCATE the session teardown runs).
"""

import threading
import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import StaleInterviewQuestion
from app.main import create_app
from app.models.interview import InterviewSession, InterviewSessionItem
from app.models.user import User, UserRole
from app.services.interview.sessions import InterviewSessionService
from app.services.users import UserService
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, CANDIDATE_ROLL, TestingSession, engine
from tests.test_interview_config import ME, assign, call, published_interview
from tests.test_review_concurrency import CLEANUP, CommittingHelpers


@pytest.fixture
def committed() -> Iterator[dict]:
    setup = TestingSession(bind=engine)
    app = create_app()

    def _committing() -> Iterator[Session]:
        session = TestingSession(bind=engine)
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_db] = _committing
    try:
        service = UserService(setup)
        users = {
            "admin": service.create(
                name="Ada Admin", email="admin@test.local", password=ADMIN_PASSWORD, role=UserRole.ADMIN,
                username="ada",
            ),
            "candidate": service.create(
                name="Cal Candidate", email="candidate@test.local", password=CANDIDATE_PASSWORD,
                role=UserRole.CANDIDATE, roll_number=CANDIDATE_ROLL,
            ),
        }  # fmt: skip
        setup.commit()
        with TestClient(app) as client:
            helpers = CommittingHelpers(client, setup)
            admin = helpers.bearer(helpers.token_for("admin@test.local", ADMIN_PASSWORD))
            candidate = helpers.bearer(helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD))
            started = published_interview(client, admin, questions=3, follow_ups=())
            assign(client, admin, started["id"], users["candidate"].id)
            state = call(client, "POST", f"{ME}/interviews/{started['id']}/session", candidate, 201)
            fresh = published_interview(
                client, admin, questions=2, follow_ups=(), title="Fresh", question_count=2
            )
            assign(client, admin, fresh["id"], users["candidate"].id)
        yield {"candidate_id": users["candidate"].id, "state": state, "fresh_id": uuid.UUID(fresh["id"])}
    finally:
        setup.rollback()
        setup.close()
        with engine.connect() as connection:
            connection.execute(text(CLEANUP))
            connection.commit()


def race(action: Callable[[Session, User], object], candidate_id: uuid.UUID) -> list[object]:
    barrier = threading.Barrier(2)
    results: list[object] = [None, None]

    def run(index: int) -> None:
        session = TestingSession(bind=engine)
        try:
            candidate = session.get(User, candidate_id)
            barrier.wait(timeout=10)
            results[index] = action(session, candidate)
            session.commit()
        except Exception as error:  # surfaced by the caller's assertions
            session.rollback()
            results[index] = error
        finally:
            session.close()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return results


def test_a_double_submitted_answer_is_saved_once_and_advances_once(committed):
    state = committed["state"]
    session_id, item_id = uuid.UUID(state["session_id"]), uuid.UUID(state["current"]["item_id"])
    results = race(
        lambda db, candidate: InterviewSessionService(db).answer(
            session_id, candidate, item_id, "Same answer."
        ),
        committed["candidate_id"],
    )
    stale = [r for r in results if isinstance(r, StaleInterviewQuestion)]
    ok = [r for r in results if not isinstance(r, Exception)]
    assert len(ok) == 1 and len(stale) == 1, results

    with TestingSession(bind=engine) as check:
        items = check.scalars(
            select(InterviewSessionItem)
            .where(InterviewSessionItem.session_id == session_id)
            .order_by(InterviewSessionItem.sequence)
        ).all()
        assert [(i.sequence, i.state.value) for i in items] == [(1, "ANSWERED"), (2, "PRESENTED")]


def test_two_simultaneous_starts_yield_one_session(committed):
    interview_id = committed["fresh_id"]
    results = race(
        lambda db, candidate: InterviewSessionService(db).start(interview_id, candidate),
        committed["candidate_id"],
    )
    assert not any(isinstance(r, Exception) for r in results), results
    views = [r[0] for r in results]  # (view, created)
    assert sorted(r[1] for r in results) == [False, True]
    assert views[0].session.id == views[1].session.id

    with TestingSession(bind=engine) as check:
        assert (
            check.scalar(
                select(func.count())
                .select_from(InterviewSession)
                .where(InterviewSession.interview_id == interview_id)
            )
            == 1
        )
        session = check.scalar(select(InterviewSession).where(InterviewSession.interview_id == interview_id))
        items = check.scalars(
            select(InterviewSessionItem).where(InterviewSessionItem.session_id == session.id)
        ).all()
        assert len(items) == 1  # the first question was presented once

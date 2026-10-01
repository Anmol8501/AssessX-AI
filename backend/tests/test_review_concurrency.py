"""Phase 6C: two administrators completing the same review at the same moment.

The rest of the suite runs inside one rolled-back transaction, which cannot show a race. Here the
setup is committed and two threads, each on its own database connection, complete the review
simultaneously through `ReviewService`. The review row's `FOR UPDATE` lock serialises them: exactly
one decision is recorded and the other administrator gets a conflict — never a silent overwrite.
Everything this test commits is removed afterwards (the same TRUNCATE the session teardown runs).
"""

import threading
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ReviewConflict
from app.main import create_app
from app.models.audit_log import AuditLog
from app.models.review import AttemptReview, ReviewDecision, ReviewOutcome
from app.models.user import User, UserRole
from app.services.review.service import ReviewService
from app.services.users import UserService
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, CANDIDATE_ROLL, Helpers, TestingSession, engine
from tests.test_attempts import start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, proctored_exam

CLEANUP = (
    "TRUNCATE TABLE question_options, questions, assessments, auth_sessions, login_challenges, users CASCADE"
)


class CommittingHelpers(Helpers):
    def solved_challenge(self, answer: str = "ABC234", *, expired: bool = False) -> uuid.UUID:
        challenge_id = super().solved_challenge(answer, expired=expired)
        self.db.commit()
        return challenge_id


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
            "other": service.create(
                name="Bea Admin", email="admin2@test.local", password=ADMIN_PASSWORD, role=UserRole.ADMIN,
                username="bea",
            ),
            "candidate": service.create(
                name="Cal Candidate", email="candidate@test.local", password=CANDIDATE_PASSWORD,
                role=UserRole.CANDIDATE, roll_number=CANDIDATE_ROLL,
            ),
        }  # fmt: skip
        setup.commit()
        with TestClient(app) as client:
            helpers = CommittingHelpers(client, setup)
            exam = proctored_exam(client, helpers, users)
            candidate = helpers.bearer(helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD))
            attempt = start(client, candidate, exam["id"])
            activate(client, candidate, attempt["id"])
            submit(client, candidate, attempt["id"])
            admin = helpers.bearer(helpers.token_for("admin@test.local", ADMIN_PASSWORD))
            response = client.post(f"/api/v1/admin/attempts/{attempt['id']}/review", headers=admin)
            assert response.status_code == 201, response.text
        yield {"attempt_id": uuid.UUID(attempt["id"]), "admins": [users["admin"].id, users["other"].id]}
    finally:
        setup.rollback()
        setup.close()
        with engine.connect() as connection:
            connection.execute(text(CLEANUP))
            connection.commit()


def test_simultaneous_completions_record_exactly_one_decision(committed):
    barrier = threading.Barrier(2)
    results: dict[int, object] = {}
    outcomes = [ReviewOutcome.CLEARED, ReviewOutcome.INVALIDATED]

    def complete(index: int) -> None:
        session = TestingSession(bind=engine)
        try:
            admin = session.get(User, committed["admins"][index])
            barrier.wait(timeout=10)
            ReviewService(session).complete(
                committed["attempt_id"],
                admin,
                outcome=outcomes[index],
                rationale=f"Decision by admin {index}.",
                expected_version=1,  # both read version 1 before either decided
            )
            session.commit()
            results[index] = "ok"
        except ReviewConflict as conflict:
            session.rollback()
            results[index] = conflict
        except Exception as error:  # surfaced by the assertion below
            session.rollback()
            results[index] = error
        finally:
            session.close()

    threads = [threading.Thread(target=complete, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    winners = [i for i, r in results.items() if r == "ok"]
    losers = [i for i, r in results.items() if isinstance(r, ReviewConflict)]
    assert len(winners) == 1 and len(losers) == 1, results

    with TestingSession(bind=engine) as check:
        review = check.scalar(
            select(AttemptReview).where(AttemptReview.attempt_id == committed["attempt_id"])
        )
        assert review.outcome is outcomes[winners[0]] and review.version == 2
        assert review.completed_by_id == committed["admins"][winners[0]]
        assert check.scalar(select(func.count()).select_from(ReviewDecision)) == 1
        completed = check.scalars(select(AuditLog).where(AuditLog.action == "REVIEW_COMPLETED")).all()
        assert len(completed) == 1 and completed[0].actor_id == committed["admins"][winners[0]]
    # The loser was told who decided, so it can re-read rather than retry blindly.
    conflict = results[losers[0]]
    assert isinstance(conflict, ReviewConflict)
    assert conflict.details["outcome"] == outcomes[winners[0]].value

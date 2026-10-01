"""Phase 7C: real races on committed data — two reviewers completing the same interview review at once,
and the report being read while a review completes.

Two threads on separate connections. The review row's lock plus the `expected_version` check give exactly
one decision; the other reviewer is told who decided (409), never silently overwritten.
"""

import uuid

from sqlalchemy import func, select

from app.core.errors import ReviewConflict
from app.models.interview import InterviewSession
from app.models.interview_review import InterviewReview, InterviewReviewDecision, InterviewReviewOutcome
from app.models.user import User, UserRole
from app.services.interview.report import InterviewReportService
from app.services.interview.review import InterviewReviewService
from app.services.interview.sessions import InterviewSessionService
from app.services.users import UserService
from tests.conftest import ADMIN_PASSWORD, TestingSession, engine
from tests.test_interview_concurrency import committed  # noqa: F401 — the committed-data fixture
from tests.test_interview_evaluation_concurrency import in_parallel, scope


def prepare(committed) -> tuple[uuid.UUID, uuid.UUID, list[uuid.UUID]]:  # noqa: F811
    """End the candidate's interview, add a second admin, start the review. Returns ids."""
    session_id = uuid.UUID(committed["state"]["session_id"])
    with scope() as db:
        candidate = db.get(User, committed["candidate_id"])
        InterviewSessionService(db).complete(session_id, candidate)
        interview_id = db.get(InterviewSession, session_id).interview_id
        first = db.scalar(select(User).where(User.role == UserRole.ADMIN))
        second = UserService(db).create(
            name="Bea Admin",
            email="admin2@test.local",
            password=ADMIN_PASSWORD,
            role=UserRole.ADMIN,
            username="bea",
        )
        db.flush()
        InterviewReviewService(db).start(interview_id, session_id, first)
        return interview_id, session_id, [first.id, second.id]


def test_simultaneous_completions_record_exactly_one_decision(committed):  # noqa: F811
    interview_id, session_id, admins = prepare(committed)
    outcomes = [InterviewReviewOutcome.MEETS_EXPECTATIONS, InterviewReviewOutcome.DOES_NOT_MEET_EXPECTATIONS]

    def complete(index: int):
        def run():
            with scope() as db:
                admin = db.get(User, admins[index])
                InterviewReviewService(db).complete(
                    interview_id,
                    session_id,
                    admin,
                    outcome=outcomes[index],
                    rationale=f"Decision by reviewer {index}.",
                    expected_version=1,
                )
            return "ok"

        return run

    results = in_parallel(complete(0), complete(1))
    winners = [i for i, r in enumerate(results) if r == "ok"]
    losers = [i for i, r in enumerate(results) if isinstance(r, ReviewConflict)]
    assert len(winners) == 1 and len(losers) == 1, results
    assert results[losers[0]].details["outcome"] == outcomes[winners[0]].value

    with TestingSession(bind=engine) as check:
        review = check.scalar(select(InterviewReview).where(InterviewReview.session_id == session_id))
        assert review.outcome is outcomes[winners[0]] and review.version == 2
        assert check.scalar(select(func.count()).select_from(InterviewReviewDecision)) == 1


def test_reading_the_report_during_completion_is_consistent(committed):  # noqa: F811
    interview_id, session_id, admins = prepare(committed)

    def complete():
        with scope() as db:
            admin = db.get(User, admins[0])
            InterviewReviewService(db).complete(
                interview_id,
                session_id,
                admin,
                outcome=InterviewReviewOutcome.INCONCLUSIVE,
                rationale="Abandoned early.",
                expected_version=1,
            )
        return "ok"

    def read():
        with scope() as db:
            report = InterviewReportService(db).build(interview_id, session_id)
            review = report.review.review
            # Either before or after — never a half-written review.
            assert review is not None
            assert (review.status.value, review.outcome is None) in {("IN_REVIEW", True), ("REVIEWED", False)}
        return "ok"

    assert in_parallel(complete, read) == ["ok", "ok"]

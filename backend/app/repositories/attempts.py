import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.attempt import (
    ACTIVE_ATTEMPT_STATUSES,
    AssessmentAttempt,
    AttemptAnswer,
    AttemptAnswerOption,
)
from app.models.base import utcnow


class AttemptRepository:
    """Attempts and their answers. Every lookup that a candidate can reach is scoped by
    `candidate_id` in the query itself, so an attempt belonging to someone else is not found
    rather than found-then-rejected."""

    def __init__(self, db: Session) -> None:
        self.db = db

    # -- attempts ------------------------------------------------------------------------

    def get_for_candidate(self, attempt_id: uuid.UUID, candidate_id: uuid.UUID) -> AssessmentAttempt | None:
        return self.db.scalar(
            select(AssessmentAttempt).where(
                AssessmentAttempt.id == attempt_id,
                AssessmentAttempt.candidate_id == candidate_id,
            )
        )

    def get_for_candidate_locked(
        self, attempt_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> AssessmentAttempt | None:
        """The same row, held under `SELECT ... FOR UPDATE` until the transaction ends.

        This is what makes finishing an attempt deterministic. Two submits arriving together, or a
        submit racing the expiry sweep, serialise here: the first transaction decides the outcome
        and the second reads the settled row rather than overwriting it.
        """
        return self.db.scalar(
            select(AssessmentAttempt)
            .where(
                AssessmentAttempt.id == attempt_id,
                AssessmentAttempt.candidate_id == candidate_id,
            )
            # `of=` is required, not cosmetic: the model eager-loads its assessment and candidate
            # as outer joins, and PostgreSQL refuses to lock the nullable side of one. Only the
            # attempt row needs locking anyway — the exam itself is not being changed.
            .with_for_update(of=AssessmentAttempt)
        )

    def latest_by_assessment(self, candidate_id: uuid.UUID) -> dict[uuid.UUID, AssessmentAttempt]:
        """`{assessment_id: most recent attempt}` for one candidate.

        One query for the whole My Exams list. A candidate holds few attempts, so the newest per
        assessment is picked in Python rather than with a window function.
        """
        latest: dict[uuid.UUID, AssessmentAttempt] = {}
        rows = self.db.scalars(
            select(AssessmentAttempt)
            .where(AssessmentAttempt.candidate_id == candidate_id)
            .order_by(AssessmentAttempt.attempt_number)
        )
        for attempt in rows:
            latest[attempt.assessment_id] = attempt  # ascending order leaves the newest last
        return latest

    def get_active(self, assessment_id: uuid.UUID, candidate_id: uuid.UUID) -> AssessmentAttempt | None:
        """The candidate's open attempt at this assessment, if they have one.

        `uq_attempt_one_active_per_candidate` guarantees there is at most one.
        """
        return self.db.scalar(
            select(AssessmentAttempt).where(
                AssessmentAttempt.assessment_id == assessment_id,
                AssessmentAttempt.candidate_id == candidate_id,
                AssessmentAttempt.status.in_(ACTIVE_ATTEMPT_STATUSES),
            )
        )

    def count_for_candidate(self, assessment_id: uuid.UUID, candidate_id: uuid.UUID) -> int:
        """Every attempt ever made, open or not — this is what `max_attempts` limits."""
        return (
            self.db.scalar(
                select(func.count())
                .select_from(AssessmentAttempt)
                .where(
                    AssessmentAttempt.assessment_id == assessment_id,
                    AssessmentAttempt.candidate_id == candidate_id,
                )
            )
            or 0
        )

    def active_attempt_ids_by_assessment(self, candidate_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
        """`{assessment_id: attempt_id}` for the candidate's open attempts.

        One query for the whole My Exams list, rather than one per row.
        """
        rows = self.db.execute(
            select(AssessmentAttempt.assessment_id, AssessmentAttempt.id).where(
                AssessmentAttempt.candidate_id == candidate_id,
                AssessmentAttempt.status.in_(ACTIVE_ATTEMPT_STATUSES),
            )
        ).all()
        return {row[0]: row[1] for row in rows}

    def add(self, attempt: AssessmentAttempt) -> AssessmentAttempt:
        self.db.add(attempt)
        self.db.flush()
        return attempt

    # -- answers -------------------------------------------------------------------------

    def get_answer(self, attempt_id: uuid.UUID, question_id: uuid.UUID) -> AttemptAnswer | None:
        return self.db.scalar(
            select(AttemptAnswer)
            .options(selectinload(AttemptAnswer.selections))
            .where(AttemptAnswer.attempt_id == attempt_id, AttemptAnswer.question_id == question_id)
        )

    def list_answers(self, attempt_id: uuid.UUID) -> list[AttemptAnswer]:
        return list(
            self.db.scalars(
                select(AttemptAnswer)
                .options(selectinload(AttemptAnswer.selections))
                .where(AttemptAnswer.attempt_id == attempt_id)
            )
        )

    def add_answer(self, answer: AttemptAnswer) -> AttemptAnswer:
        self.db.add(answer)
        self.db.flush()
        return answer

    def replace_selections(self, answer: AttemptAnswer, option_ids: list[uuid.UUID]) -> AttemptAnswer:
        """Sets the selection to exactly `option_ids`.

        Replacing wholesale (rather than diffing) keeps single- and multiple-select on the same
        path and makes clearing an answer the ordinary case of an empty list.
        """
        answer.selections.clear()
        self.db.flush()  # emit the deletes before the inserts, or re-selecting an option collides
        for option_id in dict.fromkeys(option_ids):  # de-duplicate, keep order
            answer.selections.append(AttemptAnswerOption(option_id=option_id))
        # Changing only the child rows leaves `onupdate` untouched, and the client shows this as
        # the time the answer was last confirmed by the server.
        answer.updated_at = utcnow()
        self.db.flush()
        return answer

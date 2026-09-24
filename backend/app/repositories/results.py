import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.attempt import AssessmentAttempt
from app.models.result import AttemptResult


class ResultRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_for_attempt(self, attempt_id: uuid.UUID) -> AttemptResult | None:
        return self.db.scalar(select(AttemptResult).where(AttemptResult.attempt_id == attempt_id))

    def add(self, result: AttemptResult) -> AttemptResult:
        self.db.add(result)
        self.db.flush()
        return result

    def list_for_candidate(self, candidate_id: uuid.UUID) -> list[AttemptResult]:
        """A candidate's own results, newest first, with the assessment and attempt they belong to.

        Scoped by `candidate_id` in the query, so another candidate's result is not reachable.
        """
        return list(
            self.db.scalars(
                select(AttemptResult)
                .options(joinedload(AttemptResult.assessment), joinedload(AttemptResult.attempt))
                .where(AttemptResult.candidate_id == candidate_id)
                .order_by(AttemptResult.evaluated_at.desc())
            )
        )

    def list_for_assessment(self, assessment_id: uuid.UUID) -> list[AttemptResult]:
        """Every result for one assessment, for the admin table.

        Eager-loads the candidate and the attempt so rendering the table is one query, not one per
        row.
        """
        return list(
            self.db.scalars(
                select(AttemptResult)
                .options(joinedload(AttemptResult.candidate), joinedload(AttemptResult.attempt))
                .where(AttemptResult.assessment_id == assessment_id)
                .order_by(AttemptResult.evaluated_at.desc())
            )
        )

    def finalized_attempts_for_assessment(self, assessment_id: uuid.UUID) -> list[AssessmentAttempt]:
        """Finished attempts at one assessment, whether or not they have been evaluated.

        The admin view uses this to evaluate anything still outstanding — attempts that finished
        before Phase 3C existed, for instance — before listing.
        """
        return list(
            self.db.scalars(
                select(AssessmentAttempt)
                .outerjoin(AttemptResult, AttemptResult.attempt_id == AssessmentAttempt.id)
                .where(
                    AssessmentAttempt.assessment_id == assessment_id,
                    AssessmentAttempt.status != "IN_PROGRESS",
                    AttemptResult.id.is_(None),
                )
            )
        )

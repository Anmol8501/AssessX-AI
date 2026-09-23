import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.assessment import Assessment
from app.models.assignment import AssessmentAssignment
from app.models.question import Question
from app.models.user import User, UserRole


class AssignmentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_assessment(self, assessment_id: uuid.UUID) -> list[AssessmentAssignment]:
        return list(
            self.db.scalars(
                select(AssessmentAssignment)
                .options(joinedload(AssessmentAssignment.candidate))
                .where(AssessmentAssignment.assessment_id == assessment_id)
                .order_by(AssessmentAssignment.assigned_at)
            )
        )

    def get(self, assessment_id: uuid.UUID, candidate_id: uuid.UUID) -> AssessmentAssignment | None:
        return self.db.scalar(
            select(AssessmentAssignment).where(
                AssessmentAssignment.assessment_id == assessment_id,
                AssessmentAssignment.candidate_id == candidate_id,
            )
        )

    def assigned_candidate_ids(self, assessment_id: uuid.UUID) -> set[uuid.UUID]:
        return set(
            self.db.scalars(
                select(AssessmentAssignment.candidate_id).where(
                    AssessmentAssignment.assessment_id == assessment_id
                )
            )
        )

    def count_for_assessment(self, assessment_id: uuid.UUID) -> int:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(AssessmentAssignment)
                .where(AssessmentAssignment.assessment_id == assessment_id)
            )
            or 0
        )

    def add(self, assignment: AssessmentAssignment) -> AssessmentAssignment:
        self.db.add(assignment)
        self.db.flush()
        return assignment

    def delete(self, assignment: AssessmentAssignment) -> None:
        self.db.delete(assignment)
        self.db.flush()

    def list_for_candidate(self, candidate_id: uuid.UUID) -> list[tuple[AssessmentAssignment, int]]:
        """A candidate's assignments with each assessment's question count.

        One query with a correlated count, rather than loading every question of every assessment.
        """
        question_count = (
            select(func.count())
            .select_from(Question)
            .where(Question.assessment_id == Assessment.id)
            .scalar_subquery()
        )
        rows = self.db.execute(
            select(AssessmentAssignment, question_count)
            .join(Assessment, Assessment.id == AssessmentAssignment.assessment_id)
            .options(joinedload(AssessmentAssignment.assessment))
            .where(AssessmentAssignment.candidate_id == candidate_id)
            .order_by(AssessmentAssignment.assigned_at.desc())
        ).all()
        return [(row[0], row[1]) for row in rows]

    def counts_by_candidate(self) -> dict[uuid.UUID, int]:
        """Assignment totals per candidate, for the admin candidate list (avoids N+1)."""
        rows = self.db.execute(
            select(AssessmentAssignment.candidate_id, func.count()).group_by(
                AssessmentAssignment.candidate_id
            )
        ).all()
        return {row[0]: row[1] for row in rows}

    def list_candidates(self) -> list[User]:
        return list(self.db.scalars(select(User).where(User.role == UserRole.CANDIDATE).order_by(User.name)))

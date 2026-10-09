import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.paging import SCOPED_CEILING, Page
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
                .limit(SCOPED_CEILING)
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

    def list_for_candidate(
        self, candidate_id: uuid.UUID, page: "Page | None" = None
    ) -> list[tuple[AssessmentAssignment, int]]:
        """A candidate's assignments with each assessment's question count.

        One query with a correlated count, rather than loading every question of every assessment.
        """
        question_count = (
            select(func.count())
            .select_from(Question)
            .where(Question.assessment_id == Assessment.id)
            .scalar_subquery()
        )
        query = (
            select(AssessmentAssignment, question_count)
            .join(Assessment, Assessment.id == AssessmentAssignment.assessment_id)
            .options(joinedload(AssessmentAssignment.assessment))
            .where(AssessmentAssignment.candidate_id == candidate_id)
            .order_by(AssessmentAssignment.assigned_at.desc(), AssessmentAssignment.id.desc())
        )
        if page is not None:
            query = page.apply(query)
        rows = self.db.execute(query).all()
        return [(row[0], row[1]) for row in rows]

    def counts_by_candidate(self, candidate_ids: list[uuid.UUID] | None = None) -> dict[uuid.UUID, int]:
        """Assignment totals per candidate, for the admin candidate list (avoids N+1)."""
        query = select(AssessmentAssignment.candidate_id, func.count()).group_by(
            AssessmentAssignment.candidate_id
        )
        if candidate_ids is not None:
            query = query.where(AssessmentAssignment.candidate_id.in_(candidate_ids))
        rows = self.db.execute(query).all()
        return {row[0]: row[1] for row in rows}

    def list_candidates(self, page: "Page | None" = None, q: str | None = None) -> list[User]:
        query = select(User).where(User.role == UserRole.CANDIDATE).order_by(User.name, User.id)
        term = (q or "").strip()
        if term:
            # A literal substring: LIKE wildcards in the search text match only themselves.
            pattern = "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            query = query.where(
                or_(
                    func.lower(User.name).like(pattern, escape="\\"),
                    func.lower(User.email).like(pattern, escape="\\"),
                    func.lower(func.coalesce(User.roll_number, "")).like(pattern, escape="\\"),
                )
            )
        if page is not None:
            query = page.apply(query)
        return list(self.db.scalars(query))

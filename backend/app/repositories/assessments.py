import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.assessment import Assessment
from app.models.question import Question


class AssessmentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, assessment_id: uuid.UUID, *, with_questions: bool = False) -> Assessment | None:
        query = (
            select(Assessment)
            .where(Assessment.id == assessment_id)
            .options(selectinload(Assessment.assignments))
        )
        if with_questions:
            query = query.options(selectinload(Assessment.questions).selectinload(Question.options))
        return self.db.scalar(query)

    def list(self) -> list[Assessment]:
        """Newest first. Questions are loaded eagerly so counts do not trigger a query per row."""
        query = (
            select(Assessment)
            .options(selectinload(Assessment.questions), selectinload(Assessment.assignments))
            .order_by(Assessment.created_at.desc())
        )
        return list(self.db.scalars(query))

    def add(self, assessment: Assessment) -> Assessment:
        self.db.add(assessment)
        self.db.flush()
        return assessment

    def delete(self, assessment: Assessment) -> None:
        self.db.delete(assessment)
        self.db.flush()

    def next_question_position(self, assessment_id: uuid.UUID) -> int:
        highest = self.db.scalar(
            select(func.max(Question.position)).where(Question.assessment_id == assessment_id)
        )
        return 0 if highest is None else highest + 1

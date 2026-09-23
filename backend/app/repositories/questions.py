import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.question import Question


class QuestionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, question_id: uuid.UUID, *, assessment_id: uuid.UUID) -> Question | None:
        """Scoped to its assessment: a question is never reachable through an unrelated one."""
        return self.db.scalar(
            select(Question)
            .options(selectinload(Question.options))
            .where(Question.id == question_id, Question.assessment_id == assessment_id)
        )

    def list_for_assessment(self, assessment_id: uuid.UUID) -> list[Question]:
        return list(
            self.db.scalars(
                select(Question)
                .options(selectinload(Question.options))
                .where(Question.assessment_id == assessment_id)
                .order_by(Question.position)
            )
        )

    def add(self, question: Question) -> Question:
        self.db.add(question)
        self.db.flush()
        return question

    def delete(self, question: Question) -> None:
        self.db.delete(question)
        self.db.flush()

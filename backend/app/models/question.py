import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, Integer, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.assessment import Assessment


class QuestionType(enum.StrEnum):
    """Phase 2A types. PRD FR-003 also lists short/long answer (and coding etc. as future);
    those need an answer-evaluation model, so they are deliberately out of scope here."""

    MCQ = "MCQ"
    MULTIPLE_SELECT = "MULTIPLE_SELECT"
    TRUE_FALSE = "TRUE_FALSE"


#: Types whose answer key is exactly one option. Kept here so the rule lives with the model.
SINGLE_ANSWER_TYPES = frozenset({QuestionType.MCQ, QuestionType.TRUE_FALSE})


class Question(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A question belonging to one assessment.

    Options live in `question_options` rather than a JSON blob so answer keys can be queried and,
    from Phase 3, a candidate-facing shape can omit `is_correct` at the query level (OQ-17).
    """

    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("marks > 0", name="ck_questions_marks_positive"),
        CheckConstraint("position >= 0", name="ck_questions_position_non_negative"),
    )

    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[QuestionType] = mapped_column(
        Enum(QuestionType, name="question_type", native_enum=False, length=30, validate_strings=True),
        nullable=False,
    )
    marks: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: Display order within the assessment; assigned automatically in Phase 2A (reordering is 2B).
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    assessment: Mapped["Assessment"] = relationship(back_populates="questions")
    options: Mapped[list["QuestionOption"]] = relationship(
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="QuestionOption.position",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<Question {self.type} {self.text[:30]!r}>"


class QuestionOption(UUIDPrimaryKeyMixin, Base):
    """One selectable answer. `is_correct` is the answer key and is never sent to a candidate."""

    __tablename__ = "question_options"
    __table_args__ = (
        UniqueConstraint("question_id", "position", name="uq_question_options_question_position"),
        CheckConstraint("position >= 0", name="ck_question_options_position_non_negative"),
    )

    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    question: Mapped[Question] = relationship(back_populates="options")

    def __repr__(self) -> str:
        return f"<QuestionOption {self.text[:20]!r} correct={self.is_correct}>"

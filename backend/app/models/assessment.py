import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.assignment import AssessmentAssignment
    from app.models.question import Question
    from app.models.user import User


class AssessmentStatus(enum.StrEnum):
    """Lifecycle states implemented so far: DRAFT -> READY -> PUBLISHED.

    `ARCHIVED` (see `docs/PHASE-2-PLAN.md`) is not implemented; adding it is an enum value plus a
    constraint migration, with no table rewrite.
    """

    DRAFT = "DRAFT"
    READY = "READY"
    PUBLISHED = "PUBLISHED"


class QuestionNavigation(enum.StrEnum):
    """How a candidate will be allowed to move through questions.

    No source document specifies the modes (PRD FR-005 only says "navigate questions"), so these two
    are the minimum the exam engine needs; extending them is an enum + constraint migration.
    Phase 2B only stores the choice — the exam runtime honours it from Phase 3.
    """

    FREE = "FREE"
    SEQUENTIAL = "SEQUENTIAL"


class Assessment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An exam being authored by an administrator.

    Named "assessment" per the product owner's Phase 2 plan; the TRD §5 entity list calls this
    `Exam` — the divergence is recorded in `docs/PHASE-2-PLAN.md`.

    No organization association yet: this is a standalone showcase deployment (product owner's
    decision, 2026-09-22). TRD §6 wants tenant association on tenant-sensitive tables, so an
    institutional deployment adds `organization_id` here in a later migration.
    """

    __tablename__ = "assessments"
    __table_args__ = (
        CheckConstraint("duration_minutes > 0", name="ck_assessments_duration_positive"),
        CheckConstraint("total_marks > 0", name="ck_assessments_total_marks_positive"),
        CheckConstraint("passing_marks >= 0", name="ck_assessments_passing_marks_non_negative"),
        CheckConstraint("passing_marks <= total_marks", name="ck_assessments_passing_within_total"),
        CheckConstraint("max_attempts > 0", name="ck_assessments_max_attempts_positive"),
        CheckConstraint(
            "availability_start IS NULL OR availability_end IS NULL OR availability_end > availability_start",
            name="ck_assessments_availability_order",
        ),
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    total_marks: Mapped[int] = mapped_column(Integer, nullable=False)
    passing_marks: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[AssessmentStatus] = mapped_column(
        Enum(AssessmentStatus, name="assessment_status", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=AssessmentStatus.DRAFT,
        index=True,
    )
    # The authoring administrator. RESTRICT: an account that owns assessments cannot be deleted
    # out from under them; reassignment is an explicit action in a later phase.
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    # --- exam settings (stored configuration; the exam runtime honours them from Phase 3) ---
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    randomize_questions: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    randomize_options: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    show_results: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    question_navigation: Mapped[QuestionNavigation] = mapped_column(
        Enum(
            QuestionNavigation,
            name="question_navigation",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
        default=QuestionNavigation.FREE,
        server_default=QuestionNavigation.FREE.value,
    )
    availability_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    availability_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    #: When the assessment was published; null while it is a draft or merely ready.
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped["User"] = relationship(lazy="joined")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="assessment",
        cascade="all, delete-orphan",
        order_by="Question.position",
        passive_deletes=True,
    )
    assignments: Mapped[list["AssessmentAssignment"]] = relationship(
        back_populates="assessment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @property
    def is_published(self) -> bool:
        return self.status is AssessmentStatus.PUBLISHED

    def __repr__(self) -> str:
        return f"<Assessment {self.title!r} {self.status}>"

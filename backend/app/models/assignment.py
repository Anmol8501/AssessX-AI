import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.assessment import Assessment
    from app.models.user import User


class AssignmentStatus(enum.StrEnum):
    """Phase 2C assigns only.

    STARTED / IN_PROGRESS / COMPLETED / EXPIRED arrive with the exam attempt in Phase 3; adding
    them is an enum value plus a constraint migration.
    """

    ASSIGNED = "ASSIGNED"


class AssessmentAssignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One candidate assigned to one published assessment.

    A relational row rather than a list on the assessment, so Phase 3 can hang attempts off it and
    the database can enforce "at most one assignment per candidate per assessment".
    """

    __tablename__ = "assessment_assignments"
    __table_args__ = (
        UniqueConstraint("assessment_id", "candidate_id", name="uq_assignment_assessment_candidate"),
    )

    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The administrator who assigned it. RESTRICT keeps the audit trail intact.
    assigned_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(AssignmentStatus, name="assignment_status", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=AssignmentStatus.ASSIGNED,
    )

    assessment: Mapped["Assessment"] = relationship(back_populates="assignments")
    candidate: Mapped["User"] = relationship(foreign_keys=[candidate_id], lazy="joined")
    assigned_by: Mapped["User"] = relationship(foreign_keys=[assigned_by_id])

    def __repr__(self) -> str:
        return f"<AssessmentAssignment assessment={self.assessment_id} candidate={self.candidate_id}>"

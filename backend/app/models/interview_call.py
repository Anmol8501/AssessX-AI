"""Phase 7D — the live video interview call: one interviewer (an administrator) and one candidate.

**No media is stored or passes through the server.** Video, audio and screen sharing travel
peer-to-peer over WebRTC; the server only relays the connection setup (signaling) between the two
validated participants and keeps the facts of the call: who opened it, when each side joined, when it
ended and by whom, the text chat, and the interviewer's notes. There is no recording.
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.interview import Interview
    from app.models.user import User


class CallStatus(enum.StrEnum):
    OPEN = "OPEN"
    ENDED = "ENDED"


class InterviewCall(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One live call for one assignment. At most one OPEN call per assignment (a partial unique index);
    a later call (a second conversation) is a new row, so every call keeps its own record."""

    __tablename__ = "interview_calls"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN', 'ENDED')", name="ck_interview_calls_status"),
        CheckConstraint(
            "(status = 'ENDED') = (ended_at IS NOT NULL AND ended_by_id IS NOT NULL)",
            name="ck_interview_calls_ended_iff",
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= opened_at", name="ck_interview_calls_end_after_open"
        ),
        Index(
            "uq_interview_calls_one_open",
            "assignment_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
        Index("ix_interview_calls_interview_opened", "interview_id", "opened_at"),
    )

    interview_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False
    )
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_assignments.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[CallStatus] = mapped_column(
        Enum(CallStatus, name="interview_call_status", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=CallStatus.OPEN,
    )
    opened_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    #: The first time the candidate joined (later reconnects do not move it).
    candidate_joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    interview: Mapped["Interview"] = relationship(lazy="joined")
    candidate: Mapped["User"] = relationship(foreign_keys=[candidate_id], lazy="joined")
    opened_by: Mapped["User"] = relationship(foreign_keys=[opened_by_id], lazy="joined")
    ended_by: Mapped["User | None"] = relationship(foreign_keys=[ended_by_id], lazy="joined")

    @property
    def is_open(self) -> bool:
        return self.status is CallStatus.OPEN


class InterviewCallMessage(UUIDPrimaryKeyMixin, Base):
    """A text chat message in the call — visible to both participants. Immutable."""

    __tablename__ = "interview_call_messages"
    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 2000", name="ck_interview_call_messages_body"),
        Index("ix_interview_call_messages_call_sent", "call_id", "sent_at"),
    )

    call_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_calls.id", ondelete="CASCADE"), nullable=False
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    sender: Mapped["User"] = relationship(lazy="joined")


class InterviewCallNote(UUIDPrimaryKeyMixin, Base):
    """The interviewer's private note — human-authored, administrators only, immutable. Never logged."""

    __tablename__ = "interview_call_notes"
    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 4000", name="ck_interview_call_notes_body"),
        Index("ix_interview_call_notes_call_created", "call_id", "created_at"),
    )

    call_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_calls.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    author: Mapped["User"] = relationship(lazy="joined")

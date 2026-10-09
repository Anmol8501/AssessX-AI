"""A short message from a proctor to a candidate during a live exam (exam control, 2026-10-05).

An administrator watching an exam (live video, AI observations) can send the candidate a short warning,
for example "Keep your phone away from the desk". It appears on the candidate's exam screen until they
acknowledge it. Messages are kept with the attempt for review; sending one is audited
(`ATTEMPT_MESSAGE_SENT`, its length only). They are never a verdict and never change a score.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.user import User

#: The longest message a proctor may send.
MAX_MESSAGE_LENGTH = 300


class AttemptMessage(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "attempt_messages"
    __table_args__ = (
        CheckConstraint(
            f"char_length(body) BETWEEN 1 AND {MAX_MESSAGE_LENGTH}", name="ck_attempt_messages_body_length"
        ),
        CheckConstraint(
            "acknowledged_at IS NULL OR acknowledged_at >= sent_at", name="ck_attempt_messages_ack_after_send"
        ),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    #: When the candidate pressed "I understand". Null until then.
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sender: Mapped["User | None"] = relationship(lazy="joined")

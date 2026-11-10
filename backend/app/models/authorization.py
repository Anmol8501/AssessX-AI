"""Phase 3A consumed examination activation tokens (replay prevention)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class ConsumedActivationToken(Base):
    """Persists single-use activation token JTIs once redeemed to block token replay."""

    __tablename__ = "consumed_activation_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_identifier: Mapped[str] = mapped_column(String(64), nullable=False)
    consumed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

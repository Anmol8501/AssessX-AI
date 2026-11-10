"""Device model for Phase 1A device identity and registration."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class Device(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Registered workstation authorized to execute AssessX Secure Exams."""

    __tablename__ = "devices"

    device_identifier: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False)
    platform: Mapped[str] = mapped_column(String(64), nullable=False, default="Windows")
    os_edition: Mapped[str | None] = mapped_column(String(128), nullable=True)
    os_build: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    registered_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    registered_by = relationship("User", foreign_keys=[registered_by_id])

    __table_args__ = (Index("ix_devices_status_platform", "status", "platform"),)

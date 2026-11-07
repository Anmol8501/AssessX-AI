import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.attempt import AssessmentAttempt


class SecondaryCameraStatus(enum.StrEnum):
    PENDING = "PENDING"  # QR created, waiting for mobile scan
    PAIRED = "PAIRED"  # Mobile scanned and paired, requesting camera
    STREAMING = "STREAMING"  # WebRTC stream established
    INTERRUPTED = "INTERRUPTED"  # Stream lost, in grace period
    DISCONNECTED = "DISCONNECTED"  # Disconnected beyond grace period
    COMPLETED = "COMPLETED"  # Exam submitted / ended


class SecondaryCameraSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A secondary-camera pairing and streaming session for one exam attempt."""

    __tablename__ = "secondary_camera_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'PAIRED', 'STREAMING', 'INTERRUPTED', 'DISCONNECTED', 'COMPLETED')",
            name="ck_secondary_camera_sessions_status",
        ),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    pairing_token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
    )
    status: Mapped[SecondaryCameraStatus] = mapped_column(
        Enum(
            SecondaryCameraStatus,
            name="secondary_camera_status",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
        default=SecondaryCameraStatus.PENDING,
        index=True,
    )
    orientation: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="LANDSCAPE",
        server_default="LANDSCAPE",
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    streaming_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    device_info: Mapped[str | None] = mapped_column(String(255), nullable=True)
    battery_level: Mapped[int | None] = mapped_column(Integer, nullable=True)

    attempt: Mapped["AssessmentAttempt"] = relationship(lazy="joined")

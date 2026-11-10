"""Monitoring access audit trail (Phase 4C)."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow


class MonitoringAuditAction(enum.StrEnum):
    """Auditable administrator monitoring actions (Phase 4C)."""

    DASHBOARD_OPENED = "DASHBOARD_OPENED"
    EXAM_SELECTED = "EXAM_SELECTED"
    DETAIL_OPENED = "DETAIL_OPENED"
    STREAM_REQUESTED = "STREAM_REQUESTED"
    STREAM_GRANTED = "STREAM_GRANTED"
    STREAM_DENIED = "STREAM_DENIED"
    STREAM_CONNECTED = "STREAM_CONNECTED"
    STREAM_DISCONNECTED = "STREAM_DISCONNECTED"
    STREAM_ENDED = "STREAM_ENDED"
    ACCESS_EXPIRED = "ACCESS_EXPIRED"


class MonitoringAuditEvent(UUIDPrimaryKeyMixin, Base):
    """Append-only record of administrator live-monitoring views and WebRTC stream access (Phase 4C).

    Captures who observed which candidate/attempt and when, without storing video frames or credentials.
    """

    __tablename__ = "monitoring_audit_events"
    __table_args__ = (
        Index("ix_monitoring_audit_action", "action"),
        Index("ix_monitoring_audit_admin_time", "administrator_id", "created_at"),
        Index("ix_monitoring_audit_attempt_time", "attempt_id", "created_at"),
    )

    administrator_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    assessment_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="SET NULL"), nullable=True
    )
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="SET NULL"), nullable=True
    )
    proctoring_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("proctoring_sessions.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[MonitoringAuditAction] = mapped_column(
        Enum(
            MonitoringAuditAction,
            name="monitoring_audit_action",
            native_enum=False,
            length=32,
            validate_strings=True,
        ),
        nullable=False,
    )
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    def __repr__(self) -> str:
        return f"<MonitoringAuditEvent {self.action} admin={self.administrator_id} attempt={self.attempt_id}>"


class MonitoringStreamGrant(UUIDPrimaryKeyMixin, Base):
    """Persisted short-lived WebRTC stream grant for an administrator watching a candidate (Stage 8)."""

    __tablename__ = "monitoring_stream_grants"
    __table_args__ = (Index("ix_monitoring_stream_grants_admin_attempt", "administrator_id", "attempt_id"),)

    administrator_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    proctoring_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("proctoring_sessions.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

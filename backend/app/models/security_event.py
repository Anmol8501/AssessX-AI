"""Security monitoring (Phase 8 final, CX-02/03/13): security events, alerts, maintenance heartbeats.

Kept apart from the business audit log on purpose: an audit row says *who did what* (append-only, hash
chained); a security event says *something security-relevant happened* — a refused request, a sign-in
attack, abuse of a socket, an integrity failure — and may have no authenticated actor at all. Normal
proctoring observations (a face out of view, a focus change) are never security events.

Nothing secret is stored: no passwords, tokens, keys, URLs, raw video or answer text. Accounts are
referenced by user id when known, otherwise by an HMAC (`account_key`), never by the address typed.
See docs/SECURITY-OPERATIONS.md.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow

SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


class SecurityEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "security_events"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')", name="ck_security_events_severity"
        ),
        Index("ix_security_events_type_occurred", "event_type", "occurred_at"),
        Index("ix_security_events_occurred", "occurred_at"),
        Index("ix_security_events_actor_occurred", "actor_id", "occurred_at"),
        Index("ix_security_events_client_occurred", "client_ip", "occurred_at"),
    )

    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    client_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class SecurityAlert(UUIDPrimaryKeyMixin, Base):
    """One alert raised by a rule (thresholded, deduplicated per rule + group, with a cooldown)."""

    __tablename__ = "security_alerts"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')", name="ck_security_alerts_severity"
        ),
        Index("ix_security_alerts_rule_group_created", "rule", "group_key", "created_at"),
        Index("ix_security_alerts_created", "created_at"),
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    rule: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    #: What the alert is about (e.g. an actor id, an IP, "global") — never a secret.
    group_key: Mapped[str] = mapped_column(String(80), nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[str] = mapped_column(String(300), nullable=False)
    delivery: Mapped[str] = mapped_column(String(20), nullable=False, default="logged")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class MaintenanceHeartbeat(Base):
    """The last time a scheduled job reported in (backups, maintenance) — for "missing run" alerts."""

    __tablename__ = "maintenance_heartbeats"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    last_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str] = mapped_column(String(20), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

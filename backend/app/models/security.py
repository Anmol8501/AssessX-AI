"""Security bookkeeping (Phase 8A): rate-limit hits and one-time password-reset codes.

* `RateLimitHit` — one row per counted event (a failed sign-in, an issued challenge) under a bucket and
  a key. The key is an HMAC of the account or client address under `SECRET_KEY`, never the raw value,
  so the table reveals neither emails nor addresses. Rows older than a day are pruned as new ones arrive.
  Stored in PostgreSQL rather than in memory, so limits hold across restarts and across instances.
* `PasswordResetCode` — a code an administrator issues so a candidate can set a new password (there is
  no email delivery yet). Only an HMAC of the code is stored; it is single-use, short-lived, and issuing a
  new one voids the old ones.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow


class RateLimitHit(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "rate_limit_hits"
    __table_args__ = (Index("ix_rate_limit_hits_bucket_key_at", "bucket", "key", "hit_at"),)

    bucket: Mapped[str] = mapped_column(String(32), nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    hit_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


class PasswordResetCode(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "password_reset_codes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

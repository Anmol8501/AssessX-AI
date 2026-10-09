"""A small sliding-window rate limiter stored in PostgreSQL (Phase 8A, AX-01 / AX-02).

Counts events (`RateLimitHit` rows) per bucket and key within a window. PostgreSQL rather than process
memory, so a limit holds across restarts and across instances, with no new infrastructure. Keys are HMACs
under `SECRET_KEY` — the table never holds an email or an address.

Rows written in a request commit with it — including a request that ends in a handled error
(`DatabaseSessionMiddleware`), which is exactly when a failed sign-in must still be counted.
"""

import hashlib
import hmac
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.base import utcnow
from app.models.security import RateLimitHit

#: How long rows are kept at all (longer than any window).
RETENTION = timedelta(days=1)


class RateLimiter:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.secret = settings.secret_key.encode()

    def key(self, *parts: str) -> str:
        material = "\x1f".join(p.strip().lower() for p in parts)
        return hmac.new(self.secret, material.encode(), hashlib.sha256).hexdigest()

    def count(self, bucket: str, key: str, window: timedelta, now: datetime | None = None) -> int:
        since = (now or utcnow()) - window
        return int(
            self.db.scalar(
                select(func.count())
                .select_from(RateLimitHit)
                .where(RateLimitHit.bucket == bucket, RateLimitHit.key == key, RateLimitHit.hit_at > since)
            )
            or 0
        )

    def retry_after(self, bucket: str, key: str, window: timedelta, now: datetime | None = None) -> int:
        """Seconds until the oldest counted hit leaves the window."""
        now = now or utcnow()
        oldest = self.db.scalar(
            select(func.min(RateLimitHit.hit_at)).where(
                RateLimitHit.bucket == bucket, RateLimitHit.key == key, RateLimitHit.hit_at > now - window
            )
        )
        return max(1, int(((oldest + window) - now).total_seconds())) if oldest else 1

    def hit(self, bucket: str, key: str) -> None:
        now = utcnow()
        self.db.add(RateLimitHit(bucket=bucket, key=key, hit_at=now))
        self.db.flush()
        # Opportunistic pruning, bounded to old rows (an index on hit_at keeps it cheap).
        self.db.execute(delete(RateLimitHit).where(RateLimitHit.hit_at < now - RETENTION))

    def clear(self, bucket: str, key: str) -> None:
        self.db.execute(delete(RateLimitHit).where(RateLimitHit.bucket == bucket, RateLimitHit.key == key))


def enforce_hourly(
    db: Session, settings: Settings, bucket: str, actor_id: object, limit: int, event_type: str
) -> None:
    """At most `limit` uses of `bucket` per actor per hour (downloads, evidence views; CX-12). Refusals are
    recorded as a security event and answered 429."""
    from app.core.errors import RateLimited
    from app.services import security_events

    limiter = RateLimiter(db, settings)
    key = limiter.key(bucket, str(actor_id))
    if limiter.count(bucket, key, timedelta(hours=1)) >= limit:
        security_events.record(event_type, actor_id=actor_id, details={"bucket": bucket, "limit": limit})
        raise RateLimited()
    limiter.hit(bucket, key)

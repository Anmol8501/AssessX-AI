from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow


class LoginChallenge(UUIDPrimaryKeyMixin, Base):
    """A single-use, short-lived login security check (the sign-in form's code image).

    The server draws the image and keeps only a hash of the answer; the client never learns it.
    """

    __tablename__ = "login_challenges"

    answer_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def is_usable(self, now: datetime) -> bool:
        return self.consumed_at is None and self.expires_at > now

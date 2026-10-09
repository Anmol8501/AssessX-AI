import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.auth_session import AuthSession


class UserRole(enum.StrEnum):
    """Initial roles for Phase 1B (roadmap). PRD FR-001 names STUDENT / PROCTOR / INTERVIEWER /
    SUPER_ADMIN as well — extending this enum is tracked as OQ-03, not decided here."""

    ADMIN = "ADMIN"
    CANDIDATE = "CANDIDATE"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Authentication identity. Deliberately minimal for Phase 1B.

    Organization association (TRD §6 tenant isolation) is intentionally not on this table yet:
    the Phase 1B brief asks for the minimum user, and the Organization entity arrives with the
    production foundation. Adding it is a single migration; see the Phase 1B report.
    """

    __tablename__ = "users"
    # Paged list order (Phase 8 final, CX-04; migration 0028).
    __table_args__ = (Index("ix_users_role_created", "role", "created_at"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Second sign-in factor per role (roadmap decision 2026-09-22): candidates sign in with their
    # university roll number, administrators with a username. Each is required for its role
    # and unique across the table (see migration 0002's constraints).
    roll_number: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)
    username: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)

    #: Admin two-factor authentication (TOTP, RFC 6238). The secret is stored encrypted with a key derived
    #: from SECRET_KEY (`services/mfa.py`); recovery codes as HMACs only. `mfa_last_step` is the last
    #: accepted 30-second step, so a code is never accepted twice (anti-replay).
    mfa_secret_enc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mfa_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_last_step: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mfa_recovery_hashes: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def mfa_enabled(self) -> bool:
        return self.mfa_enabled_at is not None and self.mfa_secret_enc is not None

    def __repr__(self) -> str:  # never include secrets
        return f"<User {self.email} {self.role}>"

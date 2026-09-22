import enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, String
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

    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    def __repr__(self) -> str:  # never include secrets
        return f"<User {self.email} {self.role}>"

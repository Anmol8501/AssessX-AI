import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.proctoring import ProctoringSession


class ProctoringEventType(enum.StrEnum):
    """Everything a proctoring session can record (Phase 4B).

    Each is an *observation* — "the candidate left fullscreen", "a paste was attempted" — and none
    is a judgement. Interpreting events (correlation, risk) belongs to a later phase, which reads
    this same table. Future sources (AI observations, identity checks, network) add members here.
    """

    # session lifecycle — recorded by the server
    SESSION_STARTED = "SESSION_STARTED"
    SESSION_RESUMED = "SESSION_RESUMED"
    SESSION_ENDED = "SESSION_ENDED"
    # devices — recorded by the server from the Phase 4A device reports
    CAMERA_DISCONNECTED = "CAMERA_DISCONNECTED"
    CAMERA_RECONNECTED = "CAMERA_RECONNECTED"
    MIC_DISCONNECTED = "MIC_DISCONNECTED"
    MIC_RECONNECTED = "MIC_RECONNECTED"
    # the exam window
    FULLSCREEN_ENTER = "FULLSCREEN_ENTER"
    FULLSCREEN_EXIT = "FULLSCREEN_EXIT"
    FULLSCREEN_RESTORED = "FULLSCREEN_RESTORED"
    FOCUS_LOST = "FOCUS_LOST"
    FOCUS_REGAINED = "FOCUS_REGAINED"
    # input that the exam environment restricts
    COPY_ATTEMPT = "COPY_ATTEMPT"
    CUT_ATTEMPT = "CUT_ATTEMPT"
    PASTE_ATTEMPT = "PASTE_ATTEMPT"
    CLIPBOARD_ACCESS_ATTEMPT = "CLIPBOARD_ACCESS_ATTEMPT"
    CONTEXT_MENU_ATTEMPT = "CONTEXT_MENU_ATTEMPT"
    PRINT_ATTEMPT = "PRINT_ATTEMPT"
    DEVTOOLS_ATTEMPT = "DEVTOOLS_ATTEMPT"
    KEYBOARD_RESTRICTION_ATTEMPT = "KEYBOARD_RESTRICTION_ATTEMPT"
    SCREEN_CAPTURE_ATTEMPT = "SCREEN_CAPTURE_ATTEMPT"
    # the machine
    MULTIPLE_MONITORS_DETECTED = "MULTIPLE_MONITORS_DETECTED"
    DISPLAY_CONFIGURATION_CHANGED = "DISPLAY_CONFIGURATION_CHANGED"
    REMOTE_SESSION_DETECTED = "REMOTE_SESSION_DETECTED"
    #: Which protections the client could actually switch on — diagnostics, not an accusation.
    ENFORCEMENT_STATUS = "ENFORCEMENT_STATUS"
    # device readiness (4B.5) — the pre-exam check of open applications. Observed before the
    # attempt starts and reported once the session is active; see services/proctoring_events.py.
    DEVICE_CHECK_STARTED = "DEVICE_CHECK_STARTED"
    PROHIBITED_APP_DETECTED = "PROHIBITED_APP_DETECTED"
    APP_CLOSE_REQUESTED = "APP_CLOSE_REQUESTED"
    APP_CLOSED = "APP_CLOSED"
    APP_CLOSE_FAILED = "APP_CLOSE_FAILED"
    DEVICE_CHECK_PASSED = "DEVICE_CHECK_PASSED"
    DEVICE_CHECK_FAILED = "DEVICE_CHECK_FAILED"


class ProctoringEventCategory(enum.StrEnum):
    """A coarse grouping derived by the server from the event type, never sent by a client."""

    SESSION = "SESSION"
    DEVICE = "DEVICE"
    WINDOW = "WINDOW"
    INPUT = "INPUT"
    DISPLAY = "DISPLAY"
    SYSTEM = "SYSTEM"


class ProctoringEventSource(enum.StrEnum):
    """Who recorded the event. Set by the server: a client cannot claim to be the server."""

    SERVER = "SERVER"
    CLIENT = "CLIENT"


class ProctoringEvent(UUIDPrimaryKeyMixin, Base):
    """One observation recorded during a proctoring session (TRD §5 `ProctoringEvent`).

    **Append-only.** There is no update or delete path anywhere in the API; the table has no
    `updated_at` for that reason. (Database-level immutability — revoked grants, hash chaining —
    is the open audit-log decision OQ-12.)

    **The server's clock is the authority.** `recorded_at` is written by the server when the event
    arrives. `client_reported_at` is what the desktop app said, kept separately and only when it
    is plausible, because an event queued while offline arrives late; it is never used in place of
    `recorded_at`.

    **Minimal detail.** `details` holds a few validated, typed fields per event type (see
    `services/proctoring_events.py`) — a shortcut name, a duration, a display count. Clipboard
    contents, keystrokes, answers, window titles, file paths and command lines are never accepted;
    device-readiness events name an application only by its policy identifier (e.g. `chrome`).

    Reached only through its session, and the session only through its attempt, so the ownership
    check is the attempt's (`attempt.candidate_id`), made once in `AttemptService`.
    """

    __tablename__ = "proctoring_events"
    __table_args__ = (
        # A retried request carries the same client id and does not create a second row.
        UniqueConstraint("session_id", "client_event_id", name="uq_proctoring_event_client_id"),
        Index("ix_proctoring_events_session_recorded", "session_id", "recorded_at"),
        CheckConstraint(
            "source IN ('SERVER', 'CLIENT')",
            name="ck_proctoring_events_source",
        ),
        CheckConstraint(
            "category IN ('SESSION', 'DEVICE', 'WINDOW', 'INPUT', 'DISPLAY', 'SYSTEM')",
            name="ck_proctoring_events_category",
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("proctoring_sessions.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[ProctoringEventType] = mapped_column(
        Enum(
            ProctoringEventType,
            name="proctoring_event_type",
            native_enum=False,
            length=40,
            validate_strings=True,
        ),
        nullable=False,
        index=True,
    )
    category: Mapped[ProctoringEventCategory] = mapped_column(
        Enum(
            ProctoringEventCategory,
            name="proctoring_event_category",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
    )
    source: Mapped[ProctoringEventSource] = mapped_column(
        Enum(
            ProctoringEventSource,
            name="proctoring_event_source",
            native_enum=False,
            length=10,
            validate_strings=True,
        ),
        nullable=False,
    )
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: The client's idempotency key. Null for server-recorded events.
    client_event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: Authoritative: when the server recorded the event.
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    #: What the client said, when plausible. Informational only.
    client_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["ProctoringSession"] = relationship(back_populates="events")

    def __repr__(self) -> str:
        return f"<ProctoringEvent {self.event_type} session={self.session_id}>"

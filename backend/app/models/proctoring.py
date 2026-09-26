import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.attempt import AssessmentAttempt
    from app.models.proctoring_event import ProctoringEvent


class ProctoringSessionStatus(enum.StrEnum):
    """Where a proctoring session is in its life. Three states, one direction.

    `NOT_STARTED` exists from the moment a proctored attempt is created until the candidate's
    devices are confirmed; `ACTIVE` is the exam running under proctoring; `ENDED` is terminal and
    follows the attempt becoming terminal (submitted or out of time). Nothing moves a session
    backwards, and a session can go straight from `NOT_STARTED` to `ENDED` when the attempt ends
    before the devices were ever confirmed.
    """

    NOT_STARTED = "NOT_STARTED"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"


class DeviceState(enum.StrEnum):
    """What the candidate's desktop app last reported about one device.

    This is *availability*, not observation: whether a camera/microphone stream could be opened,
    never what it shows or hears. Deliberately nothing here about faces, people or voices — those
    are later phases, and belong in proctoring events rather than in a device flag.

    `NOT_READY` covers "not checked yet" and "could not be opened for a reason other than the two
    below" (for example, in use by another application); the candidate-facing message comes from
    the client, which saw the actual error.
    """

    NOT_READY = "NOT_READY"
    READY = "READY"
    DENIED = "DENIED"
    UNAVAILABLE = "UNAVAILABLE"


class ProctoringSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The proctoring side of one exam attempt (TRD §5 `ProctoringSession`; Phase 4A).

    **One per attempt, and only for attempts that were proctored when they started.** The row is
    created in the same transaction as the attempt, when the assessment has `proctoring_required`
    set; its existence is what makes that attempt proctored from then on. Changing the assessment's
    setting later therefore cannot turn proctoring on or off under an attempt already running.

    No `candidate_id` column: the attempt already carries it, and every lookup is scoped through
    the attempt (`attempt.candidate_id == the signed-in user`). A second copy could only disagree.

    **Every timestamp is the server's.** `started_at` is set when the session is activated,
    `ended_at` when the attempt finalizes (for a timeout, the attempt's deadline — the moment the
    exam really ended), and `devices_reported_at` whenever the client reports device state. No
    request carries a time.

    Nothing is recorded: no frames, no audio, no images. The client opens the camera and
    microphone locally to confirm they work and shows the candidate their own preview; only the
    resulting states reach the server.
    """

    __tablename__ = "proctoring_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('NOT_STARTED', 'ACTIVE', 'ENDED')", name="ck_proctoring_sessions_status"),
        CheckConstraint(
            "camera_state IN ('NOT_READY', 'READY', 'DENIED', 'UNAVAILABLE')",
            name="ck_proctoring_sessions_camera_state",
        ),
        CheckConstraint(
            "microphone_state IN ('NOT_READY', 'READY', 'DENIED', 'UNAVAILABLE')",
            name="ck_proctoring_sessions_microphone_state",
        ),
        # The lifecycle, held by the database as well as the service: an active session has a
        # start, an ended one has an end, and a session that never started cannot claim one.
        CheckConstraint(
            "status = 'NOT_STARTED' OR status = 'ENDED' OR started_at IS NOT NULL",
            name="ck_proctoring_sessions_active_has_start",
        ),
        CheckConstraint(
            "(status = 'ENDED') = (ended_at IS NOT NULL)",
            name="ck_proctoring_sessions_ended_iff_ended_at",
        ),
        CheckConstraint(
            "status <> 'NOT_STARTED' OR started_at IS NULL",
            name="ck_proctoring_sessions_not_started_has_no_start",
        ),
        CheckConstraint(
            "started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at",
            name="ck_proctoring_sessions_end_after_start",
        ),
    )

    #: Unique: an attempt has at most one proctoring session.
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    status: Mapped[ProctoringSessionStatus] = mapped_column(
        Enum(
            ProctoringSessionStatus,
            name="proctoring_session_status",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
        default=ProctoringSessionStatus.NOT_STARTED,
        index=True,
    )
    camera_state: Mapped[DeviceState] = mapped_column(
        Enum(DeviceState, name="device_state", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=DeviceState.NOT_READY,
    )
    microphone_state: Mapped[DeviceState] = mapped_column(
        Enum(DeviceState, name="device_state", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=DeviceState.NOT_READY,
    )
    #: When the session was activated (devices confirmed). Null until then.
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: When the session ended — the attempt's `finalized_at`. Null while it is not ended.
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The last time the client reported device state. The foundation of session health for the
    #: live-monitoring phase; nothing acts on its age yet.
    devices_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attempt: Mapped["AssessmentAttempt"] = relationship(back_populates="proctoring_session")
    #: Phase 4B observations, oldest first. Append-only; see `ProctoringEvent`.
    events: Mapped[list["ProctoringEvent"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProctoringEvent.recorded_at",
    )

    @property
    def is_active(self) -> bool:
        return self.status is ProctoringSessionStatus.ACTIVE

    @property
    def is_ended(self) -> bool:
        return self.status is ProctoringSessionStatus.ENDED

    def __repr__(self) -> str:
        return f"<ProctoringSession attempt={self.attempt_id} {self.status}>"

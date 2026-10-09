"""Evidence clips: short camera recordings around qualifying factual events (PRD FR-017).

A clip is *supporting context for human review*. It never states or implies that anything improper
happened — the event says what was observed, the clip shows the moment, a person decides.

Every identifying field is the server's: the clip id, its attempt/candidate/assessment/session, the
event that triggered it, the storage key and the hash. The candidate's app only ever supplies the video
bytes for a clip the server already created, and a reported duration (bounded).
See docs/EVIDENCE-CLIPS.md.
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.proctoring_event import ProctoringEvent


class EvidenceClipStatus(enum.StrEnum):
    """A clip's life, in one direction.

    `CREATING` — the server accepted a qualifying event and is waiting for the app to upload the
    recording. `READY` — stored and hashed. `FAILED` — the recording or upload did not happen (the event
    still stands on its own). `EXPIRED` — the retention period ended and the video was deleted.
    `DELETED` — an administrator deleted the video. Metadata is kept in every state.
    """

    CREATING = "CREATING"
    READY = "READY"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    DELETED = "DELETED"


class EvidenceSource(enum.StrEnum):
    """Which camera produced a clip. Only the primary webcam exists today; the secondary (phone) camera
    is reserved so that adding it later needs no second evidence system."""

    PRIMARY_CAMERA = "PRIMARY_CAMERA"
    SECONDARY_CAMERA = "SECONDARY_CAMERA"


#: Why a clip ended FAILED. Client-reported reasons are a closed list; the rest are the server's.
CLIENT_FAILURE_REASONS = frozenset(
    {"recorder_unavailable", "recording_failed", "capture_interrupted", "too_large", "upload_failed"}
)
SERVER_FAILURE_REASONS = frozenset({"upload_missing", "invalid_content", "storage_error"})


class EvidenceClip(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "evidence_clips"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CREATING', 'READY', 'FAILED', 'EXPIRED', 'DELETED')", name="ck_evidence_clips_status"
        ),
        CheckConstraint(
            "source_type IN ('PRIMARY_CAMERA', 'SECONDARY_CAMERA')", name="ck_evidence_clips_source_type"
        ),
        CheckConstraint("window_ends_at > window_starts_at", name="ck_evidence_clips_window"),
        CheckConstraint(
            "status <> 'READY' OR (storage_key IS NOT NULL AND sha256 IS NOT NULL AND byte_size > 0 "
            "AND content_type IS NOT NULL AND retain_until IS NOT NULL)",
            name="ck_evidence_clips_ready_complete",
        ),
        CheckConstraint("sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'", name="ck_evidence_clips_sha256"),
        CheckConstraint("byte_size IS NULL OR byte_size > 0", name="ck_evidence_clips_byte_size"),
        CheckConstraint(
            "duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 600000)",
            name="ck_evidence_clips_duration",
        ),
        CheckConstraint("upload_attempts >= 0", name="ck_evidence_clips_upload_attempts"),
        Index("ix_evidence_clips_session_created", "proctoring_session_id", "created_at"),
        Index("ix_evidence_clips_status_deadline", "status", "upload_deadline"),
        Index("ix_evidence_clips_status_retain", "status", "retain_until"),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    proctoring_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("proctoring_sessions.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: The event that created the clip (also in `evidence_clip_events`, with any others it covers).
    trigger_event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("proctoring_events.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    source_type: Mapped[EvidenceSource] = mapped_column(
        Enum(EvidenceSource, name="evidence_source", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=EvidenceSource.PRIMARY_CAMERA,
    )
    status: Mapped[EvidenceClipStatus] = mapped_column(
        Enum(
            EvidenceClipStatus,
            name="evidence_clip_status",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
        default=EvidenceClipStatus.CREATING,
    )
    #: The trigger event's server time, and the window planned around it (server clock). The video's
    #: own timing comes from the candidate's device and is approximate to within network delay.
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    pre_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    post_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    #: After this, a clip still CREATING is marked FAILED (`upload_missing`).
    upload_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    upload_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    #: Server-generated, unpredictable object name. Never derived from ids, never sent to any client.
    storage_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    content_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: Length the app reported for the recording (bounded on upload). Informational.
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hash_algorithm: Mapped[str] = mapped_column(String(16), nullable=False, default="sha256")
    #: SHA-256 of the stored bytes, computed by the server on upload; checked again on every view.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: When the video is due for deletion (retention). Set when the clip becomes READY.
    retain_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    deletion_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    events: Mapped[list["ProctoringEvent"]] = relationship(
        secondary="evidence_clip_events", order_by="ProctoringEvent.recorded_at", viewonly=True
    )

    @property
    def has_video(self) -> bool:
        return self.status is EvidenceClipStatus.READY

    def __repr__(self) -> str:
        return f"<EvidenceClip {self.id} {self.status}>"


class EvidenceClipEvent(Base):
    """Which events a clip covers. An event belongs to at most one clip: three related events within
    one capture window share one clip rather than producing three videos."""

    __tablename__ = "evidence_clip_events"

    clip_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("evidence_clips.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("proctoring_events.id", ondelete="CASCADE"), primary_key=True, unique=True
    )
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

"""Evidence clip shapes for administrators (FR-017).

What a reviewer needs to judge a clip — its events, camera, window, integrity and lifecycle — and nothing
that could reach the video without the API: no storage key, URL, bucket or signed link is ever part of a
response. The video itself is only available from the `/media` route, after authorization and an
integrity check.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.evidence_clip import EvidenceClip, EvidenceClipStatus, EvidenceSource
from app.models.proctoring_event import ProctoringEventType

INTERPRETATION = (
    "An evidence clip is supporting context recorded around a factual event. It does not establish that "
    "anything improper happened; a person reviews it and decides."
)


class EvidenceClipEventOut(BaseModel):
    event_id: uuid.UUID
    event_type: ProctoringEventType
    recorded_at: datetime
    #: True for the event that caused the clip to be recorded.
    trigger: bool


class EvidenceClipRef(BaseModel):
    """The short form attached to a 6B evidence item whose event has a clip."""

    clip_id: uuid.UUID
    status: EvidenceClipStatus
    source_type: EvidenceSource
    duration_ms: int | None
    has_video: bool


class EvidenceClipOut(BaseModel):
    clip_id: uuid.UUID
    attempt_id: uuid.UUID
    assessment_id: uuid.UUID
    candidate_id: uuid.UUID
    proctoring_session_id: uuid.UUID
    trigger_event_id: uuid.UUID
    source_type: EvidenceSource
    status: EvidenceClipStatus
    has_video: bool
    event_at: datetime
    window_starts_at: datetime
    window_ends_at: datetime
    pre_seconds: int
    post_seconds: int
    duration_ms: int | None
    content_type: str | None
    byte_size: int | None
    hash_algorithm: str
    sha256: str | None
    created_at: datetime
    ready_at: datetime | None
    failed_at: datetime | None
    failure_reason: str | None
    retain_until: datetime | None
    expired_at: datetime | None
    deleted_at: datetime | None
    deletion_reason: str | None
    events: list[EvidenceClipEventOut]

    @classmethod
    def of(cls, clip: EvidenceClip) -> "EvidenceClipOut":
        return cls(
            clip_id=clip.id,
            attempt_id=clip.attempt_id,
            assessment_id=clip.assessment_id,
            candidate_id=clip.candidate_id,
            proctoring_session_id=clip.proctoring_session_id,
            trigger_event_id=clip.trigger_event_id,
            source_type=clip.source_type,
            status=clip.status,
            has_video=clip.has_video,
            event_at=clip.event_at,
            window_starts_at=clip.window_starts_at,
            window_ends_at=clip.window_ends_at,
            pre_seconds=clip.pre_seconds,
            post_seconds=clip.post_seconds,
            duration_ms=clip.duration_ms,
            content_type=clip.content_type,
            byte_size=clip.byte_size,
            hash_algorithm=clip.hash_algorithm,
            sha256=clip.sha256,
            created_at=clip.created_at,
            ready_at=clip.ready_at,
            failed_at=clip.failed_at,
            failure_reason=clip.failure_reason,
            retain_until=clip.retain_until,
            expired_at=clip.expired_at,
            deleted_at=clip.deleted_at,
            deletion_reason=clip.deletion_reason,
            events=[
                EvidenceClipEventOut(
                    event_id=e.id,
                    event_type=e.event_type,
                    recorded_at=e.recorded_at,
                    trigger=e.id == clip.trigger_event_id,
                )
                for e in clip.events
            ],
        )

    @staticmethod
    def ref(clip: EvidenceClip) -> EvidenceClipRef:
        return EvidenceClipRef(
            clip_id=clip.id,
            status=clip.status,
            source_type=clip.source_type,
            duration_ms=clip.duration_ms,
            has_video=clip.has_video,
        )


class EvidenceClipList(BaseModel):
    attempt_id: uuid.UUID
    retention_days: int
    clips: list[EvidenceClipOut]
    interpretation: str = INTERPRETATION


class EvidenceIntegrityOut(BaseModel):
    clip_id: uuid.UUID
    algorithm: Literal["sha256"]
    expected_sha256: str
    actual_sha256: str | None
    byte_size: int | None
    verified: bool
    checked_at: datetime


class EvidenceDeleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)

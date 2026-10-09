"""Proctoring session shapes (Phase 4A).

The request shapes carry device states and nothing else. There is no field for a timestamp, a
status, a candidate or an attempt: the attempt comes from the URL and is checked against the
signed-in candidate, the status moves only through the service's transitions, and every time is
the server's own. Extra fields sent with a device report are ignored; an event report refuses
them (`ProctoringEventIn`).
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.proctoring import DeviceState, ProctoringSessionStatus
from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventSource, ProctoringEventType


class DeviceReport(BaseModel):
    """What the candidate's app can currently open. Reported, not proven — see the service."""

    camera: DeviceState
    microphone: DeviceState
    #: On activation: whether this app can record evidence clips (FR-017). Ignored on later reports.
    evidence_recorder: bool = False


class EvidencePolicyOut(BaseModel):
    """How the app records evidence clips, and what the candidate is told (all server settings).

    Only short clips around qualifying factual events, video only (no audio), bounded in length, size
    and quality, kept for `retention_days`. Nothing is recorded continuously.
    """

    enabled: bool
    event_types: list[str]
    pre_seconds: int
    post_seconds: int
    max_clip_seconds: int
    max_clip_bytes: int
    video_bits_per_second: int
    max_width: int
    max_height: int
    frame_rate: int
    retention_days: int


def current_evidence_policy() -> EvidencePolicyOut:
    from dataclasses import asdict

    from app.services.evidence_clips.service import policy

    values = asdict(policy())
    values["event_types"] = list(values["event_types"])
    return EvidencePolicyOut(**values)


class ProctoringSessionOut(BaseModel):
    """A proctoring session as its own candidate sees it.

    Deliberately limited to lifecycle and device availability. Face, people, gaze or risk fields
    do not belong here — those are observations for later phases, and will arrive as events.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    attempt_id: uuid.UUID
    status: ProctoringSessionStatus
    camera_state: DeviceState
    microphone_state: DeviceState
    started_at: datetime | None
    ended_at: datetime | None
    devices_reported_at: datetime | None
    #: Evidence clips (FR-017): what the app may record, and nothing beyond it.
    recording: EvidencePolicyOut = Field(default_factory=current_evidence_policy)


class ProctoringEventIn(BaseModel):
    """One observation reported by the candidate's app (Phase 4B).

    Unknown fields are refused rather than ignored, so a request cannot even *attempt* to set a
    severity, a verdict, a candidate or a timestamp the server owns. `metadata` is checked field by
    field against the event type's allow-list in `services/proctoring_events.py`.

    `client_event_id` makes a retry safe: the same id returns the original event.
    `client_reported_at` is kept only as an informational hint; the server's `recorded_at` is the
    authoritative time.
    """

    model_config = ConfigDict(extra="forbid")

    event_type: ProctoringEventType
    metadata: dict[str, Any] = Field(default_factory=dict, max_length=8)
    client_event_id: uuid.UUID
    client_reported_at: datetime | None = None


class ProctoringEventOut(BaseModel):
    """An event as recorded. `category` and `source` are the server's, not the client's."""

    id: uuid.UUID
    event_type: ProctoringEventType
    category: ProctoringEventCategory
    source: ProctoringEventSource
    metadata: dict[str, Any]
    recorded_at: datetime
    client_reported_at: datetime | None
    #: Set when the server created (or linked this event to) an evidence clip. `upload` is true only
    #: for a new clip: the app then sends the recording it captured around this event.
    clip_request: "EvidenceRequestOut | None" = None


class EvidenceRequestOut(BaseModel):
    clip_id: uuid.UUID
    upload: bool


class EvidenceUploadOut(BaseModel):
    """The candidate's app learns only that its upload was accepted — not the hash or where it went."""

    clip_id: uuid.UUID
    status: Literal["READY", "FAILED"]


class EvidenceFailureIn(BaseModel):
    """Why the app could not provide a clip. A closed list; anything else is refused."""

    model_config = ConfigDict(extra="forbid")

    reason: Literal[
        "recorder_unavailable", "recording_failed", "capture_interrupted", "too_large", "upload_failed"
    ]


ProctoringEventOut.model_rebuild()

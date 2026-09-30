"""Proctoring session shapes (Phase 4A).

The request shapes carry device states and nothing else. There is no field for a timestamp, a
status, a candidate or an attempt: the attempt comes from the URL and is checked against the
signed-in candidate, the status moves only through the service's transitions, and every time is
the server's own. Extra fields sent with a device report are ignored; an event report refuses
them (`ProctoringEventIn`).
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.proctoring import DeviceState, ProctoringSessionStatus
from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventSource, ProctoringEventType


class DeviceReport(BaseModel):
    """What the candidate's app can currently open. Reported, not proven — see the service."""

    camera: DeviceState
    microphone: DeviceState


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

"""Admin live-monitoring shapes (Phase 4C).

Factual technical state only: who is in an active proctored exam, their device and session status,
and their recent proctoring events. No answers, no scores, no risk, no verdicts, and nothing
sensitive (passwords, tokens, hashes). The candidate is named only as the wall needs.
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models.attempt import AttemptStatus
from app.models.proctoring import DeviceState, ProctoringSessionStatus
from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType


class MonitoringSession(BaseModel):
    """One candidate tile on the live wall."""

    attempt_id: uuid.UUID
    proctoring_session_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_roll_number: str | None
    assessment_id: uuid.UUID
    assessment_title: str
    attempt_status: AttemptStatus
    proctoring_status: ProctoringSessionStatus
    camera_state: DeviceState
    microphone_state: DeviceState
    #: Derived from the latest window event: True fullscreen, False exited, None unknown.
    fullscreen: bool | None
    started_at: datetime | None
    devices_reported_at: datetime | None


class MonitoringSummary(BaseModel):
    """Factual counts across the active wall — never risk or suspicion counts."""

    active_sessions: int
    cameras_ready: int
    camera_issues: int
    microphone_issues: int


class ActiveSessions(BaseModel):
    summary: MonitoringSummary
    sessions: list[MonitoringSession]


class MonitoringEvent(BaseModel):
    """One recent proctoring event, as the detail view lists it."""

    id: uuid.UUID
    event_type: ProctoringEventType
    category: ProctoringEventCategory
    metadata: dict[str, Any]
    recorded_at: datetime


class MonitoringDetail(MonitoringSession):
    """The candidate detail view: the tile data plus recent factual events."""

    recent_events: list[MonitoringEvent]

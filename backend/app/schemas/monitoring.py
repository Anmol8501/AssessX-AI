"""Admin live-monitoring shapes (Phase 4C).

Factual technical state only: who is in an active proctored exam, their device and session status,
and their recent proctoring events. No answers, no scores, no risk, no verdicts, and nothing
sensitive (passwords, tokens, hashes). The candidate is named only as the wall needs.
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.models.attempt import AttemptStatus
from app.models.monitoring_audit import MonitoringAuditAction
from app.models.proctoring import DeviceState, ProctoringSessionStatus
from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType


class AIActiveObservation(BaseModel):
    """An AI observation episode that has started and not yet resolved (Phase 5C)."""

    event_type: ProctoringEventType
    started_at: datetime
    #: Factual measurements recorded when the episode started (e.g. direction, face_count).
    metadata: dict[str, Any]


class AIMonitoringState(BaseModel):
    """What the candidate's on-device AI currently reports (Phase 5C) — observations, never a verdict.

    Derived by the server from the stored AI events: `status` from the latest AI_STATUS, the
    indicators from which observation episodes are open. "unknown" whenever the AI is not running or
    the detector behind an indicator is impaired — it is never guessed. "forward" means no sustained
    head-turn episode is open, not that every frame was forward. Head orientation is measured
    against the candidate's own calibrated neutral yaw. `gaze` is always "not_used": gaze is not an
    event signal (GAZE_AWAY is disabled), so the admin view does not present it as one.
    """

    status: str | None
    reason: str | None
    impaired: list[str]
    face: str  # detected | not_detected | unknown
    face_count: str  # one | multiple | none | unknown
    head_orientation: str  # forward | left | right | unknown (up/down only on rows from before 2026-09-30)
    gaze: str  # not_used
    camera_quality: str  # good | issue | unknown
    #: Objects in view (2026-10-02): "detected" while an object episode is open (and which classes),
    #: "none" while the object detector is measuring and none is, "unknown" when it is not measuring.
    objects: str = "unknown"  # detected | none | unknown
    objects_seen: list[str] = []  # cell_phone | book | laptop | remote
    active: list[AIActiveObservation]


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
    #: The on-device AI's current factual state (Phase 5C).
    ai: AIMonitoringState
    #: Whether the candidate's app currently holds its live connection to the server — False when
    #: the app was closed, the laptop slept or its network dropped. Live state, not persisted.
    candidate_connected: bool = False
    #: When that last changed (None if the server has not seen the candidate app since it started).
    candidate_presence_changed_at: datetime | None = None
    #: Exam control: tab switches counted by the server, and whether the attempt is on hold.
    tab_switches: int = 0
    tab_switch_limit: int = 3
    on_hold: bool = False
    hold_reason: str | None = None
    held_at: datetime | None = None
    interruption_count: int = 0
    readiness_state: str | None = None
    selected_camera_label: str | None = None
    selected_microphone_label: str | None = None


class MonitoringSummary(BaseModel):
    """Factual counts across the active wall — never risk or suspicion counts."""

    active_sessions: int
    cameras_ready: int
    camera_issues: int
    microphone_issues: int
    on_hold_count: int = 0


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


class MonitoringExamSummary(BaseModel):
    """Operational metrics for one monitorable examination (Phase 4C)."""

    assessment_id: uuid.UUID
    title: str
    status: str
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    total_assigned: int = 0
    active_sessions: int = 0
    submitted_count: int = 0
    interrupted_count: int = 0
    proctoring_enabled: bool = True


class MonitoringExamList(BaseModel):
    exams: list[MonitoringExamSummary]


class StreamAuthorizationGrant(BaseModel):
    """Short-lived stream viewing authorization issued after audit validation (Phase 4C)."""

    stream_grant_id: uuid.UUID
    attempt_id: uuid.UUID
    proctoring_session_id: uuid.UUID
    expires_at: datetime
    ice_policy: str = "stun_turn_relay"


class MonitoringAuditOut(BaseModel):
    """Serialized administrator monitoring audit log record."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    administrator_id: uuid.UUID
    assessment_id: uuid.UUID | None = None
    attempt_id: uuid.UUID | None = None
    proctoring_session_id: uuid.UUID | None = None
    action: MonitoringAuditAction
    details: dict[str, Any]
    created_at: datetime


class MonitoringAuditList(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[MonitoringAuditOut]

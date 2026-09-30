"""Live admin monitoring (Phase 4C): read-only views over the existing proctoring state.

This service invents nothing. "Monitorable" is an active attempt with an `ACTIVE` proctoring
session; every field it returns comes from the Phase 4A session and the Phase 4B/4B.5 events. It
builds the tile/detail/summary shapes and the delta messages the hub broadcasts, and it derives a
couple of convenience values (fullscreen from the latest window event, the summary counts).

It also owns the *content* of a realtime delta so the WebSocket layer and the REST layer agree on
exactly what a session looks like.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.attempt import AssessmentAttempt
from app.models.proctoring import DeviceState, ProctoringSession
from app.models.proctoring_event import ProctoringEvent, ProctoringEventType
from app.realtime.hub import hub
from app.realtime.messages import MessageType, message
from app.repositories.monitoring import MonitoringRepository
from app.schemas.monitoring import (
    ActiveSessions,
    AIActiveObservation,
    AIMonitoringState,
    MonitoringDetail,
    MonitoringEvent,
    MonitoringSession,
    MonitoringSummary,
)
from app.services.proctoring_events import open_episodes

#: How many recent events the detail view returns. Recent window, not a full history/timeline.
RECENT_EVENT_LIMIT = 40

#: Window events, newest-first, that tell us whether the exam is in fullscreen right now.
_FULLSCREEN_TRUE = frozenset({ProctoringEventType.FULLSCREEN_ENTER, ProctoringEventType.FULLSCREEN_RESTORED})
_FULLSCREEN_FALSE = frozenset({ProctoringEventType.FULLSCREEN_EXIT})


class MonitoringService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = MonitoringRepository(db)

    # -- REST ----------------------------------------------------------------------------

    def active(self) -> ActiveSessions:
        sessions = [self._tile(s) for s in self.repo.active_sessions()]
        cameras_ready = sum(1 for s in sessions if s.camera_state is DeviceState.READY)
        camera_issues = sum(1 for s in sessions if s.camera_state is not DeviceState.READY)
        mic_issues = sum(1 for s in sessions if s.microphone_state is not DeviceState.READY)
        return ActiveSessions(
            summary=MonitoringSummary(
                active_sessions=len(sessions),
                cameras_ready=cameras_ready,
                camera_issues=camera_issues,
                microphone_issues=mic_issues,
            ),
            sessions=sessions,
        )

    def detail(self, attempt_id: uuid.UUID) -> MonitoringDetail | None:
        session = self.repo.session_for_attempt(attempt_id)
        if session is None:
            return None
        events = self.repo.recent_events(session.id, RECENT_EVENT_LIMIT)
        tile = self._tile(session, events=events)
        return MonitoringDetail(
            **tile.model_dump(),
            recent_events=[self._event(e) for e in events],
        )

    # -- realtime deltas (used by the hub) -----------------------------------------------

    def session_delta(self, attempt_id: uuid.UUID) -> dict:
        """`SESSION_ADDED`/`SESSION_UPDATED` payload for one attempt, or `SESSION_REMOVED`.

        Computed from current state, so an admin applying it ends up consistent with a REST refresh.
        """
        session = self.repo.session_for_attempt(attempt_id)
        if session is None or not (session.is_active and session.attempt.is_active):
            return message(MessageType.SESSION_REMOVED, attempt_id=str(attempt_id))
        return message(MessageType.SESSION_UPDATED, session=self._tile(session).model_dump(mode="json"))

    def event_delta(self, session: ProctoringSession, event: ProctoringEvent) -> dict:
        return message(
            MessageType.PROCTORING_EVENT,
            attempt_id=str(session.attempt_id),
            event=self._event(event).model_dump(mode="json"),
        )

    # -- shaping -------------------------------------------------------------------------

    def _tile(
        self, session: ProctoringSession, events: list[ProctoringEvent] | None = None
    ) -> MonitoringSession:
        attempt: AssessmentAttempt = session.attempt
        candidate_connected, presence_changed_at = hub.presence(attempt.id)
        return MonitoringSession(
            attempt_id=attempt.id,
            proctoring_session_id=session.id,
            candidate_id=attempt.candidate_id,
            candidate_name=attempt.candidate.name,
            candidate_roll_number=attempt.candidate.roll_number,
            assessment_id=attempt.assessment_id,
            assessment_title=attempt.assessment.title,
            attempt_status=attempt.status,
            proctoring_status=session.status,
            camera_state=session.camera_state,
            microphone_state=session.microphone_state,
            fullscreen=self._fullscreen(session, events),
            started_at=session.started_at,
            devices_reported_at=session.devices_reported_at,
            ai=derive_ai_state(self.repo.ai_events(session.id)),
            candidate_connected=candidate_connected,
            candidate_presence_changed_at=presence_changed_at,
        )

    def _fullscreen(self, session: ProctoringSession, events: list[ProctoringEvent] | None) -> bool | None:
        # Reuse events already loaded for the detail view; otherwise ask for a couple.
        recent = events if events is not None else self.repo.recent_events(session.id, 10)
        for event in recent:  # recent is newest-first
            if event.event_type in _FULLSCREEN_TRUE:
                return True
            if event.event_type in _FULLSCREEN_FALSE:
                return False
        return None

    @staticmethod
    def _event(event: ProctoringEvent) -> MonitoringEvent:
        return MonitoringEvent(
            id=event.id,
            event_type=event.event_type,
            category=event.category,
            metadata=event.details,
            recorded_at=event.recorded_at,
        )


# -- AI state (Phase 5C) -----------------------------------------------------------------------

_E = ProctoringEventType
_QUALITY = frozenset({_E.CAMERA_TOO_DARK, _E.FACE_TOO_FAR, _E.FACE_TOO_CLOSE})
_MEASURING = frozenset({"RUNNING", "DEGRADED"})


def derive_ai_state(events: list[ProctoringEvent]) -> AIMonitoringState:
    """The on-device AI's current factual state from a session's AI events (oldest first).

    Pure: the same events always give the same state, so REST and realtime deltas agree.
    """
    status: str | None = None
    reason: str | None = None
    impaired: list[str] = []
    for event in events:
        if event.event_type is _E.AI_STATUS:
            status = event.details.get("ai_status")
            reason = event.details.get("ai_reason")
            impaired = list(event.details.get("impaired", []))
    active = sorted(open_episodes(events).values(), key=lambda e: e.recorded_at)
    open_types = {e.event_type: e for e in active}

    def measuring(detector: str) -> bool:
        return status in _MEASURING and detector not in impaired

    no_face = _E.FACE_NOT_DETECTED in open_types
    face_known = measuring("face_presence")
    if not face_known:
        face, face_count = "unknown", "unknown"
    elif no_face:
        face, face_count = "not_detected", "none"
    else:
        face = "detected"
        face_count = "multiple" if _E.MULTIPLE_FACES_DETECTED in open_types else "one"

    if not measuring("head_pose") or not face_known or no_face:
        head = "unknown"
    else:
        turned = open_types.get(_E.HEAD_ORIENTATION_CHANGED)
        head = "forward" if turned is None else turned.details.get("direction", "unknown")
    gaze = "not_used"  # GAZE_AWAY is disabled: gaze is not an event signal (see DISABLED_EPISODE_TYPES)
    if not measuring("frame_quality"):
        camera = "unknown"
    else:
        camera = "issue" if any(t in open_types for t in _QUALITY) else "good"

    return AIMonitoringState(
        status=status,
        reason=reason,
        impaired=impaired,
        face=face,
        face_count=face_count,
        head_orientation=head,
        gaze=gaze,
        camera_quality=camera,
        active=[
            AIActiveObservation(event_type=e.event_type, started_at=e.recorded_at, metadata=e.details)
            for e in active
        ],
    )

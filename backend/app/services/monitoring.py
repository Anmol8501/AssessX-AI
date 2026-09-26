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
from app.realtime.messages import MessageType, message
from app.repositories.monitoring import MonitoringRepository
from app.schemas.monitoring import (
    ActiveSessions,
    MonitoringDetail,
    MonitoringEvent,
    MonitoringSession,
    MonitoringSummary,
)

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

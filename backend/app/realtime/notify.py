"""The bridge from the synchronous proctoring service to the admin monitoring wall (Phase 4C).

The proctoring service calls these after a candidate's REST action changes state. Each is a no-op
when no admin is connected, so the exam path pays nothing for monitoring when nobody is watching,
and it never blocks on delivery. The database write has already happened (and commits with the
request); the broadcast is a best-effort delta an admin can always re-derive from REST.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent
from app.realtime.hub import hub


def session_changed(db: Session, attempt_id: uuid.UUID) -> None:
    """A proctoring session started, resumed, ended, or its device state changed."""
    if not hub.has_admins:
        return
    from app.services.monitoring import MonitoringService

    hub.publish_threadsafe(MonitoringService(db).session_delta(attempt_id))


def event_recorded(db: Session, session: ProctoringSession, event: ProctoringEvent) -> None:
    """A proctoring event was recorded for an active session."""
    if not hub.has_admins:
        return
    from app.services.monitoring import MonitoringService

    hub.publish_threadsafe(MonitoringService(db).event_delta(session, event))

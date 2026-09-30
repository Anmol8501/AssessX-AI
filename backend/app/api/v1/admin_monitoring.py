"""Admin live-monitoring REST endpoints (Phase 4C).

Admin-only, enforced server-side by `AdminUser` — a candidate or an anonymous request is refused
regardless of anything the client sends. Read-only: the admin observes state and events; there are
no mutation routes here. These provide the *initial* state for the wall and the detail view; live
changes then arrive over the monitoring WebSocket.
"""

import uuid

from fastapi import APIRouter

from app.api.deps import AdminUser, DbSession
from app.core.errors import NotFound
from app.schemas.monitoring import ActiveSessions, MonitoringDetail
from app.services.monitoring import MonitoringService

router = APIRouter(prefix="/admin/monitoring", tags=["admin monitoring"])


@router.get("/sessions", response_model=ActiveSessions)
def active_sessions(_: AdminUser, db: DbSession) -> ActiveSessions:
    """Every candidate currently in an active proctored exam, with a factual summary.

    "Active" means an open attempt with an `ACTIVE` proctoring session; unproctored and finished
    attempts do not appear.
    """
    return MonitoringService(db).active()


@router.get("/sessions/{attempt_id}", response_model=MonitoringDetail)
def session_detail(attempt_id: uuid.UUID, _: AdminUser, db: DbSession) -> MonitoringDetail:
    """One candidate's live session and recent factual events. 404 if the attempt is not proctored."""
    detail = MonitoringService(db).detail(attempt_id)
    if detail is None:
        raise NotFound("No proctoring session for that attempt.")
    return detail

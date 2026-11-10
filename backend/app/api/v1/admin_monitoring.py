"""Admin live-monitoring REST endpoints (Phase 4C).

Admin-only, enforced server-side by `AdminUser` — a candidate or an anonymous request is refused
regardless of anything the client sends. Read-only: the admin observes state and events; there are
no mutation routes here. These provide the *initial* state for the wall and the detail view; live
changes then arrive over the monitoring WebSocket.
"""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, DbSession
from app.core.errors import Conflict, NotFound
from app.models.base import utcnow
from app.models.monitoring_audit import MonitoringAuditAction, MonitoringStreamGrant
from app.models.proctoring import ProctoringSessionStatus
from app.schemas.monitoring import (
    ActiveSessions,
    MonitoringAuditList,
    MonitoringDetail,
    MonitoringExamList,
    StreamAuthorizationGrant,
)
from app.services.monitoring import MonitoringService

router = APIRouter(prefix="/admin/monitoring", tags=["admin monitoring"])


@router.get("/exams", response_model=MonitoringExamList)
def monitorable_exams(_: AdminUser, db: DbSession) -> MonitoringExamList:
    """Operational counts for examinations available for live monitoring (Phase 4C)."""
    return MonitoringService(db).exams_summary()


@router.get("/sessions", response_model=ActiveSessions)
def active_sessions(
    _: AdminUser,
    db: DbSession,
    assessment_id: uuid.UUID | None = None,
) -> ActiveSessions:
    """Every candidate currently in an active proctored exam, with a factual summary.

    "Active" means an open attempt with an `ACTIVE` proctoring session; unproctored and finished
    attempts do not appear.
    """
    return MonitoringService(db).active(assessment_id=assessment_id)


@router.get("/sessions/{attempt_id}", response_model=MonitoringDetail)
def session_detail(attempt_id: uuid.UUID, admin: AdminUser, db: DbSession) -> MonitoringDetail:
    """One candidate's live session and recent factual events. 404 if the attempt is not proctored."""
    service = MonitoringService(db)
    detail = service.detail(attempt_id)
    if detail is None:
        raise NotFound("No proctoring session for that attempt.")
    service.record_audit(
        admin.id,
        MonitoringAuditAction.DETAIL_OPENED,
        assessment_id=detail.assessment_id,
        attempt_id=detail.attempt_id,
        proctoring_session_id=detail.proctoring_session_id,
    )
    return detail


@router.post("/sessions/{attempt_id}/stream/request", response_model=StreamAuthorizationGrant)
def request_stream_access(attempt_id: uuid.UUID, admin: AdminUser, db: DbSession) -> StreamAuthorizationGrant:
    """Authorizes and audits an administrator's WebRTC stream request for an active session (Phase 4C)."""
    service = MonitoringService(db)
    session = service.repo.session_for_attempt(attempt_id)
    if session is None:
        raise NotFound("No proctoring session for that attempt.")
    if session.status is not ProctoringSessionStatus.ACTIVE or not session.attempt.is_active:
        service.record_audit(
            admin.id,
            MonitoringAuditAction.STREAM_DENIED,
            assessment_id=session.attempt.assessment_id,
            attempt_id=attempt_id,
            proctoring_session_id=session.id,
            details={"reason": "session_not_active"},
        )
        raise Conflict("Cannot stream a proctoring session that is not active.")

    now = utcnow()
    grant_id = uuid.uuid4()
    expires_at = now + timedelta(minutes=15)
    db.add(
        MonitoringStreamGrant(
            id=grant_id,
            administrator_id=admin.id,
            attempt_id=attempt_id,
            proctoring_session_id=session.id,
            expires_at=expires_at,
        )
    )
    service.record_audit(
        admin.id,
        MonitoringAuditAction.STREAM_GRANTED,
        assessment_id=session.attempt.assessment_id,
        attempt_id=attempt_id,
        proctoring_session_id=session.id,
        details={"stream_grant_id": str(grant_id)},
    )
    return StreamAuthorizationGrant(
        stream_grant_id=grant_id,
        attempt_id=attempt_id,
        proctoring_session_id=session.id,
        expires_at=expires_at,
        ice_policy="stun_turn_relay",
    )


@router.post("/sessions/{attempt_id}/stream/terminate")
def terminate_stream_access(attempt_id: uuid.UUID, admin: AdminUser, db: DbSession) -> dict[str, str]:
    """Audits administrator stream termination and revokes active stream grants (Phase 4C)."""
    from sqlalchemy import update

    service = MonitoringService(db)
    now = utcnow()
    db.execute(
        update(MonitoringStreamGrant)
        .where(
            MonitoringStreamGrant.administrator_id == admin.id,
            MonitoringStreamGrant.attempt_id == attempt_id,
            MonitoringStreamGrant.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    session = service.repo.session_for_attempt(attempt_id)
    if session is not None:
        service.record_audit(
            admin.id,
            MonitoringAuditAction.STREAM_ENDED,
            assessment_id=session.attempt.assessment_id,
            attempt_id=attempt_id,
            proctoring_session_id=session.id,
        )
    return {"status": "terminated"}


@router.get("/audit", response_model=MonitoringAuditList)
def list_monitoring_audit(
    _: AdminUser,
    db: DbSession,
    attempt_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MonitoringAuditList:
    """Paginated administrator monitoring audit history (Phase 4C)."""
    return MonitoringService(db).audit_logs(attempt_id=attempt_id, limit=limit, offset=offset)

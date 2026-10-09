"""Security operations for administrators (Phase 8 final, CX-02/11/13): the audit log viewer, audit chain
verification, security events and alerts. Admin-only (MFA enforced by `AdminUser`); every read is itself
audited. Nothing here can change an audit row — the table is append-only at the database.

Also the scheduled maintenance endpoint (CX-14): `POST /internal/maintenance` with the MAINTENANCE_TOKEN,
for a scheduler (GitHub Actions) — the API on Render Free may be asleep, so nothing critical depends on an
in-process timer. Off (404) unless MAINTENANCE_TOKEN is set.
"""

import hmac
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import AdminUser, AppSettings, DbSession
from app.api.paging import PageDep
from app.core.errors import NotFound, Unauthorized
from app.core.limits import client_ip
from app.models.audit_log import AuditAction, AuditLog
from app.models.base import utcnow
from app.models.security_event import MaintenanceHeartbeat, SecurityAlert, SecurityEvent
from app.repositories.audit import AuditRepository
from app.services import security_events
from app.services.audit_chain import verify_chain

router = APIRouter(prefix="/admin", tags=["admin security"])
internal = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


class AuditRow(BaseModel):
    id: uuid.UUID
    seq: int | None
    occurred_at: datetime
    action: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    attempt_id: uuid.UUID | None
    assessment_id: uuid.UUID | None
    interview_id: uuid.UUID | None
    request_id: str | None
    client_ip: str | None
    details: dict[str, Any]
    entry_hash: str | None


class ChainOut(BaseModel):
    verified: bool
    rows_checked: int
    broken_at: list[int]
    head_seq: int | None
    head_hash: str | None
    checked_at: datetime


class SecurityEventRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    occurred_at: datetime
    event_type: str
    severity: str
    category: str
    request_id: str | None
    actor_id: uuid.UUID | None
    client_ip: str | None
    target_type: str | None
    target_id: str | None
    details: dict[str, Any]


class AlertRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    rule: str
    severity: str
    group_key: str
    event_count: int
    summary: str
    delivery: str
    acknowledged_at: datetime | None
    acknowledged_by_id: uuid.UUID | None


class TaxonomyOut(BaseModel):
    events: list[dict[str, str]]
    rules: list[dict[str, Any]]


Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def _audit(db, admin, action: AuditAction, **details: Any) -> None:  # noqa: ANN001
    AuditRepository(db).record(actor_id=admin.id, action=action, details=details)


@router.get("/audit-logs", response_model=list[AuditRow])
def audit_logs(
    admin: AdminUser,
    db: DbSession,
    page: PageDep,
    response: Response,
    action: Annotated[AuditAction | None, Query()] = None,
    actor_id: uuid.UUID | None = None,
    attempt_id: uuid.UUID | None = None,
    request_id: Annotated[str | None, Query(max_length=64)] = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[AuditRow]:
    """The audit trail, newest first, filtered and paged. Viewing it is audited."""
    query = select(AuditLog).order_by(AuditLog.seq.desc().nulls_last(), AuditLog.occurred_at.desc())
    if action is not None:
        query = query.where(AuditLog.action == action)
    if actor_id is not None:
        query = query.where(AuditLog.actor_id == actor_id)
    if attempt_id is not None:
        query = query.where(AuditLog.attempt_id == attempt_id)
    if request_id:
        query = query.where(AuditLog.request_id == request_id)
    if since is not None:
        query = query.where(AuditLog.occurred_at >= since)
    if until is not None:
        query = query.where(AuditLog.occurred_at < until)
    rows = page.finish(list(db.scalars(page.apply(query))), response)
    _audit(
        db,
        admin,
        AuditAction.AUDIT_LOG_VIEWED,
        rows=len(rows),
        filtered=bool(action or actor_id or attempt_id),
    )
    return [
        AuditRow(
            id=r.id,
            seq=r.seq,
            occurred_at=r.occurred_at,
            action=r.action.value,
            actor_id=r.actor_id,
            actor_name=r.actor.name if r.actor else None,
            attempt_id=r.attempt_id,
            assessment_id=r.assessment_id,
            interview_id=r.interview_id,
            request_id=r.request_id,
            client_ip=r.client_ip,
            details=r.details,
            entry_hash=r.entry_hash,
        )
        for r in rows
    ]


def _verify(db) -> ChainOut:  # noqa: ANN001
    result = verify_chain(db)
    if not result.verified:
        security_events.record(
            "audit_integrity_failed",
            details={
                "broken_at": ",".join(str(s) for s in result.broken_at[:5]),
                "rows": result.rows_checked,
            },
        )
    return ChainOut(**vars(result), checked_at=utcnow())


@router.get("/audit-logs/verify", response_model=ChainOut)
def verify_audit_chain(admin: AdminUser, db: DbSession) -> ChainOut:
    """Recomputes the audit hash chain. A break raises a CRITICAL security alert."""
    out = _verify(db)
    _audit(db, admin, AuditAction.AUDIT_CHAIN_VERIFIED, verified=out.verified, rows=out.rows_checked)
    return out


@router.get("/security-events", response_model=list[SecurityEventRow])
def list_security_events(
    admin: AdminUser,
    db: DbSession,
    page: PageDep,
    response: Response,
    severity: Severity | None = None,
    event_type: Annotated[str | None, Query(max_length=64)] = None,
    actor_id: uuid.UUID | None = None,
    since: datetime | None = None,
) -> list[SecurityEventRow]:
    query = select(SecurityEvent).order_by(SecurityEvent.occurred_at.desc(), SecurityEvent.id)
    if severity is not None:
        query = query.where(SecurityEvent.severity == severity)
    if event_type:
        query = query.where(SecurityEvent.event_type == event_type)
    if actor_id is not None:
        query = query.where(SecurityEvent.actor_id == actor_id)
    if since is not None:
        query = query.where(SecurityEvent.occurred_at >= since)
    rows = page.finish(list(db.scalars(page.apply(query))), response)
    _audit(db, admin, AuditAction.SECURITY_EVENTS_VIEWED, rows=len(rows))
    return [SecurityEventRow.model_validate(r) for r in rows]


@router.get("/security-alerts", response_model=list[AlertRow])
def list_security_alerts(
    admin: AdminUser, db: DbSession, page: PageDep, response: Response, open_only: bool = False
) -> list[AlertRow]:
    query = select(SecurityAlert).order_by(SecurityAlert.created_at.desc(), SecurityAlert.id)
    if open_only:
        query = query.where(SecurityAlert.acknowledged_at.is_(None))
    rows = page.finish(list(db.scalars(page.apply(query))), response)
    _audit(db, admin, AuditAction.SECURITY_EVENTS_VIEWED, alerts=len(rows))
    return [AlertRow.model_validate(r) for r in rows]


@router.post("/security-alerts/{alert_id}/acknowledge", response_model=AlertRow)
def acknowledge_alert(alert_id: uuid.UUID, admin: AdminUser, db: DbSession) -> AlertRow:
    alert = db.get(SecurityAlert, alert_id)
    if alert is None:
        raise NotFound("Alert not found.")
    if alert.acknowledged_at is None:
        alert.acknowledged_at = utcnow()
        alert.acknowledged_by_id = admin.id
        db.flush()
        _audit(db, admin, AuditAction.SECURITY_ALERT_ACKNOWLEDGED, alert_id=str(alert.id), rule=alert.rule)
    return AlertRow.model_validate(alert)


@router.get("/security/taxonomy", response_model=TaxonomyOut)
def taxonomy(_: AdminUser) -> TaxonomyOut:
    return TaxonomyOut(
        events=[
            {"event_type": k, "severity": v[0], "category": v[1], "description": v[2]}
            for k, v in security_events.TAXONOMY.items()
        ],
        rules=[
            {
                "rule": r.name,
                "event_types": list(r.event_types),
                "threshold": r.threshold,
                "window_seconds": r.window_seconds,
                "severity": r.severity,
                "group_by": r.group_by,
            }
            for r in security_events.RULES
        ],
    )


# -- scheduled maintenance (CX-14) ------------------------------------------------------------------------


class Heartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["success", "failure"]
    size_bytes: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=200)


def _maintenance_auth(request: Request, settings, authorization: str | None) -> None:  # noqa: ANN001
    token = settings.maintenance_token
    if token is None:
        raise NotFound()
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not supplied or not hmac.compare_digest(supplied.encode(), token.get_secret_value().encode()):
        security_events.record("maintenance_auth_failed", client_ip=client_ip(request), details={})
        raise Unauthorized()


@internal.post("/maintenance")
def run_scheduled_maintenance(
    request: Request,
    settings: AppSettings,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Upload-deadline sweep, retention, audit chain check and the missing-backup check. Idempotent; it only
    ever applies the configured retention policy. Called on a schedule (docs/SECURITY-OPERATIONS.md)."""
    _maintenance_auth(request, settings, authorization)
    from app.services.retention import run_all

    return run_all(db, settings)


@internal.post("/maintenance/backup-heartbeat", status_code=204)
def backup_heartbeat(
    payload: Heartbeat,
    request: Request,
    settings: AppSettings,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """The backup job reports each run; a failure raises an alert, and a missing success is detected by the
    maintenance check."""
    _maintenance_auth(request, settings, authorization)
    now = utcnow()
    row = db.get(MaintenanceHeartbeat, "backup") or MaintenanceHeartbeat(
        name="backup", last_run_at=now, last_status=""
    )
    row.last_run_at = now
    row.last_status = payload.status
    row.details = {"size_bytes": payload.size_bytes, "note": payload.note}
    if payload.status == "success":
        row.last_success_at = now
    db.merge(row)
    db.flush()
    if payload.status == "failure":
        security_events.record("backup_failed", details={"note": (payload.note or "")[:100]})

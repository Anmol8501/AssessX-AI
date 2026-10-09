"""Data retention and scheduled maintenance (Phase 8 final, CX-10/14; docs/DATA-RETENTION.md).

One idempotent run, called by the scheduler (`POST /internal/maintenance`), the API's own hourly task when it
is awake, or `python -m app.cli evidence-maintenance`:

| Data                                   | Kept for                       | Then                         |
|----------------------------------------|--------------------------------|------------------------------|
| evidence clip video                    | EVIDENCE_RETENTION_DAYS (30)   | video deleted, record EXPIRED|
| proctoring events of finished attempts | RETENTION_PROCTORING_EVENT_DAYS (365) | deleted               |
| finished attempts, with everything under them | RETENTION_ATTEMPT_DAYS (1095) | deleted   |
| finished interview sessions (answers, AI evaluations, reviews) | RETENTION_ATTEMPT_DAYS | deleted          |
| expired/revoked sign-in sessions, used/expired reset codes | RETENTION_SESSION_DAYS (30) | deleted       |
| security events and alerts             | RETENTION_SECURITY_EVENT_DAYS (365) | deleted                 |
| audit log                              | indefinitely (append-only, hash-chained) | archive by hand    |

**Holds:** nothing belonging to an attempt whose review is IN_REVIEW is removed. 0 keeps that data forever.
Every purge writes one RETENTION_PURGED audit row with the counts (no content). Each step runs in its own
savepoint, so one failure never blocks the others.
"""

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.attempt import AssessmentAttempt
from app.models.audit_log import AuditAction
from app.models.auth_session import AuthSession
from app.models.base import utcnow
from app.models.evidence_clip import EvidenceClip, EvidenceClipStatus
from app.models.interview import InterviewSession
from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent
from app.models.review import AttemptReview, ReviewStatus
from app.models.security import PasswordResetCode
from app.models.security_event import MaintenanceHeartbeat, SecurityAlert, SecurityEvent
from app.repositories.audit import AuditRepository
from app.services import security_events

log = logging.getLogger("assessx.retention")
BATCH = 500


def _held_attempts():  # noqa: ANN202
    return select(AttemptReview.attempt_id).where(AttemptReview.status == ReviewStatus.IN_REVIEW)


def _step(db: Session, name: str, work, results: dict[str, Any]) -> None:  # noqa: ANN001
    try:
        with db.begin_nested():
            results[name] = work()
    except Exception:  # noqa: BLE001 — one failing step must not stop the rest
        log.exception("Retention step failed", extra={"step": name})
        results[name] = "error"


def purge(db: Session, settings: Settings) -> dict[str, Any]:
    now = utcnow()
    results: dict[str, Any] = {}

    def sessions() -> int:
        cutoff = now - timedelta(days=settings.retention_session_days)
        gone = db.execute(
            delete(AuthSession).where((AuthSession.expires_at < cutoff) | (AuthSession.revoked_at < cutoff))
        ).rowcount
        gone += db.execute(delete(PasswordResetCode).where(PasswordResetCode.expires_at < cutoff)).rowcount
        return gone

    def security() -> int:
        if not settings.retention_security_event_days:
            return 0
        cutoff = now - timedelta(days=settings.retention_security_event_days)
        gone = db.execute(delete(SecurityEvent).where(SecurityEvent.occurred_at < cutoff)).rowcount
        return gone + db.execute(delete(SecurityAlert).where(SecurityAlert.created_at < cutoff)).rowcount

    def proctoring_events() -> int:
        if not settings.retention_proctoring_event_days:
            return 0
        cutoff = now - timedelta(days=settings.retention_proctoring_event_days)
        sessions_q = (
            select(ProctoringSession.id)
            .join(AssessmentAttempt, AssessmentAttempt.id == ProctoringSession.attempt_id)
            .where(
                AssessmentAttempt.finalized_at.is_not(None),
                AssessmentAttempt.finalized_at < cutoff,
                AssessmentAttempt.id.not_in(_held_attempts()),
            )
        )
        # Clips are tied to their trigger event; a clip still READY here is past its own retention too.
        _expire_clips(db, settings, EvidenceClip.proctoring_session_id.in_(sessions_q))
        return db.execute(delete(ProctoringEvent).where(ProctoringEvent.session_id.in_(sessions_q))).rowcount

    def attempts() -> int:
        if not settings.retention_attempt_days:
            return 0
        cutoff = now - timedelta(days=settings.retention_attempt_days)
        ids = list(
            db.scalars(
                select(AssessmentAttempt.id)
                .where(
                    AssessmentAttempt.finalized_at.is_not(None),
                    AssessmentAttempt.finalized_at < cutoff,
                    AssessmentAttempt.id.not_in(_held_attempts()),
                )
                .limit(BATCH)
            )
        )
        if not ids:
            return 0
        _expire_clips(db, settings, EvidenceClip.attempt_id.in_(ids))
        return db.execute(delete(AssessmentAttempt).where(AssessmentAttempt.id.in_(ids))).rowcount

    def interviews() -> int:
        if not settings.retention_attempt_days:
            return 0
        cutoff = now - timedelta(days=settings.retention_attempt_days)
        return db.execute(
            delete(InterviewSession).where(
                and_(InterviewSession.completed_at.is_not(None), InterviewSession.completed_at < cutoff)
            )
        ).rowcount

    for name, work in (
        ("sessions", sessions),
        ("security_events", security),
        ("proctoring_events", proctoring_events),
        ("attempts", attempts),
        ("interview_sessions", interviews),
    ):
        _step(db, name, work, results)

    counts = {k: v for k, v in results.items() if isinstance(v, int) and v}
    if counts:
        AuditRepository(db).record(actor_id=None, action=AuditAction.RETENTION_PURGED, details=counts)
    return results


def _expire_clips(db: Session, settings: Settings, condition) -> None:  # noqa: ANN001
    """Deletes the video of READY clips about to lose their records (storage first, then the row goes)."""
    from app.services.evidence_clips.storage import StorageError, get_storage

    clips = list(
        db.scalars(select(EvidenceClip).where(condition, EvidenceClip.status == EvidenceClipStatus.READY))
    )
    if not clips:
        return
    storage = get_storage(settings)
    for clip in clips:
        try:
            storage.delete(clip.storage_key or "")
        except StorageError:
            security_events.record(
                "storage_failure",
                target_type="evidence_clip",
                target_id=clip.id,
                details={"operation": "retention_delete"},
            )
            raise


def check_backups(db: Session, settings: Settings) -> str:
    """`ok`, `missing` (no success within BACKUP_MAX_AGE_HOURS) or `never` (no backup ever reported)."""
    row = db.get(MaintenanceHeartbeat, "backup")
    if row is None or row.last_success_at is None:
        status = "never"
    elif utcnow() - row.last_success_at > timedelta(hours=settings.backup_max_age_hours):
        status = "missing"
    else:
        return "ok"
    security_events.record("backup_missing", details={"status": status})
    return status


def run_all(db: Session, settings: Settings) -> dict[str, Any]:
    """Everything the scheduler runs, in order. Never deletes anything outside the retention policy."""
    from app.services.audit_chain import verify_chain
    from app.services.evidence_clips.service import EvidenceClipService

    started = utcnow()
    clips = EvidenceClipService(db, settings)
    out: dict[str, Any] = {
        "evidence_failed": clips.sweep(now=started),
        **clips.enforce_retention(now=started),
    }
    out.update(purge(db, settings))
    chain = verify_chain(db)
    out["audit_chain_verified"] = chain.verified
    out["audit_head"] = {"seq": chain.head_seq, "hash": chain.head_hash}
    if not chain.verified:
        security_events.record("audit_integrity_failed", details={"rows": chain.rows_checked})
    out["backups"] = check_backups(db, settings)
    beat = db.get(MaintenanceHeartbeat, "maintenance") or MaintenanceHeartbeat(
        name="maintenance", last_run_at=started, last_status="ok"
    )
    beat.last_run_at = started
    beat.last_success_at = started
    beat.last_status = "ok"
    db.merge(beat)
    db.flush()
    log.info("Maintenance run", extra={"audit_head_seq": chain.head_seq, "backups": out["backups"]})
    return out

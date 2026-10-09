"""Evidence clips: from a qualifying factual event to a stored, hashed, reviewable clip (FR-017).

    event recorded ──▶ policy (eligible? linked to an open clip? cooldown? cap?) ──▶ clip CREATING
           ▼                                                                          │
    the app keeps its rolling buffer, records the post-event window, uploads ─────────┤
           ▼                                                                          ▼
    validated (owner, state, deadline, size, WebM) ──▶ SHA-256 ──▶ private storage ──▶ READY
           ▼                                                                          ▼
    no upload by the deadline ──▶ FAILED (the event still stands)       retention ──▶ EXPIRED

**The server decides.** Only the server creates a clip, chooses its id and storage key, links events to
it and computes its hash. The app's part is limited to recording and sending bytes for a clip the server
already created for *that candidate's own* attempt. A clip is never a verdict: it is context for a human.

**Never in the exam's way.** Every failure here leaves the event and the exam untouched: the event is
recorded first and the clip decision runs after it, and a storage problem marks the clip FAILED or asks
the app to retry (bounded), it never fails the exam.
"""

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import (
    EvidenceIntegrityFailed,
    EvidenceNotReady,
    EvidenceStorageUnavailable,
    EvidenceTooLarge,
    EvidenceUnavailable,
    EvidenceUnsupported,
    EvidenceUploadClosed,
    NotFound,
    ValidationFailed,
)
from app.models.attempt import AssessmentAttempt
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.evidence_clip import (
    CLIENT_FAILURE_REASONS,
    EvidenceClip,
    EvidenceClipEvent,
    EvidenceClipStatus,
    EvidenceSource,
)
from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent, ProctoringEventCategory
from app.models.review import AttemptReview, ReviewStatus
from app.models.user import User
from app.repositories.audit import AuditRepository
from app.services import security_events
from app.services.evidence_clips.storage import (
    EvidenceStorage,
    ObjectMissing,
    StorageError,
    get_storage,
    new_key,
)

log = logging.getLogger("assessx.evidence_clips")
S = EvidenceClipStatus

CONTENT_TYPE = "video/webm"
#: EBML magic number every WebM (Matroska) file starts with.
_EBML_MAGIC = b"\x1a\x45\xdf\xa3"


@dataclass(frozen=True)
class EvidencePolicy:
    """What the app needs to record clips, and what the candidate is told. All from server settings."""

    enabled: bool
    event_types: tuple[str, ...]
    pre_seconds: int
    post_seconds: int
    max_clip_seconds: int
    max_clip_bytes: int
    video_bits_per_second: int
    max_width: int
    max_height: int
    frame_rate: int
    retention_days: int


def policy(settings: Settings | None = None) -> EvidencePolicy:
    settings = settings or get_settings()
    return EvidencePolicy(
        enabled=settings.evidence_enabled,
        event_types=tuple(settings.evidence_event_types),
        pre_seconds=settings.evidence_pre_seconds,
        post_seconds=settings.evidence_post_seconds,
        max_clip_seconds=settings.evidence_max_clip_seconds,
        max_clip_bytes=settings.evidence_max_clip_bytes,
        video_bits_per_second=settings.evidence_video_bits_per_second,
        max_width=settings.evidence_max_width,
        max_height=settings.evidence_max_height,
        frame_rate=settings.evidence_frame_rate,
        retention_days=settings.evidence_retention_days,
    )


@dataclass(frozen=True)
class ClipRequest:
    """The server's answer to an eligible event: which clip covers it, and whether the app must upload."""

    clip_id: uuid.UUID
    upload: bool


@dataclass(frozen=True)
class IntegrityResult:
    algorithm: str
    expected_sha256: str
    actual_sha256: str | None
    byte_size: int | None
    verified: bool
    checked_at: datetime


def looks_like_webm(data: bytes) -> bool:
    """WebM starts with the EBML magic and names its DocType `webm` in the header."""
    return data.startswith(_EBML_MAGIC) and b"webm" in data[:64]


class EvidenceClipService:
    def __init__(self, db: Session, settings: Settings | None = None, storage: EvidenceStorage | None = None):
        self.db = db
        self.settings = settings or get_settings()
        self._storage = storage
        self.audit = AuditRepository(db)

    @property
    def storage(self) -> EvidenceStorage:
        if self._storage is None:
            self._storage = get_storage(self.settings)
        return self._storage

    # -- event → clip ------------------------------------------------------------------------------------

    def eligible(self, event: ProctoringEvent) -> bool:
        """Only a stabilised AI episode's *start*, of an allow-listed type, can be evidence-worthy."""
        return (
            self.settings.evidence_enabled
            and event.category is ProctoringEventCategory.AI_OBSERVATION
            and event.event_type.value in self.settings.evidence_event_types
            and event.details.get("phase") == "started"
        )

    def on_event(
        self, attempt: AssessmentAttempt, session: ProctoringSession, event: ProctoringEvent, *, created: bool
    ) -> ClipRequest | None:
        """Decides whether this event gets a clip. Never raises into the event path."""
        try:
            if not created:
                return self._existing_request(event)
            if not self.eligible(event) or not session.is_active or not session.evidence_recorder:
                return None
            # A savepoint: if anything here fails, only the clip work is undone, never the event.
            with self.db.begin_nested():
                return self._request(attempt, session, event)
        except Exception:  # noqa: BLE001 — evidence is supplementary; the event must still be recorded
            log.exception("Evidence clip decision failed", extra={"event_id": str(event.id)})
            return None

    def _existing_request(self, event: ProctoringEvent) -> ClipRequest | None:
        """A retried event (lost response) is told again about the clip it created, if still open."""
        clip = self.db.scalar(select(EvidenceClip).where(EvidenceClip.trigger_event_id == event.id))
        if clip is not None and clip.status is S.CREATING and utcnow() <= clip.upload_deadline:
            return ClipRequest(clip.id, upload=True)
        return None

    def _request(
        self, attempt: AssessmentAttempt, session: ProctoringSession, event: ProctoringEvent
    ) -> ClipRequest | None:
        now = event.recorded_at
        self.sweep(session_id=session.id, now=utcnow())
        # 1. An event inside a clip still being captured is linked to it: one clip, several events.
        open_clip = self.db.scalar(
            select(EvidenceClip)
            .where(
                EvidenceClip.proctoring_session_id == session.id,
                EvidenceClip.status == S.CREATING,
                EvidenceClip.window_ends_at >= now,
            )
            .order_by(EvidenceClip.created_at.desc())
            .limit(1)
        )
        if open_clip is not None:
            self._link(open_clip, event, now)
            return ClipRequest(open_clip.id, upload=False)
        # 2. Cooldown since the last clip started, and a hard cap per session.
        last = self.db.scalar(
            select(func.max(EvidenceClip.event_at)).where(EvidenceClip.proctoring_session_id == session.id)
        )
        if last is not None and now - last < timedelta(seconds=self.settings.evidence_cooldown_seconds):
            return None
        count = self.db.scalar(
            select(func.count())
            .select_from(EvidenceClip)
            .where(EvidenceClip.proctoring_session_id == session.id)
        )
        if count >= self.settings.evidence_max_clips_per_session:
            log.info("Evidence clip cap reached", extra={"proctoring_session_id": str(session.id)})
            return None
        # 3. A new clip, waiting for the app's recording.
        pre, post = self.settings.evidence_pre_seconds, self.settings.evidence_post_seconds
        clip = EvidenceClip(
            attempt_id=attempt.id,
            proctoring_session_id=session.id,
            candidate_id=attempt.candidate_id,
            assessment_id=attempt.assessment_id,
            trigger_event_id=event.id,
            source_type=EvidenceSource.PRIMARY_CAMERA,
            status=S.CREATING,
            event_at=now,
            window_starts_at=now - timedelta(seconds=pre),
            window_ends_at=now + timedelta(seconds=post),
            pre_seconds=pre,
            post_seconds=post,
            upload_deadline=now + timedelta(seconds=post + self.settings.evidence_upload_grace_seconds),
            upload_attempts=0,
        )
        self.db.add(clip)
        self.db.flush()
        self._link(clip, event, now)
        self._audit(
            attempt.candidate_id, AuditAction.EVIDENCE_CLIP_CREATED, clip, event_type=event.event_type.value
        )
        log.info("Evidence clip requested", extra={"clip_id": str(clip.id), "attempt_id": str(attempt.id)})
        return ClipRequest(clip.id, upload=True)

    def _link(self, clip: EvidenceClip, event: ProctoringEvent, at: datetime) -> None:
        self.db.add(EvidenceClipEvent(clip_id=clip.id, event_id=event.id, linked_at=at))
        self.db.flush()

    # -- upload / failure (the candidate's own attempt only) -------------------------------------------

    def _own_clip(self, attempt: AssessmentAttempt, clip_id: uuid.UUID) -> EvidenceClip:
        """The clip, only if it belongs to this attempt (already checked to be the candidate's own)."""
        clip = self.db.scalar(
            select(EvidenceClip)
            .where(EvidenceClip.id == clip_id, EvidenceClip.attempt_id == attempt.id)
            .with_for_update()
        )
        if clip is None:
            raise NotFound("Evidence clip not found.")
        return clip

    def accept_upload(
        self,
        attempt: AssessmentAttempt,
        clip_id: uuid.UUID,
        data: bytes,
        content_type: str | None,
        duration_ms: int | None,
    ) -> EvidenceClip:
        started = utcnow()
        clip = self._own_clip(attempt, clip_id)
        self._close_if_overdue(clip, started)
        if clip.status is not S.CREATING:
            raise EvidenceUploadClosed()
        # Request-shape errors first: they change nothing and do not use up an attempt.
        if (content_type or "").split(";")[0].strip().lower() != CONTENT_TYPE:
            raise EvidenceUnsupported()
        if not data:
            raise ValidationFailed("The evidence clip is empty.")
        if duration_ms is not None and not 0 <= duration_ms <= self.settings.evidence_max_clip_seconds * 1000:
            raise ValidationFailed(
                "The clip duration is out of range.",
                details=[{"field": "duration_ms", "message": "Out of range."}],
            )
        clip.upload_attempts += 1
        self.db.flush()
        if clip.upload_attempts > self.settings.evidence_max_upload_attempts:
            self._fail(clip, "upload_failed", actor_id=attempt.candidate_id)
            raise EvidenceUploadClosed()
        # The content itself: whatever the app claims, it must be a WebM within the size limit.
        if len(data) > self.settings.evidence_max_clip_bytes:
            self._fail(clip, "too_large", actor_id=attempt.candidate_id)
            raise EvidenceTooLarge()
        if not looks_like_webm(data):
            self._fail(clip, "invalid_content", actor_id=attempt.candidate_id)
            raise EvidenceUnsupported()
        digest = hashlib.sha256(data).hexdigest()  # the server's hash, never the app's
        key = new_key()
        try:
            self.storage.put(key, data, CONTENT_TYPE)
        except StorageError as error:
            log.warning("Evidence clip storage failed", extra={"clip_id": str(clip.id), "error": str(error)})
            security_events.record(
                "storage_failure",
                target_type="evidence_clip",
                target_id=clip.id,
                details={"operation": "put"},
            )
            if clip.upload_attempts >= self.settings.evidence_max_upload_attempts:
                self._fail(clip, "storage_error", actor_id=attempt.candidate_id)
            raise EvidenceStorageUnavailable() from None
        now = utcnow()
        clip.storage_key = key
        clip.content_type = CONTENT_TYPE
        clip.byte_size = len(data)
        clip.sha256 = digest
        clip.duration_ms = duration_ms
        clip.status = S.READY
        clip.ready_at = now
        clip.retain_until = now + timedelta(days=self.settings.evidence_retention_days)
        self.db.flush()
        self._audit(attempt.candidate_id, AuditAction.EVIDENCE_CLIP_READY, clip, byte_size=len(data))
        log.info(
            "Evidence clip stored",
            extra={
                "clip_id": str(clip.id),
                "attempt_id": str(attempt.id),
                "bytes": len(data),
                "store_ms": round((now - started).total_seconds() * 1000),
                "since_event_ms": round((now - clip.event_at).total_seconds() * 1000),
            },
        )
        return clip

    def report_failure(self, attempt: AssessmentAttempt, clip_id: uuid.UUID, reason: str) -> EvidenceClip:
        if reason not in CLIENT_FAILURE_REASONS:
            raise ValidationFailed(
                "Unknown failure reason.", details=[{"field": "reason", "message": "Not an allowed reason."}]
            )
        clip = self._own_clip(attempt, clip_id)
        if clip.status is S.CREATING:
            self._fail(clip, reason, actor_id=attempt.candidate_id)
        return clip

    # -- lifecycle sweeps ---------------------------------------------------------------------------------

    def _close_if_overdue(self, clip: EvidenceClip, now: datetime) -> None:
        if clip.status is S.CREATING and now > clip.upload_deadline:
            self._fail(clip, "upload_missing", actor_id=None)

    def _fail(self, clip: EvidenceClip, reason: str, *, actor_id: uuid.UUID | None) -> None:
        clip.status = S.FAILED
        clip.failed_at = utcnow()
        clip.failure_reason = reason
        self.db.flush()
        self._audit(actor_id, AuditAction.EVIDENCE_CLIP_FAILED, clip, reason=reason)
        log.info("Evidence clip failed", extra={"clip_id": str(clip.id), "reason": reason})

    def sweep(
        self, *, now: datetime, session_id: uuid.UUID | None = None, attempt_id: uuid.UUID | None = None
    ) -> int:
        """Marks clips still CREATING past their upload deadline as FAILED (`upload_missing`)."""
        query = select(EvidenceClip).where(
            EvidenceClip.status == S.CREATING, EvidenceClip.upload_deadline < now
        )
        if session_id is not None:
            query = query.where(EvidenceClip.proctoring_session_id == session_id)
        if attempt_id is not None:
            query = query.where(EvidenceClip.attempt_id == attempt_id)
        overdue = list(self.db.scalars(query.limit(500).with_for_update(skip_locked=True)))
        for clip in overdue:
            self._fail(clip, "upload_missing", actor_id=None)
        return len(overdue)

    def enforce_retention(self, *, now: datetime, limit: int = 200) -> dict[str, int]:
        """Deletes the video of every READY clip past `retain_until`; the metadata stays, as EXPIRED.

        Held: a clip whose attempt has a review IN_REVIEW is kept until that review completes. A storage
        failure leaves the clip READY, to be retried on the next run.
        """
        due = list(
            self.db.scalars(
                select(EvidenceClip)
                .where(EvidenceClip.status == S.READY, EvidenceClip.retain_until <= now)
                .order_by(EvidenceClip.retain_until)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        in_review = (
            set(
                self.db.scalars(
                    select(AttemptReview.attempt_id).where(
                        AttemptReview.attempt_id.in_({c.attempt_id for c in due}),
                        AttemptReview.status == ReviewStatus.IN_REVIEW,
                    )
                )
            )
            if due
            else set()
        )
        expired = held = errors = 0
        for clip in due:
            if clip.attempt_id in in_review:
                held += 1
                continue
            try:
                self.storage.delete(clip.storage_key or "")
            except StorageError as error:
                errors += 1
                log.warning(
                    "Evidence retention delete failed", extra={"clip_id": str(clip.id), "error": str(error)}
                )
                continue
            clip.status = S.EXPIRED
            clip.expired_at = now
            self.db.flush()
            self._audit(None, AuditAction.EVIDENCE_CLIP_EXPIRED, clip)
            expired += 1
        return {"expired": expired, "held": held, "errors": errors}

    # -- administrators -------------------------------------------------------------------------------------

    def for_attempt(self, attempt_id: uuid.UUID) -> list[EvidenceClip]:
        self.sweep(now=utcnow(), attempt_id=attempt_id)
        return list(
            self.db.scalars(
                select(EvidenceClip)
                .where(EvidenceClip.attempt_id == attempt_id)
                .order_by(EvidenceClip.event_at)
            )
        )

    def clip_of_attempt(self, attempt_id: uuid.UUID, clip_id: uuid.UUID) -> EvidenceClip:
        """404 unless the clip belongs to *this* attempt — no reading another attempt's clip by id."""
        clip = self.db.scalar(
            select(EvidenceClip).where(EvidenceClip.id == clip_id, EvidenceClip.attempt_id == attempt_id)
        )
        if clip is None:
            raise NotFound("Evidence clip not found.")
        self._close_if_overdue(clip, utcnow())
        return clip

    def _read_verified(self, clip: EvidenceClip, admin: User) -> bytes:
        if clip.status in (S.EXPIRED, S.DELETED):
            raise EvidenceUnavailable()
        if clip.status is not S.READY or not clip.storage_key or not clip.sha256:
            raise EvidenceNotReady()
        try:
            data = self.storage.get(clip.storage_key)
        except ObjectMissing:
            self._integrity_failed(clip, admin, "object_missing")
            raise EvidenceIntegrityFailed() from None
        except StorageError as error:
            log.warning("Evidence clip read failed", extra={"clip_id": str(clip.id), "error": str(error)})
            security_events.record(
                "storage_failure",
                target_type="evidence_clip",
                target_id=clip.id,
                details={"operation": "get"},
            )
            raise EvidenceStorageUnavailable() from None
        if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), clip.sha256):
            self._integrity_failed(clip, admin, "hash_mismatch")
            raise EvidenceIntegrityFailed()
        return data

    def _integrity_failed(self, clip: EvidenceClip, admin: User, reason: str) -> None:
        log.error("Evidence clip integrity check failed", extra={"clip_id": str(clip.id), "reason": reason})
        security_events.record(
            "evidence_integrity_failed",
            actor_id=admin.id,
            target_type="evidence_clip",
            target_id=clip.id,
            details={"reason": reason},
        )
        # The request then fails, but the record stays: failed requests still commit (DatabaseSession).
        self._audit(admin.id, AuditAction.EVIDENCE_CLIP_INTEGRITY_FAILED, clip, reason=reason)

    def media(self, attempt_id: uuid.UUID, clip_id: uuid.UUID, admin: User) -> tuple[EvidenceClip, bytes]:
        from app.services.rate_limit import enforce_hourly

        enforce_hourly(
            self.db,
            self.settings,
            "evidence_view",
            admin.id,
            self.settings.evidence_views_per_hour,
            "evidence_access_limited",
        )
        clip = self.clip_of_attempt(attempt_id, clip_id)
        data = self._read_verified(clip, admin)
        self._audit(admin.id, AuditAction.EVIDENCE_CLIP_VIEWED, clip, byte_size=len(data))
        log.info("Evidence clip viewed", extra={"clip_id": str(clip.id), "admin_id": str(admin.id)})
        return clip, data

    def verify(self, attempt_id: uuid.UUID, clip_id: uuid.UUID, admin: User) -> IntegrityResult:
        clip = self.clip_of_attempt(attempt_id, clip_id)
        if clip.status is not S.READY or not clip.storage_key or not clip.sha256:
            raise EvidenceUnavailable() if clip.status in (S.EXPIRED, S.DELETED) else EvidenceNotReady()
        now = utcnow()
        try:
            data = self.storage.get(clip.storage_key)
            actual: str | None = hashlib.sha256(data).hexdigest()
            size: int | None = len(data)
        except ObjectMissing:
            actual, size = None, None
        except StorageError:
            raise EvidenceStorageUnavailable() from None
        verified = actual is not None and hmac.compare_digest(actual, clip.sha256) and size == clip.byte_size
        self._audit(
            admin.id,
            AuditAction.EVIDENCE_CLIP_VERIFIED if verified else AuditAction.EVIDENCE_CLIP_INTEGRITY_FAILED,
            clip,
            verified=verified,
        )
        return IntegrityResult("sha256", clip.sha256, actual, size, verified, now)

    def delete(self, attempt_id: uuid.UUID, clip_id: uuid.UUID, admin: User, reason: str) -> EvidenceClip:
        clip = self.clip_of_attempt(attempt_id, clip_id)
        if clip.status in (S.EXPIRED, S.DELETED):
            return clip  # already gone: idempotent
        if clip.storage_key and clip.status is S.READY:
            try:
                self.storage.delete(clip.storage_key)
            except StorageError:
                raise EvidenceStorageUnavailable() from None
        previous = clip.status
        clip.status = S.DELETED
        clip.deleted_at = utcnow()
        clip.deleted_by_id = admin.id
        clip.deletion_reason = reason
        self.db.flush()
        self._audit(admin.id, AuditAction.EVIDENCE_CLIP_DELETED, clip, previous_status=previous.value)
        return clip

    # -- audit ---------------------------------------------------------------------------------------------

    def _audit(
        self, actor_id: uuid.UUID | None, action: AuditAction, clip: EvidenceClip, **details: object
    ) -> None:
        self.audit.record(
            actor_id=actor_id,
            action=action,
            attempt_id=clip.attempt_id,
            assessment_id=clip.assessment_id,
            details={
                "clip_id": str(clip.id),
                "proctoring_session_id": str(clip.proctoring_session_id),
                "source_type": clip.source_type.value,
                **{k: v for k, v in details.items() if v is not None},
            },
        )


def run_maintenance(
    db: Session, settings: Settings | None = None, *, now: datetime | None = None
) -> dict[str, int]:
    """The upload-deadline sweep and retention, for the CLI and the API's periodic task."""
    service = EvidenceClipService(db, settings)
    now = now or utcnow()
    failed = service.sweep(now=now)
    result = service.enforce_retention(now=now)
    db.commit()
    return {"failed": failed, **result}

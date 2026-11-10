"""Service implementation for Phase 3C: Secure Examination Submission, Exit Authorization & Closure.

Manages:
- Pre-submission validation & answer review summary
- Atomic final submission commit, canonical snapshot creation, and cryptographic integrity hashing
- Idempotent submission confirmation & immutable receipt generation
- Signed HMAC-SHA256 exit authorization token issuance for native OS restoration
- Closure completion acknowledgement & admin submission auditing
"""

import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AttemptLocked, AttemptOnHold, NotFound, ValidationFailed
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.base import utcnow
from app.models.user import User
from app.schemas.submission_closure import (
    AdminSubmissionDetail,
    ClosureCompleteRequest,
    ClosureCompleteResponse,
    ExitAuthorizationRequest,
    ExitAuthorizationResponse,
    SubmissionConfirmRequest,
    SubmissionConfirmResponse,
    SubmissionPrepareResponse,
    SubmissionReceiptResponse,
)
from app.services.attempts import AttemptService
from app.services.evaluation import EvaluationService
from app.services.proctoring import ProctoringService

log = logging.getLogger("assessx.submission_closure")


class SubmissionClosureService:
    """Orchestrates the final examination submission, exit authorization, and closure lifecycle."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.attempt_service = AttemptService(db)

    def prepare_submission(self, candidate: User, attempt_id: uuid.UUID) -> SubmissionPrepareResponse:
        """Evaluates attempt progress and verifies candidate submission eligibility."""
        attempt = self.attempt_service.get_attempt(candidate, attempt_id)
        now = utcnow()

        questions = self.attempt_service.questions_for(attempt)
        answers = self.attempt_service.answers_for(attempt)
        answered_ids = {a.question_id for a in answers if a.is_answered}

        total = len(questions)
        answered = len([q for q in questions if q.id in answered_ids])
        unanswered = max(0, total - answered)

        eligible = True
        reason = None
        if not attempt.is_active and attempt.status is not AttemptStatus.TIME_EXPIRED:
            eligible = False
            reason = "Examination attempt is already finalized."
        elif attempt.is_on_hold:
            eligible = False
            reason = "Examination attempt is currently on hold by proctor/administrator."

        return SubmissionPrepareResponse(
            attempt_id=attempt.id,
            total_questions=total,
            answered_questions=answered,
            unanswered_questions=unanswered,
            remaining_seconds=attempt.remaining_seconds(now),
            pending_sync_count=attempt.pending_sync_count,
            eligible_for_submission=eligible,
            reason=reason,
        )

    def _build_canonical_snapshot(
        self, attempt: AssessmentAttempt, answers: list, submission_type: str, now: datetime
    ) -> tuple[dict, str]:
        """Constructs canonical JSON representation of final answers and computes SHA-256 hash."""
        items = []
        # Sort by question_id string to guarantee deterministic canonical ordering
        for a in sorted(answers, key=lambda x: str(x.question_id)):
            items.append(
                {
                    "question_id": str(a.question_id),
                    "selected_option_ids": [str(opt_id) for opt_id in sorted(a.selected_option_ids, key=str)],
                    "client_revision": a.client_revision,
                    "server_revision": a.server_revision,
                    "synced_at": a.synced_at.isoformat() if a.synced_at else None,
                }
            )

        snapshot = {
            "attempt_id": str(attempt.id),
            "assessment_id": str(attempt.assessment_id),
            "candidate_id": str(attempt.candidate_id),
            "submission_type": submission_type,
            "submitted_at": now.isoformat(),
            "total_answers": len(items),
            "answers": items,
        }

        canonical_json = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
        snapshot_hash = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
        return snapshot, snapshot_hash

    def confirm_submission(
        self, candidate: User, attempt_id: uuid.UUID, payload: SubmissionConfirmRequest
    ) -> SubmissionConfirmResponse:
        """Atomically commits final exam submission, creates immutable snapshot, and issues receipt."""
        attempt = self.attempt_service.attempts.get_for_candidate_locked(attempt_id, candidate.id)
        if attempt is None:
            raise NotFound("Attempt not found.")

        self.attempt_service.settle(attempt)
        self.attempt_service.claim(attempt, candidate)

        now = utcnow()
        questions = self.attempt_service.questions_for(attempt)
        answers = self.attempt_service.answers_for(attempt)
        total_questions = len(questions)
        total_answered = len([a for a in answers if a.is_answered])

        # Idempotency check: if already submitted, return the existing authoritative receipt
        if attempt.status in (AttemptStatus.SUBMITTED, AttemptStatus.TIME_EXPIRED) and attempt.receipt_id:
            return SubmissionConfirmResponse(
                attempt_id=attempt.id,
                submission_id=attempt.submission_id or attempt.id,
                receipt_id=attempt.receipt_id,
                submission_type=attempt.submission_type or "MANUAL",
                submitted_at=attempt.submitted_at or attempt.finalized_at or now,
                snapshot_hash=attempt.snapshot_hash or "",
                total_questions=total_questions,
                total_answered=total_answered,
                status=attempt.status.value,
            )

        if attempt.is_on_hold:
            raise AttemptOnHold("Examination is on hold; release required prior to submission.")

        # Determine submission type based on clock and payload
        sub_type = payload.submission_type
        if attempt.has_expired_at(now):
            sub_type = "AUTOMATIC_TIMEOUT"
            attempt.status = AttemptStatus.TIME_EXPIRED
        else:
            attempt.status = AttemptStatus.SUBMITTED

        snapshot, snapshot_hash = self._build_canonical_snapshot(attempt, answers, sub_type, now)
        submission_id = uuid.uuid4()
        timestamp_hex = f"{int(now.timestamp()):X}"
        receipt_id = f"RCPT-{str(attempt.id)[:8].upper()}-{timestamp_hex}-{snapshot_hash[:8].upper()}"

        attempt.submission_id = submission_id
        attempt.submission_type = sub_type
        attempt.receipt_id = receipt_id
        attempt.snapshot_hash = snapshot_hash
        attempt.answer_snapshot = snapshot
        attempt.submitted_at = now
        attempt.finalized_at = now
        attempt.closure_status = "SUBMITTED"
        attempt.pending_sync_count = 0
        self.db.flush()

        # End proctoring and ensure result evaluation in same transaction
        ProctoringService(self.db).end_for(attempt)
        EvaluationService(self.db).ensure_result(attempt)
        self.db.commit()

        log.info(
            "Examination successfully submitted and snapshot sealed",
            extra={
                "attempt_id": str(attempt.id),
                "submission_id": str(submission_id),
                "receipt_id": receipt_id,
                "snapshot_hash": snapshot_hash,
                "submission_type": sub_type,
            },
        )

        return SubmissionConfirmResponse(
            attempt_id=attempt.id,
            submission_id=submission_id,
            receipt_id=receipt_id,
            submission_type=sub_type,
            submitted_at=now,
            snapshot_hash=snapshot_hash,
            total_questions=total_questions,
            total_answered=total_answered,
            status=attempt.status.value,
        )

    def get_receipt(self, candidate: User, attempt_id: uuid.UUID) -> SubmissionReceiptResponse:
        """Returns authoritative submission receipt for an already finalized examination."""
        attempt = self.attempt_service.get_attempt(candidate, attempt_id)
        if not attempt.is_finalized or not attempt.receipt_id:
            raise NotFound("Submission receipt not yet available for this examination attempt.")

        questions = self.attempt_service.questions_for(attempt)
        answers = self.attempt_service.answers_for(attempt)
        candidate_name = f"{candidate.first_name} {candidate.last_name}".strip() or candidate.email

        return SubmissionReceiptResponse(
            receipt_id=attempt.receipt_id,
            submission_id=attempt.submission_id or attempt.id,
            attempt_id=attempt.id,
            candidate_id=candidate.id,
            candidate_name=candidate_name,
            examination_title=attempt.assessment.title,
            submitted_at=attempt.submitted_at or attempt.finalized_at or utcnow(),
            submission_type=attempt.submission_type or "MANUAL",
            snapshot_hash=attempt.snapshot_hash or "",
            total_answered=len([a for a in answers if a.is_answered]),
            total_questions=len(questions),
            status=attempt.status.value,
        )

    @staticmethod
    def _signing_secret() -> bytes:
        raw = get_settings().secret_key
        value = raw.get_secret_value() if hasattr(raw, "get_secret_value") else str(raw)
        if not value:
            raise RuntimeError("SECRET_KEY is not configured.")
        return value.encode("utf-8")

    def _sign_exit_token(
        self,
        attempt_id: uuid.UUID,
        candidate_id: uuid.UUID,
        device_id: str,
        receipt_id: str,
        expires_at: datetime,
    ) -> str:
        secret = self._signing_secret()
        exp_ts = int(expires_at.timestamp())
        payload = f"{attempt_id}:{candidate_id}:{device_id}:{receipt_id}:{exp_ts}".encode()
        sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()
        return f"{attempt_id}.{exp_ts}.{sig}"

    def _verify_exit_token(
        self,
        token: str,
        attempt_id: uuid.UUID,
        candidate_id: uuid.UUID,
        device_id: str,
        receipt_id: str,
        *,
        now: datetime | None = None,
    ) -> bool:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return False
        tok_attempt, exp_str, sig = parts
        if tok_attempt != str(attempt_id):
            return False
        try:
            exp_ts = int(exp_str)
        except ValueError:
            return False
        current = now or utcnow()
        if int(current.timestamp()) > exp_ts:
            return False
        secret = self._signing_secret()
        payload = f"{attempt_id}:{candidate_id}:{device_id}:{receipt_id}:{exp_ts}".encode()
        expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)

    def authorize_closure(
        self, candidate: User, attempt_id: uuid.UUID, payload: ExitAuthorizationRequest
    ) -> ExitAuthorizationResponse:
        """Validates that exam is submitted and generates a signed exit token for OS restoration."""
        attempt = self.attempt_service.get_attempt(candidate, attempt_id)
        if not attempt.is_finalized or not attempt.receipt_id:
            raise AttemptLocked("Exam must be submitted before closure can be authorized.")

        now = utcnow()
        expires_at = now + timedelta(minutes=15)
        exit_token = self._sign_exit_token(
            attempt.id, candidate.id, payload.device_id, attempt.receipt_id, expires_at
        )

        attempt.exit_authorization_token_hash = hashlib.sha256(exit_token.encode("utf-8")).hexdigest()
        attempt.closure_status = "CLOSURE_AUTHORIZED"
        self.db.commit()

        log.info(
            "Exit authorization token issued for examination closure",
            extra={
                "attempt_id": str(attempt.id),
                "device_id": payload.device_id,
                "receipt_id": attempt.receipt_id,
            },
        )

        return ExitAuthorizationResponse(
            attempt_id=attempt.id,
            authorized=True,
            exit_token=exit_token,
            expires_at=expires_at,
            allowed_actions=["RESTORE_ENVIRONMENT", "RELEASE_LOCKDOWN", "EXIT_SHELL"],
        )

    def complete_closure(
        self, candidate: User, attempt_id: uuid.UUID, payload: ClosureCompleteRequest
    ) -> ClosureCompleteResponse:
        """Confirms successful completion of native Windows security policy restoration."""
        attempt = self.attempt_service.get_attempt(candidate, attempt_id)
        if not attempt.is_finalized:
            raise ValidationFailed("Cannot close unfinalized examination attempt.")

        # Verify exit token hash
        provided_hash = hashlib.sha256(payload.exit_token.encode("utf-8")).hexdigest()
        if not attempt.exit_authorization_token_hash or not hmac.compare_digest(
            attempt.exit_authorization_token_hash, provided_hash
        ):
            raise ValidationFailed("Invalid or unverified exit authorization token.")

        now = utcnow()
        if payload.restoration_status == "RESTORED":
            attempt.closure_status = "CLOSED"
        else:
            attempt.closure_status = "RESTORATION_FAILED"

        attempt.closure_completed_at = now
        self.db.commit()

        log.info(
            "Examination closure finalized on backend",
            extra={
                "attempt_id": str(attempt.id),
                "restoration_status": payload.restoration_status,
                "closure_status": attempt.closure_status,
            },
        )

        return ClosureCompleteResponse(
            attempt_id=attempt.id,
            closure_status=attempt.closure_status,
            completed_at=now,
        )

    def get_admin_submission_detail(self, attempt_id: uuid.UUID) -> AdminSubmissionDetail:
        """Returns administrative audit record of attempt submission, snapshot hash, and closure records."""
        attempt = self.db.get(AssessmentAttempt, attempt_id)
        if not attempt:
            raise NotFound("Assessment attempt not found.")

        questions = self.attempt_service.questions_for(attempt)
        answers = self.attempt_service.answers_for(attempt)
        first_name = attempt.candidate.first_name or ""
        last_name = attempt.candidate.last_name or ""
        candidate_name = f"{first_name} {last_name}".strip() or attempt.candidate.email

        return AdminSubmissionDetail(
            attempt_id=attempt.id,
            assessment_id=attempt.assessment_id,
            candidate_id=attempt.candidate_id,
            candidate_name=candidate_name,
            attempt_status=attempt.status.value,
            closure_status=attempt.closure_status,
            submission_id=attempt.submission_id,
            submission_type=attempt.submission_type,
            receipt_id=attempt.receipt_id,
            snapshot_hash=attempt.snapshot_hash,
            submitted_at=attempt.submitted_at,
            closure_completed_at=attempt.closure_completed_at,
            total_questions=len(questions),
            total_answered=len([a for a in answers if a.is_answered]),
            answer_snapshot=attempt.answer_snapshot,
        )

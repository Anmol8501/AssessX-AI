"""Examination Activation, Readiness Evaluation & Start Authorization Service (Phase 3A)."""

import base64
import hashlib
import hmac
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Forbidden, ValidationFailed
from app.models.assessment import Assessment, AssessmentStatus
from app.models.authorization import ConsumedActivationToken
from app.models.base import utcnow
from app.models.user import User
from app.repositories.assignments import AssignmentRepository
from app.repositories.attempts import AttemptRepository
from app.schemas.authorization import (
    CandidateEligibilityResponse,
    SessionActivationRequest,
    SessionActivationResponse,
    StartAuthorizationRequest,
    StartAuthorizationResponse,
)
from app.services.attempts import AttemptService
from app.services.device import DeviceService

log = logging.getLogger("assessx.authorization")


def _sign_activation_token(payload: dict, secret_key: str) -> str:
    """Creates a base64url-encoded HMAC-SHA256 signed token."""
    raw_payload = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(raw_payload).decode("ascii").rstrip("=")
    sig = hmac.new(secret_key.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_activation_token(token: str, secret_key: str) -> dict:
    """Verifies HMAC signature and expiration of an activation token."""
    parts = token.strip().split(".")
    if len(parts) != 2:
        raise ValidationFailed("Malformed activation token format")

    payload_b64, signature = parts
    # Restore padding
    rem = len(payload_b64) % 4
    padded = payload_b64 + ("=" * (4 - rem) if rem else "")

    expected_sig = hmac.new(
        secret_key.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, signature):
        raise Forbidden("Invalid activation token signature")

    try:
        raw_json = base64.urlsafe_b64decode(padded).decode("utf-8")
        payload = json.loads(raw_json)
    except Exception as exc:
        raise ValidationFailed("Unreadable activation token payload") from exc

    exp = payload.get("exp")
    if not exp or datetime.fromtimestamp(exp, UTC) < utcnow():
        raise Forbidden("Activation token has expired")

    return payload


class ExaminationAuthorizationService:
    """Handles Phase 3A Candidate Eligibility, Device Authorization, Readiness Validation and Start Tokens."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.attempts_repo = AttemptRepository(db)
        self.assignments_repo = AssignmentRepository(db)
        self.attempt_service = AttemptService(db)

    def check_candidate_eligibility(
        self,
        candidate: User,
        assessment_id: uuid.UUID,
        device_identifier: str | None = None,
    ) -> CandidateEligibilityResponse:
        """Server-authoritative validation of candidate, schedule, attempts, and device registration."""
        now = utcnow()

        # 1. Assignment check
        assignment = self.assignments_repo.get(assessment_id, candidate.id)
        if assignment is None:
            assessment = self.db.get(Assessment, assessment_id)
            title = assessment.title if assessment else "Examination"
            return CandidateEligibilityResponse(
                eligible=False,
                candidate_id=candidate.id,
                examination_id=assessment_id,
                title=title,
                assigned=False,
                eligibility_status="NOT_ASSIGNED",
                attempts_used=0,
                max_attempts=1,
                attempts_remaining=0,
                reason_code="EXAM_NOT_ASSIGNED",
                user_message="You are not assigned to this examination.",
                checked_at=now,
            )

        assessment = assignment.assessment
        attempts_used = self.attempts_repo.count_for_candidate(assessment_id, candidate.id)
        max_attempts = assessment.max_attempts
        attempts_remaining = max(0, max_attempts - attempts_used)

        # 2. Existing active attempt check (settles expired attempts)
        existing = self.attempts_repo.get_active(assessment_id, candidate.id)
        if existing is not None:
            self.attempt_service.settle(existing)

        active_id = existing.id if existing and existing.is_active else None

        # 3. Device check
        device_registered = False
        device_status = None
        if device_identifier:
            device = DeviceService.get_by_identifier(self.db, device_identifier)
            if device:
                device_registered = True
                device_status = device.status

        # 4. Assessment publication status
        if assessment.status != AssessmentStatus.PUBLISHED:
            return CandidateEligibilityResponse(
                eligible=False,
                candidate_id=candidate.id,
                examination_id=assessment_id,
                title=assessment.title,
                assigned=True,
                eligibility_status="NOT_PUBLISHED",
                attempts_used=attempts_used,
                max_attempts=max_attempts,
                attempts_remaining=attempts_remaining,
                window_start=assessment.availability_start,
                window_end=assessment.availability_end,
                active_attempt_id=active_id,
                device_registered=device_registered,
                device_status=device_status,
                reason_code="EXAM_NOT_PUBLISHED",
                user_message="This examination is not published yet.",
                checked_at=now,
            )

        # 5. Availability window check
        if assessment.availability_start and now < assessment.availability_start:
            return CandidateEligibilityResponse(
                eligible=False,
                candidate_id=candidate.id,
                examination_id=assessment_id,
                title=assessment.title,
                assigned=True,
                eligibility_status="OUTSIDE_WINDOW",
                attempts_used=attempts_used,
                max_attempts=max_attempts,
                attempts_remaining=attempts_remaining,
                window_start=assessment.availability_start,
                window_end=assessment.availability_end,
                active_attempt_id=active_id,
                device_registered=device_registered,
                device_status=device_status,
                reason_code="EXAM_NOT_STARTED",
                user_message="The examination has not started yet.",
                checked_at=now,
            )

        if assessment.availability_end and now > assessment.availability_end:
            return CandidateEligibilityResponse(
                eligible=False,
                candidate_id=candidate.id,
                examination_id=assessment_id,
                title=assessment.title,
                assigned=True,
                eligibility_status="OUTSIDE_WINDOW",
                attempts_used=attempts_used,
                max_attempts=max_attempts,
                attempts_remaining=attempts_remaining,
                window_start=assessment.availability_start,
                window_end=assessment.availability_end,
                active_attempt_id=active_id,
                device_registered=device_registered,
                device_status=device_status,
                reason_code="EXAM_EXPIRED",
                user_message="The examination window has closed.",
                checked_at=now,
            )

        # 6. Attempts exhausted check (if not resuming)
        if active_id is None and attempts_remaining == 0:
            return CandidateEligibilityResponse(
                eligible=False,
                candidate_id=candidate.id,
                examination_id=assessment_id,
                title=assessment.title,
                assigned=True,
                eligibility_status="ATTEMPTS_EXHAUSTED",
                attempts_used=attempts_used,
                max_attempts=max_attempts,
                attempts_remaining=0,
                window_start=assessment.availability_start,
                window_end=assessment.availability_end,
                active_attempt_id=None,
                device_registered=device_registered,
                device_status=device_status,
                reason_code="ATTEMPTS_EXHAUSTED",
                user_message=f"You have used all {max_attempts} allowed attempts for this examination.",
                checked_at=now,
            )

        # 7. Device authorization status check (enforced only when the exam requires a registered workstation)
        requires_device = bool(getattr(assessment, "require_registered_device", False))
        if requires_device and (not device_identifier or not device_registered or device_status != "ACTIVE"):
            return CandidateEligibilityResponse(
                eligible=False,
                candidate_id=candidate.id,
                examination_id=assessment_id,
                title=assessment.title,
                assigned=True,
                eligibility_status="DEVICE_UNAUTHORIZED",
                attempts_used=attempts_used,
                max_attempts=max_attempts,
                attempts_remaining=attempts_remaining,
                window_start=assessment.availability_start,
                window_end=assessment.availability_end,
                active_attempt_id=active_id,
                device_registered=device_registered,
                device_status=device_status,
                reason_code="DEVICE_NOT_APPROVED",
                user_message="This workstation is not approved or active for examination execution.",
                checked_at=now,
            )

        status_code = "ACTIVE_SESSION_EXISTS" if active_id is not None else "ELIGIBLE"
        msg = (
            "You have an active session in progress."
            if active_id
            else "You are eligible to take this examination."
        )

        return CandidateEligibilityResponse(
            eligible=True,
            candidate_id=candidate.id,
            examination_id=assessment_id,
            title=assessment.title,
            assigned=True,
            eligibility_status=status_code,
            attempts_used=attempts_used,
            max_attempts=max_attempts,
            attempts_remaining=attempts_remaining,
            window_start=assessment.availability_start,
            window_end=assessment.availability_end,
            active_attempt_id=active_id,
            device_registered=device_registered,
            device_status=device_status,
            reason_code=None,
            user_message=msg,
            checked_at=now,
        )

    def authorize_examination_start(
        self,
        candidate: User,
        assessment_id: uuid.UUID,
        req: StartAuthorizationRequest,
    ) -> StartAuthorizationResponse:
        """Validates readiness report, device credentials, and issues an activation token (TTL: 120s)."""
        now = utcnow()

        # Step 1: Validate candidate eligibility
        eligibility = self.check_candidate_eligibility(candidate, assessment_id, req.device_identifier)
        if not eligibility.eligible:
            raise Forbidden(eligibility.user_message or "Candidate is not eligible to start this examination")

        # Step 2: Validate device authorization (only when assessment requires registered workstations)
        assessment = self.db.get(Assessment, assessment_id)
        if bool(getattr(assessment, "require_registered_device", False)):
            device = DeviceService.get_by_identifier(self.db, req.device_identifier)
            if not device or device.status != "ACTIVE":
                raise Forbidden("Workstation is not authorized for examination execution")

        # Step 3: Validate readiness report
        for check in req.readiness_report.checks:
            if check.mandatory and check.status in ("NOT_READY", "VERIFICATION_FAILED"):
                raise Forbidden(
                    f"Mandatory security readiness check '{check.check_id}' failed: {check.message}"
                )

        # Step 4: Issue signed short-lived activation token (120s TTL)
        token_expires_at = now + timedelta(seconds=120)
        auth_id = f"auth_{uuid.uuid4().hex[:16]}"
        attempt_number = eligibility.attempts_used + (0 if eligibility.active_attempt_id else 1)

        token_payload = {
            "jti": str(uuid.uuid4()),
            "auth_id": auth_id,
            "sub": str(candidate.id),
            "exam_id": str(assessment_id),
            "device_id": req.device_identifier,
            "attempt_number": attempt_number,
            "policy_version": 1,
            "iat": int(now.timestamp()),
            "exp": int(token_expires_at.timestamp()),
        }

        secret = get_settings().secret_key
        activation_token = _sign_activation_token(token_payload, secret)

        log.info(
            "Issued exam activation authorization %s for candidate %s, exam %s, device %s",
            auth_id,
            candidate.id,
            assessment_id,
            req.device_identifier,
        )

        return StartAuthorizationResponse(
            authorized=True,
            authorization_id=auth_id,
            candidate_id=candidate.id,
            examination_id=assessment_id,
            device_identifier=req.device_identifier,
            attempt_number=attempt_number,
            attempt_id=eligibility.active_attempt_id,
            policy_version=1,
            activation_token=activation_token,
            token_expires_at=token_expires_at,
            reason_code=None,
            user_message="Examination authorization granted. Enter secure environment within 120 seconds.",
            authorized_at=now,
        )

    def activate_session(
        self,
        candidate: User,
        assessment_id: uuid.UUID,
        req: SessionActivationRequest,
    ) -> SessionActivationResponse:
        """Consumes the activation token, starts/resumes the sitting, and returns session confirmation."""
        secret = get_settings().secret_key
        payload = _verify_activation_token(req.activation_token, secret)

        if payload.get("sub") != str(candidate.id):
            raise Forbidden("Activation token candidate mismatch")
        if payload.get("exam_id") != str(assessment_id):
            raise Forbidden("Activation token examination mismatch")
        if payload.get("device_id") != req.device_identifier:
            raise Forbidden("Activation token device mismatch")

        jti = payload.get("jti")
        if not jti or not isinstance(jti, str):
            raise ValidationFailed("Activation token is missing single-use identifier (jti)")

        # Prevent replay by persisting consumed JTI in DB before starting the sitting
        if self.db.get(ConsumedActivationToken, jti) is not None:
            raise Forbidden("Activation token has already been consumed")

        exp_ts = payload.get("exp")
        expires_at = (
            datetime.fromtimestamp(exp_ts, UTC)
            if isinstance(exp_ts, (int, float))
            else utcnow() + timedelta(seconds=120)
        )
        self.db.add(
            ConsumedActivationToken(
                jti=jti,
                candidate_id=candidate.id,
                assessment_id=assessment_id,
                device_identifier=req.device_identifier,
                expires_at=expires_at,
            )
        )
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise Forbidden("Activation token has already been consumed") from exc

        # Start or resume sitting
        attempt, _created = self.attempt_service.start_or_resume(candidate, assessment_id)
        now = utcnow()

        log.info(
            "Candidate %s successfully activated exam sitting %s on device %s",
            candidate.id,
            attempt.id,
            req.device_identifier,
        )

        return SessionActivationResponse(
            activated=True,
            attempt_id=attempt.id,
            status=attempt.status.value,
            started_at=attempt.started_at,
            expires_at=attempt.expires_at,
            remaining_seconds=attempt.remaining_seconds(now),
        )

"""Service implementation for Phase 3B: Examination Session Continuity, Answer Persistence & Recovery.

Handles:
- Atomic batch answer synchronization with monotonic revisions
- Idempotency deduplication
- Out-of-order revision rejection
- Periodic heartbeat health monitoring and dropout detection (>60s silence)
- Crash recovery and resumption handshake
"""

import hashlib
import hmac
import logging
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AttemptLocked, AttemptOnHold, NotFound
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.base import utcnow
from app.models.question import SINGLE_ANSWER_TYPES
from app.models.user import User
from app.schemas.session_continuity import (
    AnswerSyncBatchRequest,
    AnswerSyncBatchResponse,
    AnswerSyncItemResult,
    AttemptContinuitySummary,
    SessionHeartbeatRequest,
    SessionHeartbeatResponse,
    SessionRecoveryAnswerItem,
    SessionRecoveryRequest,
    SessionRecoveryResponse,
)
from app.services.attempts import AttemptService
from app.services.proctoring import ProctoringService

log = logging.getLogger("assessx.session_continuity")


class SessionContinuityService:
    """Manages answer synchronization, heartbeat telemetry, and crash recovery."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.attempt_service = AttemptService(db)

    @staticmethod
    def _signing_secret() -> bytes:
        raw = get_settings().secret_key
        value = raw.get_secret_value() if hasattr(raw, "get_secret_value") else str(raw)
        if not value:
            raise RuntimeError("SECRET_KEY is not configured.")
        return value.encode("utf-8")

    def _generate_recovery_token(
        self, attempt_id: uuid.UUID, candidate_id: uuid.UUID, timestamp: datetime
    ) -> str:
        secret = self._signing_secret()
        payload = f"{attempt_id}:{candidate_id}:{timestamp.isoformat()}".encode()
        sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()
        return f"{attempt_id}.{int(timestamp.timestamp())}.{sig}"

    def _verify_recovery_token(
        self,
        token: str,
        attempt_id: uuid.UUID,
        candidate_id: uuid.UUID,
        timestamp: datetime,
        *,
        ttl_seconds: int = 300,
        now: datetime | None = None,
    ) -> bool:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return False
        tok_attempt, ts_str, sig = parts
        if tok_attempt != str(attempt_id):
            return False
        try:
            issued_ts = int(ts_str)
        except ValueError:
            return False
        current = now or utcnow()
        if int(current.timestamp()) - issued_ts > ttl_seconds:
            return False
        secret = self._signing_secret()
        payload = f"{attempt_id}:{candidate_id}:{timestamp.isoformat()}".encode()
        expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)

    def sync_answers(self, candidate: User, payload: AnswerSyncBatchRequest) -> AnswerSyncBatchResponse:
        """Atomically processes a batch of answer updates with revision ordering and idempotency checks."""
        attempt = self.attempt_service.get_attempt(candidate, payload.attempt_id)
        if attempt.status is AttemptStatus.TIME_EXPIRED:
            raise AttemptLocked("Time ran out before these answers could be synchronized.")
        if attempt.is_on_hold:
            raise AttemptOnHold("Examination attempt is currently on hold.")

        ProctoringService(self.db).require_active_if_proctored(attempt)
        questions_by_id = {q.id: q for q in self.attempt_service.questions_for(attempt)}
        results: list[AnswerSyncItemResult] = []
        now = utcnow()

        for item in payload.answers:
            question = questions_by_id.get(item.question_id)
            if not question:
                results.append(
                    AnswerSyncItemResult(
                        question_id=item.question_id,
                        status="conflict",
                        server_revision=0,
                        synced_at=now,
                        message="Question does not belong to this assessment.",
                    )
                )
                continue

            selected = list(dict.fromkeys(item.selected_option_ids))
            allowed = {option.id for option in question.options}
            unknown = [str(opt) for opt in selected if opt not in allowed]
            if unknown:
                results.append(
                    AnswerSyncItemResult(
                        question_id=item.question_id,
                        status="conflict",
                        server_revision=0,
                        synced_at=now,
                        message=f"Unknown option selected: {unknown[0]}.",
                    )
                )
                continue

            if question.type in SINGLE_ANSWER_TYPES and len(selected) > 1:
                results.append(
                    AnswerSyncItemResult(
                        question_id=item.question_id,
                        status="conflict",
                        server_revision=0,
                        synced_at=now,
                        message="Multiple options provided for single-answer question.",
                    )
                )
                continue

            answer = self.attempt_service._answer_row(attempt, item.question_id)

            # Idempotency check: exactly the same mutation request repeated
            if answer.idempotency_key == item.idempotency_key:
                results.append(
                    AnswerSyncItemResult(
                        question_id=item.question_id,
                        status="synced",
                        server_revision=answer.server_revision,
                        synced_at=answer.synced_at or now,
                        message="Duplicate idempotency key; already synchronized.",
                    )
                )
                continue

            # Monotonic revision check: reject older or stale writes arriving out-of-order
            if item.client_revision < answer.client_revision:
                results.append(
                    AnswerSyncItemResult(
                        question_id=item.question_id,
                        status="ignored_older_revision",
                        server_revision=answer.server_revision,
                        synced_at=answer.synced_at or now,
                        message=f"Ignored stale revision {item.client_revision} < {answer.client_revision}.",
                    )
                )
                continue

            # Apply selections and bump revisions
            self.attempt_service.attempts.replace_selections(answer, selected)
            answer.client_revision = item.client_revision
            answer.server_revision = (answer.server_revision or 0) + 1
            answer.idempotency_key = item.idempotency_key
            answer.synced_at = now
            self.db.flush()

            results.append(
                AnswerSyncItemResult(
                    question_id=item.question_id,
                    status="synced",
                    server_revision=answer.server_revision,
                    synced_at=now,
                )
            )

        self.db.commit()
        return AnswerSyncBatchResponse(
            attempt_id=attempt.id,
            results=results,
            server_timestamp=now,
        )

    def process_heartbeat(
        self, candidate: User, payload: SessionHeartbeatRequest
    ) -> SessionHeartbeatResponse:
        """Processes periodic client heartbeat and updates session continuity metrics."""
        attempt = self.attempt_service.get_attempt(candidate, payload.attempt_id)
        now = utcnow()
        attempt.last_heartbeat_at = now
        attempt.heartbeat_device_id = payload.device_id
        attempt.heartbeat_network_quality = payload.network_quality
        attempt.pending_sync_count = payload.pending_sync_count
        attempt.last_synced_revision = payload.last_synced_revision
        self.db.commit()

        action = "NONE"
        if not attempt.is_active:
            action = "TERMINATE"
        elif attempt.is_on_hold:
            action = "REFRESH_SESSION"

        return SessionHeartbeatResponse(
            attempt_id=attempt.id,
            status=attempt.status.value,
            server_timestamp=now,
            remaining_seconds=attempt.remaining_seconds(now),
            action_required=action,
        )

    def recover_session(self, candidate: User, payload: SessionRecoveryRequest) -> SessionRecoveryResponse:
        """Restores examination attempt state following unexpected restart or connectivity disruption."""
        attempt = self.attempt_service.get_attempt(candidate, payload.attempt_id)
        now = utcnow()

        if not attempt.is_active:
            return SessionRecoveryResponse(
                attempt_id=attempt.id,
                status=attempt.status.value,
                resumable=False,
                remaining_seconds=0,
                server_answers=[],
                server_revision=attempt.last_synced_revision,
                recovery_token="",
                server_timestamp=now,
            )

        token = self._generate_recovery_token(attempt.id, candidate.id, now)
        attempt.recovery_token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        attempt.last_heartbeat_at = now
        attempt.heartbeat_device_id = payload.device_id
        self.db.commit()

        answers = self.attempt_service.answers_for(attempt)
        answer_items = [
            SessionRecoveryAnswerItem(
                question_id=a.question_id,
                selected_option_ids=a.selected_option_ids,
                server_revision=a.server_revision,
                updated_at=a.updated_at,
            )
            for a in answers
        ]

        max_server_revision = max([a.server_revision for a in answers], default=0)

        log.info(
            "Examination session recovered successfully",
            extra={
                "attempt_id": str(attempt.id),
                "candidate_id": str(candidate.id),
                "device_id": payload.device_id,
                "answers_count": len(answer_items),
            },
        )

        return SessionRecoveryResponse(
            attempt_id=attempt.id,
            status=attempt.status.value,
            resumable=True,
            remaining_seconds=attempt.remaining_seconds(now),
            server_answers=answer_items,
            server_revision=max_server_revision,
            recovery_token=token,
            server_timestamp=now,
        )

    def get_continuity_summary(self, attempt_id: uuid.UUID) -> AttemptContinuitySummary:
        """Returns live session continuity metrics for proctor/admin dashboard."""
        attempt = self.db.get(AssessmentAttempt, attempt_id)
        if not attempt:
            raise NotFound("Assessment attempt not found.")

        now = utcnow()
        seconds_since = None
        is_dropped_out = False

        if attempt.last_heartbeat_at:
            seconds_since = int((now - attempt.last_heartbeat_at).total_seconds())
            if attempt.is_active and seconds_since > 60:
                is_dropped_out = True
        elif attempt.is_active:
            is_dropped_out = True

        answers = self.attempt_service.answers_for(attempt)
        candidate_name = f"{attempt.candidate.first_name} {attempt.candidate.last_name}".strip()
        if not candidate_name:
            candidate_name = attempt.candidate.email

        return AttemptContinuitySummary(
            attempt_id=attempt.id,
            candidate_id=attempt.candidate_id,
            candidate_name=candidate_name,
            status=attempt.status.value,
            last_heartbeat_at=attempt.last_heartbeat_at,
            seconds_since_heartbeat=seconds_since,
            is_dropped_out=is_dropped_out,
            device_id=attempt.heartbeat_device_id,
            network_quality=attempt.heartbeat_network_quality,
            pending_sync_count=attempt.pending_sync_count,
            last_synced_revision=attempt.last_synced_revision,
            total_answers_synced=len([a for a in answers if a.is_answered]),
        )

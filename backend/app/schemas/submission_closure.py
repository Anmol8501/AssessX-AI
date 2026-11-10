"""Pydantic schemas for Phase 3C: Secure Examination Submission, Exit Authorization & Closure.

Defines schemas for:
- Pre-submission summary & validation
- Final submission confirmation with canonical answer snapshot
- Cryptographically verifiable submission receipts
- Signed exit authorization tokens
- Native security restoration completion & admin submission auditing
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SubmissionPrepareResponse(BaseModel):
    """Factual summary presented to candidate before final submission confirmation."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    total_questions: int
    answered_questions: int
    unanswered_questions: int
    remaining_seconds: int
    pending_sync_count: int
    eligible_for_submission: bool
    reason: str | None = None


class SubmissionConfirmRequest(BaseModel):
    """Payload to finalize an examination attempt and commit answer immutability."""

    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(..., min_length=8, max_length=64)
    device_id: str = Field(..., max_length=128)
    submission_type: Literal["MANUAL", "AUTOMATIC_TIMEOUT"] = "MANUAL"


class SubmissionConfirmResponse(BaseModel):
    """Authoritative server response confirming final submission and receipt issuance."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    submission_id: uuid.UUID
    receipt_id: str
    submission_type: str
    submitted_at: datetime
    snapshot_hash: str
    total_questions: int
    total_answered: int
    status: str


class SubmissionReceiptResponse(BaseModel):
    """Immutable submission receipt retrievable across restarts and reloads."""

    model_config = ConfigDict(from_attributes=True)

    receipt_id: str
    submission_id: uuid.UUID
    attempt_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    examination_title: str
    submitted_at: datetime
    submission_type: str
    snapshot_hash: str
    total_answered: int
    total_questions: int
    status: str


class ExitAuthorizationRequest(BaseModel):
    """Request by candidate terminal for cryptographic authorization to teardown kiosk/policies."""

    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(..., max_length=128)


class ExitAuthorizationResponse(BaseModel):
    """Signed authorization token delivered to desktop client to trigger native OS restoration."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    authorized: bool
    exit_token: str
    expires_at: datetime
    allowed_actions: list[str]


class ClosureCompleteRequest(BaseModel):
    """Report from desktop native layer acknowledging completion of Windows security restoration."""

    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(..., max_length=128)
    exit_token: str
    restoration_status: Literal["RESTORED", "PARTIAL_FAILURE", "FAILED"]
    restored_subsystems: list[str]
    error_message: str | None = None


class ClosureCompleteResponse(BaseModel):
    """Final server acknowledgement marking examination session permanently closed."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    closure_status: str
    completed_at: datetime


class AdminSubmissionDetail(BaseModel):
    """Comprehensive admin view of attempt submission, snapshot integrity, and closure records."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    assessment_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    attempt_status: str
    closure_status: str
    submission_id: uuid.UUID | None
    submission_type: str | None
    receipt_id: str | None
    snapshot_hash: str | None
    submitted_at: datetime | None
    closure_completed_at: datetime | None
    total_questions: int
    total_answered: int
    answer_snapshot: dict | None

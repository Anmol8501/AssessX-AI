"""Pydantic schemas for Phase 3A Examination Activation & Start Authorization."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SecurityReadinessCheckItem(BaseModel):
    """Result of an individual native security readiness check."""

    check_id: str = Field(description="Unique identifier for the check, e.g. agent_health")
    category: str = Field(description="Category, e.g. Agent, SecurityPolicies, Peripherals")
    status: str = Field(description="Status: READY, NOT_READY, WARNING, UNSUPPORTED, VERIFICATION_FAILED")
    mandatory: bool = Field(default=True, description="Whether failure blocks authorization")
    message: str = Field(description="Candidate-facing or diagnostic message")
    details: dict[str, Any] | None = Field(default=None, description="Optional diagnostic details")


class PreFlightReadinessReport(BaseModel):
    """Aggregate pre-flight readiness report submitted by the desktop client."""

    device_identifier: str = Field(min_length=16, max_length=64)
    agent_version: str = Field(default="1.0.0", max_length=32)
    overall_status: str = Field(description="READY, NOT_READY, WARNING")
    checks: list[SecurityReadinessCheckItem] = Field(default_factory=list)
    checked_at: datetime = Field(default_factory=datetime.utcnow)


class CandidateEligibilityResponse(BaseModel):
    """Server-authoritative candidate eligibility evaluation."""

    model_config = ConfigDict(from_attributes=True)

    eligible: bool
    candidate_id: uuid.UUID
    examination_id: uuid.UUID
    title: str
    assigned: bool
    eligibility_status: str = Field(
        description="ELIGIBLE, NOT_ASSIGNED, NOT_PUBLISHED, OUTSIDE_WINDOW, "
        "ATTEMPTS_EXHAUSTED, ACTIVE_SESSION_EXISTS, DEVICE_UNAUTHORIZED"
    )
    attempts_used: int
    max_attempts: int
    attempts_remaining: int
    window_start: datetime | None = None
    window_end: datetime | None = None
    active_attempt_id: uuid.UUID | None = None
    device_registered: bool = False
    device_status: str | None = None
    reason_code: str | None = None
    user_message: str | None = None
    checked_at: datetime = Field(default_factory=datetime.utcnow)


class StartAuthorizationRequest(BaseModel):
    """Request by candidate desktop to obtain a signed examination activation token."""

    device_identifier: str = Field(min_length=16, max_length=64)
    readiness_report: PreFlightReadinessReport


class StartAuthorizationResponse(BaseModel):
    """Signed activation token and authorization context."""

    authorized: bool
    authorization_id: str
    candidate_id: uuid.UUID
    examination_id: uuid.UUID
    device_identifier: str
    attempt_number: int
    attempt_id: uuid.UUID | None = None
    policy_version: int = 1
    activation_token: str
    token_expires_at: datetime
    reason_code: str | None = None
    user_message: str | None = None
    authorized_at: datetime = Field(default_factory=datetime.utcnow)


class SessionActivationRequest(BaseModel):
    """Client notification that secure shell and hooks are locked, claiming activation."""

    activation_token: str
    device_identifier: str = Field(min_length=16, max_length=64)


class SessionActivationResponse(BaseModel):
    """Active session confirmation."""

    activated: bool
    attempt_id: uuid.UUID
    status: str
    started_at: datetime
    expires_at: datetime
    remaining_seconds: int

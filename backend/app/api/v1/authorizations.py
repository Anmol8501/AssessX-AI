"""Examination Authorization & Activation endpoints (Phase 3A)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Header

from app.api.deps import CandidateUser, DbSession
from app.schemas.authorization import (
    CandidateEligibilityResponse,
    SessionActivationRequest,
    SessionActivationResponse,
    StartAuthorizationRequest,
    StartAuthorizationResponse,
)
from app.services.authorization import ExaminationAuthorizationService

router = APIRouter(prefix="/examinations", tags=["examination authorization"])


@router.get("/{exam_id}/eligibility", response_model=CandidateEligibilityResponse)
def check_eligibility(
    exam_id: uuid.UUID,
    user: CandidateUser,
    db: DbSession,
    x_device_id: Annotated[str | None, Header(alias="X-Device-Id")] = None,
) -> CandidateEligibilityResponse:
    """Evaluate candidate eligibility, attempt count, schedule window, and device registration."""
    service = ExaminationAuthorizationService(db)
    return service.check_candidate_eligibility(
        candidate=user,
        assessment_id=exam_id,
        device_identifier=x_device_id,
    )


@router.post("/{exam_id}/authorize", response_model=StartAuthorizationResponse)
def authorize_start(
    exam_id: uuid.UUID,
    req: StartAuthorizationRequest,
    user: CandidateUser,
    db: DbSession,
) -> StartAuthorizationResponse:
    """Validate client pre-flight security readiness report and issue
    short-lived activation token (120s TTL).
    """
    service = ExaminationAuthorizationService(db)
    return service.authorize_examination_start(
        candidate=user,
        assessment_id=exam_id,
        req=req,
    )


@router.post("/{exam_id}/activate-session", response_model=SessionActivationResponse)
def activate_session(
    exam_id: uuid.UUID,
    req: SessionActivationRequest,
    user: CandidateUser,
    db: DbSession,
) -> SessionActivationResponse:
    """Consume the signed activation token and transition session into ACTIVE state."""
    service = ExaminationAuthorizationService(db)
    return service.activate_session(
        candidate=user,
        assessment_id=exam_id,
        req=req,
    )

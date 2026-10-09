import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import AdminUser, AppSettings, CandidateUser, DbSession
from app.api.paging import PageDep
from app.core.errors import NotFound
from app.models.audit_log import AuditAction
from app.models.user import User, UserRole
from app.repositories.audit import AuditRepository
from app.schemas.assignment import CandidateCreate, CandidateSummary, MyAssessment
from app.schemas.auth import ResetCodeIssued, SessionsRevoked
from app.schemas.user import UserPublic
from app.services.assignments import AssignmentService, CandidateService
from app.services.attempts import AttemptService
from app.services.auth import AuthService

router = APIRouter(prefix="/candidates", tags=["candidates"])


@router.get("/me", response_model=UserPublic)
def my_candidate_profile(user: CandidateUser) -> UserPublic:
    """Candidate-only view of the signed-in candidate."""
    return UserPublic.model_validate(user)


@router.get("/me/assessments", response_model=list[MyAssessment])
def my_assessments(
    user: CandidateUser, db: DbSession, page: PageDep, response: Response
) -> list[MyAssessment]:
    """The signed-in candidate's assigned assessments.

    Scoped to `user.id` from the session — a candidate can never request another candidate's list.
    Carries no questions and no answer keys; those reach the candidate only through an attempt.
    `active_attempt_id` is what lets a card offer Resume instead of Start, and is resolved for the
    whole list in one query.
    """
    rows = page.finish(AssignmentService(db).list_for_candidate(user.id, page), response)
    # Settles each attempt's clock, so an exam whose time ran out while the application was closed
    # shows as finished here rather than offering to resume. Only this page's assessments (CX-04).
    latest = AttemptService(db).latest_attempts(user, [a.assessment_id for a, _ in rows])
    return [
        MyAssessment.of(
            assignment,
            question_count,
            attempt.id if (attempt := latest.get(assignment.assessment_id)) and attempt.is_active else None,
            attempt.status if attempt else None,
        )
        for assignment, question_count in rows
    ]


@router.get("", response_model=list[CandidateSummary])
def list_candidates(
    _: AdminUser,
    db: DbSession,
    page: PageDep,
    response: Response,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> list[CandidateSummary]:
    """Admin-only. Candidates with how many assessments each holds; `q` finds one by part of the name,
    email or roll number (paged lists need a way to reach a row beyond the first page)."""
    return [
        CandidateSummary(
            id=candidate.id,
            name=candidate.name,
            email=candidate.email,
            roll_number=candidate.roll_number,
            is_active=candidate.is_active,
            assignment_count=count,
            created_at=candidate.created_at,
        )
        for candidate, count in page.finish(CandidateService(db).list_with_counts(page, q), response)
    ]


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_candidate(payload: CandidateCreate, admin: AdminUser, db: DbSession) -> UserPublic:
    """Admin-only. Always creates a CANDIDATE; the role is never taken from the request. Audited."""
    created = CandidateService(db).create(payload)
    AuditRepository(db).record(
        actor_id=admin.id, action=AuditAction.CANDIDATE_CREATED, details={"user_id": str(created.id)}
    )
    return UserPublic.model_validate(created)


def _candidate(db: DbSession, candidate_id: uuid.UUID) -> User:
    user = db.get(User, candidate_id)
    if user is None or user.role is not UserRole.CANDIDATE:
        raise NotFound("Candidate not found.")
    return user


@router.post("/{candidate_id}/deactivate", response_model=UserPublic)
def deactivate_candidate(
    candidate_id: uuid.UUID, admin: AdminUser, db: DbSession, settings: AppSettings
) -> UserPublic:
    """Blocks the candidate from signing in and ends every session they have. Audited."""
    user = AuthService(db, settings).set_active(_candidate(db, candidate_id), False, admin=admin)
    return UserPublic.model_validate(user)


@router.post("/{candidate_id}/reactivate", response_model=UserPublic)
def reactivate_candidate(
    candidate_id: uuid.UUID, admin: AdminUser, db: DbSession, settings: AppSettings
) -> UserPublic:
    user = AuthService(db, settings).set_active(_candidate(db, candidate_id), True, admin=admin)
    return UserPublic.model_validate(user)


@router.post("/{candidate_id}/revoke-sessions", response_model=SessionsRevoked)
def revoke_candidate_sessions(
    candidate_id: uuid.UUID, admin: AdminUser, db: DbSession, settings: AppSettings
) -> SessionsRevoked:
    """Signs the candidate out everywhere (they can sign in again). Audited."""
    count = AuthService(db, settings).revoke_all(_candidate(db, candidate_id), actor=admin, reason="admin")
    return SessionsRevoked(sessions_ended=count)


@router.post("/{candidate_id}/reset-code", response_model=ResetCodeIssued)
def issue_reset_code(
    candidate_id: uuid.UUID, admin: AdminUser, db: DbSession, settings: AppSettings
) -> ResetCodeIssued:
    """A one-time code for the candidate to set a new password (`POST /auth/password-reset`). Shown
    once, here; only its HMAC is stored. Short-lived, single-use; issuing another voids the old one."""
    code, expires = AuthService(db, settings).issue_reset_code(_candidate(db, candidate_id), admin=admin)
    return ResetCodeIssued(code=code, expires_at=expires)


@router.get("/{candidate_id}", response_model=CandidateSummary)
def get_candidate(candidate_id: uuid.UUID, _: AdminUser, db: DbSession) -> CandidateSummary:
    for candidate, count in CandidateService(db).list_with_counts():
        if candidate.id == candidate_id:
            return CandidateSummary(
                id=candidate.id,
                name=candidate.name,
                email=candidate.email,
                roll_number=candidate.roll_number,
                is_active=candidate.is_active,
                assignment_count=count,
                created_at=candidate.created_at,
            )
    raise NotFound("Candidate not found.")

import uuid

from fastapi import APIRouter, status

from app.api.deps import AdminUser, CandidateUser, DbSession
from app.core.errors import NotFound
from app.schemas.assignment import CandidateCreate, CandidateSummary, MyAssessment
from app.schemas.user import UserPublic
from app.services.assignments import AssignmentService, CandidateService

router = APIRouter(prefix="/candidates", tags=["candidates"])


@router.get("/me", response_model=UserPublic)
def my_candidate_profile(user: CandidateUser) -> UserPublic:
    """Candidate-only view of the signed-in candidate."""
    return UserPublic.model_validate(user)


@router.get("/me/assessments", response_model=list[MyAssessment])
def my_assessments(user: CandidateUser, db: DbSession) -> list[MyAssessment]:
    """The signed-in candidate's assigned assessments.

    Scoped to `user.id` from the session — a candidate can never request another candidate's list.
    Carries no questions or answer keys: taking an exam arrives in Phase 3.
    """
    rows = AssignmentService(db).list_for_candidate(user.id)
    return [
        MyAssessment(
            assignment_id=assignment.id,
            assessment_id=assignment.assessment.id,
            title=assignment.assessment.title,
            description=assignment.assessment.description,
            instructions=assignment.assessment.instructions,
            duration_minutes=assignment.assessment.duration_minutes,
            total_marks=assignment.assessment.total_marks,
            passing_marks=assignment.assessment.passing_marks,
            question_count=question_count,
            max_attempts=assignment.assessment.max_attempts,
            availability_start=assignment.assessment.availability_start,
            availability_end=assignment.assessment.availability_end,
            status=assignment.status,
            assessment_status=assignment.assessment.status,
            assigned_at=assignment.assigned_at,
        )
        for assignment, question_count in rows
    ]


@router.get("", response_model=list[CandidateSummary])
def list_candidates(_: AdminUser, db: DbSession) -> list[CandidateSummary]:
    """Admin-only. Demo candidates with how many assessments each holds."""
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
        for candidate, count in CandidateService(db).list_with_counts()
    ]


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_candidate(payload: CandidateCreate, _: AdminUser, db: DbSession) -> UserPublic:
    """Admin-only. Always creates a CANDIDATE; the role is never taken from the request."""
    return UserPublic.model_validate(CandidateService(db).create(payload))


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

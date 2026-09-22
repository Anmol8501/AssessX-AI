from fastapi import APIRouter

from app.api.deps import CandidateUser
from app.schemas.user import UserPublic

router = APIRouter(prefix="/candidates", tags=["candidates"])


@router.get("/me", response_model=UserPublic)
def my_candidate_profile(user: CandidateUser) -> UserPublic:
    """Candidate-only view of the signed-in candidate. Assigned exams attach here in Phase 2."""
    return UserPublic.model_validate(user)

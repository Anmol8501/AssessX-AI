from fastapi import APIRouter, status

from app.api.deps import AppSettings, AuthServiceDep, CurrentSession, CurrentUser, DbSession
from app.schemas.auth import AdminLoginRequest, CandidateLoginRequest, ChallengeResponse, LoginResponse
from app.schemas.user import UserPublic
from app.services.auth import IssuedSession
from app.services.challenges import LoginChallengeService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/challenge", response_model=ChallengeResponse)
def issue_challenge(db: DbSession, settings: AppSettings) -> ChallengeResponse:
    """Issues the sign-in security check. The answer never leaves the server."""
    challenge, svg = LoginChallengeService(db, settings).issue()
    return ChallengeResponse(challenge_id=challenge.id, image_svg=svg, expires_at=challenge.expires_at)


@router.post("/login/candidate", response_model=LoginResponse)
def login_candidate(payload: CandidateLoginRequest, auth: AuthServiceDep) -> LoginResponse:
    issued = auth.login_candidate(
        roll_number=payload.roll_number,
        email=payload.email,
        password=payload.password,
        challenge_id=payload.challenge_id,
        challenge_answer=payload.challenge_answer,
        remember=payload.remember_me,
    )
    return _login_response(issued)


@router.post("/login/admin", response_model=LoginResponse)
def login_admin(payload: AdminLoginRequest, auth: AuthServiceDep) -> LoginResponse:
    issued = auth.login_admin(
        username=payload.username,
        email=payload.email,
        password=payload.password,
        challenge_id=payload.challenge_id,
        challenge_answer=payload.challenge_answer,
        remember=payload.remember_me,
    )
    return _login_response(issued)


def _login_response(issued: IssuedSession) -> LoginResponse:
    return LoginResponse(
        token=issued.token, expires_at=issued.expires_at, user=UserPublic.model_validate(issued.user)
    )


@router.get("/me", response_model=UserPublic)
def me(user: CurrentUser) -> UserPublic:
    return UserPublic.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(session: CurrentSession, auth: AuthServiceDep) -> None:
    auth.logout(session)

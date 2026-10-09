from fastapi import APIRouter, Request, status

from app.api.deps import (
    AppSettings,
    AuthServiceDep,
    CurrentSession,
    DbSession,
    SignedInUser,
    VerifiedSession,
)
from app.core.config import get_settings
from app.core.limits import client_ip
from app.models.user import UserRole
from app.schemas.auth import (
    AdminLoginRequest,
    CandidateLoginRequest,
    ChallengeResponse,
    ChangePasswordRequest,
    LoginResponse,
    MfaCode,
    MfaEnrolment,
    MfaRecoveryCodes,
    MfaStatus,
    RedeemResetRequest,
    SessionsRevoked,
)
from app.schemas.user import UserPublic
from app.services.auth import IssuedSession
from app.services.challenges import LoginChallengeService
from app.services.login_throttle import LoginThrottle

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/challenge", response_model=ChallengeResponse)
def issue_challenge(request: Request, db: DbSession, settings: AppSettings) -> ChallengeResponse:
    """Issues the sign-in security check. The answer never leaves the server. Each client may ask for
    a bounded number per window (every challenge is a database row)."""
    LoginThrottle(db, settings).challenge_issued(client_ip(request))
    challenge, svg = LoginChallengeService(db, settings).issue()
    return ChallengeResponse(challenge_id=challenge.id, image_svg=svg, expires_at=challenge.expires_at)


@router.post("/login/candidate", response_model=LoginResponse)
def login_candidate(payload: CandidateLoginRequest, request: Request, auth: AuthServiceDep) -> LoginResponse:
    issued = auth.login_candidate(
        client=client_ip(request),
        roll_number=payload.roll_number,
        email=payload.email,
        password=payload.password,
        challenge_id=payload.challenge_id,
        challenge_answer=payload.challenge_answer,
        remember=payload.remember_me,
    )
    return _login_response(issued)


@router.post("/login/admin", response_model=LoginResponse)
def login_admin(payload: AdminLoginRequest, request: Request, auth: AuthServiceDep) -> LoginResponse:
    issued = auth.login_admin(
        client=client_ip(request),
        username=payload.username,
        email=payload.email,
        password=payload.password,
        challenge_id=payload.challenge_id,
        challenge_answer=payload.challenge_answer,
        remember=payload.remember_me,
    )
    return _login_response(issued)


def _login_response(issued: IssuedSession) -> LoginResponse:
    user = issued.user
    settings = get_settings()
    needs = user.role is UserRole.ADMIN and (settings.mfa_required or user.mfa_enabled)
    mfa = ("required" if user.mfa_enabled else "enroll") if needs else "none"
    return LoginResponse(
        token=issued.token, expires_at=issued.expires_at, user=UserPublic.model_validate(user), mfa=mfa
    )


@router.get("/me", response_model=UserPublic)
def me(user: SignedInUser) -> UserPublic:
    return UserPublic.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(session: CurrentSession, auth: AuthServiceDep) -> None:
    auth.logout(session)


@router.post("/logout-all", response_model=SessionsRevoked)
def logout_everywhere(session: CurrentSession, auth: AuthServiceDep) -> SessionsRevoked:
    """Ends every session of the signed-in user, including this one (e.g. after a lost laptop)."""
    count = auth.revoke_all(session.user, actor=session.user, reason="user")
    return SessionsRevoked(sessions_ended=count)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: ChangePasswordRequest, session: VerifiedSession, auth: AuthServiceDep) -> None:
    """Changes the signed-in user's password. This session stays signed in; every other one ends."""
    auth.change_password(session, payload.current_password, payload.new_password)


@router.post("/password-reset", status_code=status.HTTP_204_NO_CONTENT)
def redeem_reset_code(payload: RedeemResetRequest, request: Request, auth: AuthServiceDep) -> None:
    """Sets a new password with a one-time code an administrator issued. Throttled like sign-in; one
    generic error for any wrong detail. Every session of the account ends."""
    auth.redeem_reset_code(
        email=payload.email,
        code=payload.code,
        new_password=payload.new_password,
        challenge_id=payload.challenge_id,
        challenge_answer=payload.challenge_answer,
        client=client_ip(request),
    )


# -- admin two-factor sign-in (Phase 8 final, CX-07) -----------------------------------------------------


@router.get("/mfa", response_model=MfaStatus)
def mfa_status(session: CurrentSession, settings: AppSettings, db: DbSession) -> MfaStatus:
    """Where this sign-in stands with the second factor."""
    from app.services.mfa import MfaService

    user = session.user
    return MfaStatus(
        required=MfaService(db, settings).required_for(user),
        enabled=user.mfa_enabled,
        verified=session.mfa_verified_at is not None,
        recovery_codes_left=len(user.mfa_recovery_hashes or []),
    )


@router.post("/mfa/enroll", response_model=MfaEnrolment)
def mfa_enroll(session: CurrentSession, settings: AppSettings, db: DbSession) -> MfaEnrolment:
    """Starts set-up: a new secret for the authenticator app (admins only, shown once)."""
    from app.services.mfa import MfaService

    secret, uri = MfaService(db, settings).begin_enrolment(session)
    return MfaEnrolment(secret=secret, otpauth_uri=uri)


@router.post("/mfa/enable", response_model=MfaRecoveryCodes)
def mfa_enable(
    payload: MfaCode, request: Request, session: CurrentSession, settings: AppSettings, db: DbSession
) -> MfaRecoveryCodes:
    """Confirms set-up with a first code; returns the recovery codes (shown once) and completes sign-in."""
    from app.services.mfa import MfaService

    codes = MfaService(db, settings).confirm_enrolment(session, payload.code or "", client_ip(request))
    return MfaRecoveryCodes(recovery_codes=codes)


@router.post("/mfa/verify", status_code=status.HTTP_204_NO_CONTENT)
def mfa_verify(
    payload: MfaCode, request: Request, session: CurrentSession, settings: AppSettings, db: DbSession
) -> None:
    """Completes an admin sign-in with a code from the authenticator app, or a recovery code."""
    from app.services.mfa import MfaService

    MfaService(db, settings).verify(session, payload.code, payload.recovery_code, client_ip(request))

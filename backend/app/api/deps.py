"""FastAPI dependencies for authentication and authorization.

    current_user = Depends(get_current_user)            # any signed-in, active user
    admin        = Depends(require_roles(UserRole.ADMIN))  # role-gated

Every protected route goes through these; nothing trusts a role sent by the client.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import Forbidden, Unauthorized
from app.models.auth_session import AuthSession
from app.models.user import User, UserRole
from app.services.auth import AuthService

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]

# auto_error=False so a missing header produces our own 401 shape, not FastAPI's 403.
_bearer = HTTPBearer(auto_error=False)


def get_auth_service(db: DbSession, settings: AppSettings) -> AuthService:
    return AuthService(db, settings)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_current_session(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    auth: AuthServiceDep,
) -> AuthSession:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise Unauthorized()
    session = auth.authenticate(credentials.credentials)
    request.state.user_id = str(session.user_id)  # for logging / audit later
    request.state.user_role = session.user.role.value  # for security monitoring
    return session


CurrentSession = Annotated[AuthSession, Depends(get_current_session)]


#: The attribute that carries the request's session id on the user object (see `session_id_of`).
SESSION_ATTRIBUTE = "_assessx_session_id"


def get_signed_in_user(session: CurrentSession) -> User:
    """The signed-in user, even if an admin has not finished the second factor yet. Only for the few
    routes that complete sign-in (`/auth/me`, the MFA routes, sign-out)."""
    user = session.user
    # Lets services that only receive the user (e.g. AttemptService) know which sign-in made the
    # request — needed for "one exam, one sign-in at a time" (Phase 8A, AX-07).
    setattr(user, SESSION_ATTRIBUTE, session.id)
    return user


SignedInUser = Annotated[User, Depends(get_signed_in_user)]


def require_mfa(session: AuthSession, settings: Settings) -> None:
    """An admin who must use two-factor sign-in (always in production) has to have passed it in this
    session (Phase 8 final, CX-07)."""
    from app.services.mfa import MfaRequired

    user = session.user
    if (
        user.role is UserRole.ADMIN
        and (settings.mfa_required or user.mfa_enabled)
        and session.mfa_verified_at is None
    ):
        raise MfaRequired()


def get_current_user(session: CurrentSession, settings: AppSettings) -> User:
    user = get_signed_in_user(session)
    require_mfa(session, settings)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_verified_session(session: CurrentSession, settings: AppSettings) -> AuthSession:
    require_mfa(session, settings)
    return session


VerifiedSession = Annotated[AuthSession, Depends(get_verified_session)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Builds a dependency that admits only users whose role is in `roles`."""

    allowed = frozenset(roles)

    def _check(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise Forbidden()
        return user

    return _check


AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
CandidateUser = Annotated[User, Depends(require_roles(UserRole.CANDIDATE))]

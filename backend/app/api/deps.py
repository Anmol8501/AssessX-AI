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
    return session


CurrentSession = Annotated[AuthSession, Depends(get_current_session)]


def get_current_user(session: CurrentSession) -> User:
    return session.user


CurrentUser = Annotated[User, Depends(get_current_user)]


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

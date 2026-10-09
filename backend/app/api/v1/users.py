import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import AdminUser, DbSession
from app.api.paging import PageDep
from app.models.user import UserRole
from app.schemas.user import UserPublic
from app.services.users import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
def list_users(
    _: AdminUser,
    db: DbSession,
    page: PageDep,
    response: Response,
    role: Annotated[UserRole | None, Query()] = None,
) -> list[UserPublic]:
    """Admin-only, one page at a time."""
    return [
        UserPublic.model_validate(u)
        for u in page.finish(UserService(db).list(role=role, page=page), response)
    ]


@router.post("/{user_id}/mfa-reset", status_code=204)
def reset_admin_mfa(user_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    """Clears another administrator's second factor (lost device) and ends their sessions; they set it up
    again at their next sign-in. Audited and alerted. An admin cannot reset their own."""
    from app.core.config import get_settings
    from app.core.errors import Conflict, NotFound
    from app.services.mfa import MfaService

    if user_id == admin.id:
        raise Conflict("Ask another administrator to reset your two-factor sign-in.")
    target = UserService(db).repo.get(user_id)
    if target is None:
        raise NotFound("User not found.")
    MfaService(db, get_settings()).reset(target, admin)

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, DbSession
from app.models.user import UserRole
from app.schemas.user import UserPublic
from app.services.users import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
def list_users(
    _: AdminUser, db: DbSession, role: Annotated[UserRole | None, Query()] = None
) -> list[UserPublic]:
    """Admin-only. The first admin-protected resource; user management grows here in later phases."""
    return [UserPublic.model_validate(u) for u in UserService(db).list(role=role)]

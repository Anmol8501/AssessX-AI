import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.user import UserRole


class UserPublic(BaseModel):
    """What the client is allowed to know about a user. Never carries password material."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: UserRole
    is_active: bool
    roll_number: str | None = None
    username: str | None = None
    created_at: datetime

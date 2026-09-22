import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import Email
from app.schemas.user import UserPublic


class ChallengeResponse(BaseModel):
    challenge_id: uuid.UUID
    image_svg: str
    expires_at: datetime


class CandidateLoginRequest(BaseModel):
    """Candidates sign in with their university roll number, email, password and the security check."""

    roll_number: str = Field(min_length=1, max_length=50)
    email: Email
    password: str = Field(min_length=1, max_length=256)
    challenge_id: uuid.UUID
    challenge_answer: str = Field(min_length=1, max_length=16)
    remember_me: bool = False


class AdminLoginRequest(BaseModel):
    """Administrators sign in with username, email, password and the security check."""

    username: str = Field(min_length=1, max_length=50)
    email: Email
    password: str = Field(min_length=1, max_length=256)
    challenge_id: uuid.UUID
    challenge_answer: str = Field(min_length=1, max_length=16)
    remember_me: bool = False


class LoginResponse(BaseModel):
    token: str
    token_type: str = "bearer"  # noqa: S105 — a scheme name, not a secret
    expires_at: datetime
    user: UserPublic

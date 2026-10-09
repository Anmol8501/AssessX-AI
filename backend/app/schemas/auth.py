import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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


class ChangePasswordRequest(BaseModel):
    """The signed-in user's current password and the new one. Every other session of theirs ends."""

    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class RedeemResetRequest(BaseModel):
    """A one-time code from an administrator, and the new password. Every session of the account ends."""

    model_config = ConfigDict(extra="forbid")

    email: Email
    code: str = Field(min_length=6, max_length=40)
    new_password: str = Field(min_length=1, max_length=256)
    challenge_id: uuid.UUID
    challenge_answer: str = Field(min_length=1, max_length=16)


class ResetCodeIssued(BaseModel):
    """Shown to the administrator once, to hand to the candidate. Never stored or logged in clear."""

    code: str
    expires_at: datetime


class SessionsRevoked(BaseModel):
    sessions_ended: int


class LoginResponse(BaseModel):
    token: str
    token_type: str = "bearer"  # noqa: S105 — a scheme name, not a secret
    expires_at: datetime
    user: UserPublic
    #: Admin second factor (CX-07): "required" — verify a code next; "enroll" — set it up next; "none".
    mfa: Literal["none", "required", "enroll"] = "none"


class MfaStatus(BaseModel):
    required: bool
    enabled: bool
    verified: bool
    recovery_codes_left: int


class MfaEnrolment(BaseModel):
    """Shown once: the secret for the authenticator app (type it in, or open the otpauth link)."""

    secret: str
    otpauth_uri: str


class MfaCode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str | None = Field(default=None, max_length=12)
    recovery_code: str | None = Field(default=None, max_length=32)


class MfaRecoveryCodes(BaseModel):
    """Shown once, when two-factor sign-in is turned on. Each works one time."""

    recovery_codes: list[str]

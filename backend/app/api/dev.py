"""Development-only endpoints. Mounted by `create_app()` only when APP_ENV is not production.

They exist so automated end-to-end tests can drive real sign-in without weakening the
production API: nothing here bypasses authentication — it only issues a login challenge whose
answer is returned alongside it.
"""

import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import AppSettings, DbSession
from app.models.base import utcnow
from app.models.login_challenge import LoginChallenge
from app.repositories.login_challenges import LoginChallengeRepository
from app.services.challenges import ALPHABET, LENGTH, answer_hash, render_svg

router = APIRouter(prefix="/dev", tags=["dev"])


class SolvedChallenge(BaseModel):
    challenge_id: uuid.UUID
    image_svg: str
    expires_at: str
    answer: str


@router.post("/login-challenges", response_model=SolvedChallenge)
def create_solved_challenge(db: DbSession, settings: AppSettings) -> SolvedChallenge:
    """Issues a real, single-use challenge and reveals its answer (non-production only)."""
    answer = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
    challenge = LoginChallengeRepository(db).add(
        LoginChallenge(
            answer_hash=answer_hash(answer),
            expires_at=utcnow() + timedelta(seconds=settings.login_challenge_ttl_seconds),
        )
    )
    return SolvedChallenge(
        challenge_id=challenge.id,
        image_svg=render_svg(answer),
        expires_at=challenge.expires_at.isoformat(),
        answer=answer,
    )

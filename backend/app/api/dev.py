"""Development-only endpoints. Mounted by `create_app()` only when APP_ENV is not production.

They exist so automated end-to-end tests can drive real sign-in without weakening the
production API: nothing here bypasses authentication — it only issues a login challenge whose
answer is returned alongside it.

Phase 4B adds a read-only view of one attempt's proctoring events, for the end-to-end suite to
check what was recorded. It requires an administrator even here, and like everything in this
module it does not exist in production. It is not the admin monitoring view (Phase 4C).
"""

import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import AdminUser, AppSettings, DbSession
from app.core.errors import NotFound
from app.models.attempt import AssessmentAttempt
from app.models.base import utcnow
from app.models.login_challenge import LoginChallenge
from app.models.proctoring_event import ProctoringEvent
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


class RecordedEvent(BaseModel):
    event_type: str
    category: str
    source: str
    metadata: dict
    recorded_at: str


@router.get("/attempts/{attempt_id}/proctoring-events", response_model=list[RecordedEvent])
def proctoring_events(attempt_id: uuid.UUID, _: AdminUser, db: DbSession) -> list[RecordedEvent]:
    """An attempt's proctoring events, oldest first (non-production, administrators only)."""
    attempt = db.get(AssessmentAttempt, attempt_id)
    if attempt is None or attempt.proctoring_session is None:
        raise NotFound("No proctoring session for that attempt.")
    events = db.scalars(
        select(ProctoringEvent)
        .where(ProctoringEvent.session_id == attempt.proctoring_session.id)
        .order_by(ProctoringEvent.recorded_at)
    )
    return [
        RecordedEvent(
            event_type=e.event_type.value,
            category=e.category.value,
            source=e.source.value,
            metadata=e.details,
            recorded_at=e.recorded_at.isoformat(),
        )
        for e in events
    ]

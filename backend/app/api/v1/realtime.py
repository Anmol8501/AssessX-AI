"""WebRTC configuration for live monitoring video (see `app/services/ice.py`)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.api.deps import AppSettings, CurrentUser, DbSession, VerifiedSession
from app.realtime.security import issue_ticket
from app.services.ice import provider

router = APIRouter(prefix="/realtime", tags=["realtime"])


class IceServer(BaseModel):
    urls: list[str]
    username: str | None = None
    credential: str | None = None


class IceServersResponse(BaseModel):
    ice_servers: list[IceServer]
    #: Whether a TURN relay is included (video can then connect across restrictive networks).
    turn_enabled: bool


def _may_relay(db, user) -> bool:  # noqa: ANN001
    from sqlalchemy import exists, select

    from app.models.attempt import AssessmentAttempt, AttemptStatus
    from app.models.interview_call import CallStatus, InterviewCall
    from app.models.proctoring import ProctoringSession, ProctoringSessionStatus
    from app.models.user import UserRole

    if user.role is UserRole.ADMIN:
        return True
    proctored = select(
        exists().where(
            AssessmentAttempt.candidate_id == user.id,
            AssessmentAttempt.status == AttemptStatus.IN_PROGRESS,
            ProctoringSession.attempt_id == AssessmentAttempt.id,
            ProctoringSession.status == ProctoringSessionStatus.ACTIVE,
        )
    )
    in_call = select(
        exists().where(InterviewCall.candidate_id == user.id, InterviewCall.status == CallStatus.OPEN)
    )
    return bool(db.scalar(proctored)) or bool(db.scalar(in_call))


class TicketRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    purpose: Literal["monitoring", "proctoring", "call"]


class TicketResponse(BaseModel):
    ticket: str
    expires_in: int


@router.post("/ws-ticket", response_model=TicketResponse)
def websocket_ticket(payload: TicketRequest, session: VerifiedSession) -> TicketResponse:
    """A short-lived, single-use ticket for opening one WebSocket of this session, so the session token
    itself never appears in a WebSocket URL. The socket still checks the role, the attempt or call, and
    keeps checking the session while open."""
    ticket, ttl = issue_ticket(session.id, payload.purpose)
    return TicketResponse(ticket=ticket, expires_in=ttl)


@router.get("/ice-servers", response_model=IceServersResponse, response_model_exclude_none=True)
def ice_servers(user: CurrentUser, settings: AppSettings, db: DbSession) -> IceServersResponse:
    """ICE servers for a signed-in user. STUN for everyone; the short-lived TURN relay credentials only
    for administrators and for a candidate who is in a proctored exam or a live interview call right now
    (Phase 8A, AX-13) — a relay is not handed to anyone merely for having an account."""
    servers, turn = provider.ice_servers(settings)
    if turn and not _may_relay(db, user):
        servers = [s for s in servers if not any(str(u).startswith(("turn:", "turns:")) for u in s["urls"])]
        turn = False
    return IceServersResponse(ice_servers=[IceServer(**s) for s in servers], turn_enabled=turn)

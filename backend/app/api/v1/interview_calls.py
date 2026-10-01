"""Phase 7D — live video interview calls (REST). Media never touches these routes or the server.

Administrators (`AdminUser`) open, read, annotate and end calls; a call is reached only through its
interview. Candidates (`CandidateUser`) read and join only calls of their own assignments — another
candidate's call is 404. The live part (signaling and chat) is the WebSocket in `ws_calls.py`.
"""

import uuid

from fastapi import APIRouter, BackgroundTasks, Response, status

from app.api.deps import AdminUser, CandidateUser, DbSession
from app.realtime.calls import call_hub
from app.schemas.interview_call import AdminCallOut, CallSummary, CandidateCallOut, NoteCreate
from app.services.interview.calls import CallService

admin_router = APIRouter(prefix="/interviews", tags=["interview calls"])
candidate_router = APIRouter(prefix="/candidates/me", tags=["interview calls"])


def _admin_view(service: CallService, interview_id: uuid.UUID, call_id: uuid.UUID) -> AdminCallOut:
    call = service.for_admin(interview_id, call_id)
    return AdminCallOut.build(call, service.messages(call), service.notes(call))


@admin_router.post("/{interview_id}/assignments/{candidate_id}/call", response_model=AdminCallOut)
def open_call(
    interview_id: uuid.UUID, candidate_id: uuid.UUID, admin: AdminUser, db: DbSession, response: Response
) -> AdminCallOut:
    """Open a live call with an assigned candidate (201), or return the call already open (200)."""
    service = CallService(db)
    call, created = service.open(interview_id, candidate_id, admin)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return AdminCallOut.build(call, service.messages(call), service.notes(call))


@admin_router.get("/{interview_id}/calls", response_model=list[CallSummary])
def list_calls(
    interview_id: uuid.UUID, _: AdminUser, db: DbSession, candidate_id: uuid.UUID | None = None
) -> list[CallSummary]:
    return [CallSummary.of(c) for c in CallService(db).history(interview_id, candidate_id)]


@admin_router.get("/{interview_id}/calls/{call_id}", response_model=AdminCallOut)
def get_call(interview_id: uuid.UUID, call_id: uuid.UUID, _: AdminUser, db: DbSession) -> AdminCallOut:
    return _admin_view(CallService(db), interview_id, call_id)


@admin_router.post("/{interview_id}/calls/{call_id}/end", response_model=AdminCallOut)
def end_call(
    interview_id: uuid.UUID, call_id: uuid.UUID, admin: AdminUser, db: DbSession, background: BackgroundTasks
) -> AdminCallOut:
    """End the call (idempotent). Both sides are told and disconnected — after the end is committed."""
    service = CallService(db)
    service.end(interview_id, call_id, admin)
    background.add_task(call_hub.end_threadsafe, call_id)
    return _admin_view(service, interview_id, call_id)


@admin_router.post("/{interview_id}/calls/{call_id}/notes", response_model=AdminCallOut, status_code=201)
def add_call_note(
    interview_id: uuid.UUID, call_id: uuid.UUID, payload: NoteCreate, admin: AdminUser, db: DbSession
) -> AdminCallOut:
    """A private, immutable interviewer note (administrators only; never shown to the candidate)."""
    service = CallService(db)
    service.add_note(interview_id, call_id, admin, payload.body)
    return _admin_view(service, interview_id, call_id)


@candidate_router.get("/interview-calls/{call_id}", response_model=CandidateCallOut)
def candidate_call(call_id: uuid.UUID, user: CandidateUser, db: DbSession) -> CandidateCallOut:
    service = CallService(db)
    call = service.for_candidate(call_id, user)
    return CandidateCallOut.build(call, service.messages(call))


@candidate_router.post("/interview-calls/{call_id}/join", response_model=CandidateCallOut)
def join_call(call_id: uuid.UUID, user: CandidateUser, db: DbSession) -> CandidateCallOut:
    """Record that the candidate joined (409 `call_ended` once it has ended)."""
    service = CallService(db)
    call = service.join(call_id, user)
    return CandidateCallOut.build(call, service.messages(call))

"""The candidate's proctoring session endpoints (Phase 4A).

Candidate-only, and scoped to the signed-in user by `CandidateUser`: the attempt in the URL is
looked up *as that candidate's*, so another candidate's attempt or session is simply not found.
No route accepts a candidate id, a status or a timestamp.

Phase 4B adds the event report: the app's observations of the exam environment. Events can be
added, never read back, changed or deleted by a candidate.

There is deliberately no route that ends a session. A session ends when its attempt ends —
submission or the deadline — and letting the client end it early would let a candidate carry on
answering unproctored.
"""

import uuid

from fastapi import APIRouter, Response, status

from app.api.deps import CandidateUser, DbSession
from app.models.proctoring_event import ProctoringEvent
from app.schemas.proctoring import DeviceReport, ProctoringEventIn, ProctoringEventOut, ProctoringSessionOut
from app.services.attempts import AttemptService
from app.services.proctoring import ProctoringService

router = APIRouter(prefix="/candidates/me", tags=["proctoring"])


def _event(event: ProctoringEvent) -> ProctoringEventOut:
    return ProctoringEventOut(
        id=event.id,
        event_type=event.event_type,
        category=event.category,
        source=event.source,
        metadata=event.details,
        recorded_at=event.recorded_at,
        client_reported_at=event.client_reported_at,
    )


@router.get("/attempts/{attempt_id}/proctoring", response_model=ProctoringSessionOut)
def proctoring_session(attempt_id: uuid.UUID, user: CandidateUser, db: DbSession) -> ProctoringSessionOut:
    """The attempt's proctoring session. 404 when the attempt is not proctored.

    Reading it settles the attempt's clock first, so a session whose exam ran out reads `ENDED`.
    """
    attempt = AttemptService(db).get_attempt(user, attempt_id)
    return ProctoringSessionOut.model_validate(ProctoringService(db).session_of(attempt))


@router.post("/attempts/{attempt_id}/proctoring/activate", response_model=ProctoringSessionOut)
def activate_proctoring(
    attempt_id: uuid.UUID, payload: DeviceReport, user: CandidateUser, db: DbSession
) -> ProctoringSessionOut:
    """Confirms the camera and microphone and starts proctoring (`NOT_STARTED → ACTIVE`).

    Both devices must be reported `READY`, or the request is refused with the ones that are not.
    Calling it again on an active session — after the app was reopened mid-exam — refreshes the
    device state and keeps the original start time.
    """
    attempt = AttemptService(db).get_attempt_for_update(user, attempt_id)
    return ProctoringSessionOut.model_validate(ProctoringService(db).activate(attempt, payload))


@router.put("/attempts/{attempt_id}/proctoring/devices", response_model=ProctoringSessionOut)
def report_devices(
    attempt_id: uuid.UUID, payload: DeviceReport, user: CandidateUser, db: DbSession
) -> ProctoringSessionOut:
    """Records a change in camera/microphone availability during an active session."""
    attempt = AttemptService(db).get_attempt_for_update(user, attempt_id)
    return ProctoringSessionOut.model_validate(ProctoringService(db).report_devices(attempt, payload))


@router.post(
    "/attempts/{attempt_id}/proctoring/events",
    response_model=ProctoringEventOut,
    status_code=status.HTTP_201_CREATED,
)
def report_event(
    attempt_id: uuid.UUID,
    payload: ProctoringEventIn,
    user: CandidateUser,
    db: DbSession,
    response: Response,
) -> ProctoringEventOut:
    """Records one environment event observed by the candidate's app (Phase 4B).

    201 when recorded; 200 with the original event when this is a retry (same `client_event_id`)
    or a repeat folded into the previous identical event. Refused before the session is active
    (`proctoring_not_active`) and after the attempt ends (`attempt_locked`). There is no route to
    read, change or delete events as a candidate.
    """
    attempt = AttemptService(db).get_attempt_for_update(user, attempt_id)
    event, created = ProctoringService(db).record_event(attempt, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return _event(event)

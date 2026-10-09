"""Phase 7A — the candidate's interviews and interview session.

`CandidateUser` on every route (an administrator gets 403, an anonymous request 401), and every lookup
is scoped by the authenticated candidate: another candidate's interview or session is 404. The server
decides everything — the current question, the next one, the time left and when the interview ends.
The client sends only an answer to the question it was shown. Nothing here evaluates the answer.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy import select

from app.api.deps import AppSettings, CandidateUser, DbSession
from app.api.paging import PageDep
from app.models.interview import Interview, InterviewSession
from app.models.interview_call import CallStatus, InterviewCall
from app.schemas.interview import (
    AnswerSubmit,
    CandidateInterviewDetail,
    CandidateQuestion,
    InterviewProgress,
    MyInterview,
    SessionState,
)
from app.services.interview.runner import EvaluationRunner, runner_from_settings
from app.services.interview.sessions import NOT_CONFIGURED, InterviewSessionService, SessionView

router = APIRouter(prefix="/candidates/me", tags=["candidate interviews"])


def get_evaluation_runner(settings: AppSettings) -> EvaluationRunner | None:
    """The configured answer evaluator (Phase 7B), or None. Overridable, so tests use a fake provider."""
    return runner_from_settings(settings)


EvaluationRunnerDep = Annotated[EvaluationRunner | None, Depends(get_evaluation_runner)]


def _service(db, runner: EvaluationRunner | None) -> InterviewSessionService:
    return InterviewSessionService(db, runner.info if runner else NOT_CONFIGURED)


def _schedule(
    background: BackgroundTasks, runner: EvaluationRunner | None, evaluation_ids: list[uuid.UUID]
) -> None:
    """Evaluations run after the response is sent — never inside the request's lock or transaction."""
    if runner is None:
        return
    for evaluation_id in evaluation_ids:
        background.add_task(runner.run, evaluation_id)


def _summary(interview: Interview, session: InterviewSession | None, open_call_id=None) -> dict:  # noqa: ANN001
    return {
        "interview_id": interview.id,
        "title": interview.title,
        "description": interview.description,
        "interview_type": interview.interview_type,
        "format": interview.format,
        "open_call_id": open_call_id,
        "difficulty": interview.difficulty,
        "duration_minutes": interview.duration_minutes,
        "question_count": interview.question_count,
        "session_id": session.id if session else None,
        "session_status": session.status.value if session else "NOT_STARTED",
        "completion_reason": session.completion_reason if session else None,
    }


def _state(view: SessionView) -> SessionState:
    session, current = view.session, view.current
    question = current.question if current else None
    return SessionState(
        session_id=session.id,
        interview_id=session.interview_id,
        interview_title=session.interview.title,
        status=session.status.value,
        completion_reason=session.completion_reason,
        server_time=view.now,
        started_at=session.started_at,
        expires_at=session.expires_at,
        completed_at=session.completed_at,
        remaining_seconds=session.remaining_seconds(view.now),
        progress=InterviewProgress(
            primary_total=len(session.question_plan),
            primary_answered=view.primary_answered,
            follow_ups_answered=view.follow_ups_answered,
        ),
        current=(
            CandidateQuestion(
                item_id=current.id,
                kind=current.kind,
                number=view.number_of(current),
                text=question.text,
                context=question.context,
                topic=question.topic,
                difficulty=question.difficulty,
                question_type=question.question_type,
                time_limit_seconds=question.time_limit_seconds,
                presented_at=current.presented_at,
            )
            if current and question
            else None
        ),
        processing=view.processing,
    )


def _open_calls(db, user, interview_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:  # noqa: ANN001
    """`{interview: the candidate's OPEN live call}` in one query (Phase 7D) — only their own calls."""
    if not interview_ids:
        return {}
    rows = db.execute(
        select(InterviewCall.interview_id, InterviewCall.id).where(
            InterviewCall.candidate_id == user.id,
            InterviewCall.interview_id.in_(interview_ids),
            InterviewCall.status == CallStatus.OPEN,
        )
    )
    return {i: c for i, c in rows.all()}


@router.get("/interviews", response_model=list[MyInterview])
def my_interviews(user: CandidateUser, db: DbSession, page: PageDep, response: Response) -> list[MyInterview]:
    """The candidate's assigned, published interviews."""
    rows = page.finish(InterviewSessionService(db).my_interviews(user, page), response)
    calls = _open_calls(db, user, [i.id for i, _ in rows])
    return [MyInterview(**_summary(i, s, calls.get(i.id))) for i, s in rows]


@router.get("/interviews/{interview_id}", response_model=CandidateInterviewDetail)
def interview_detail(interview_id: uuid.UUID, user: CandidateUser, db: DbSession) -> CandidateInterviewDetail:
    interview, session = InterviewSessionService(db).detail(interview_id, user)
    return CandidateInterviewDetail(
        **_summary(interview, session, _open_calls(db, user, [interview.id]).get(interview.id)),
        instructions=interview.instructions,
        topics=interview.topics,
        follow_ups_enabled=interview.follow_ups_enabled,
    )


@router.post("/interviews/{interview_id}/session", response_model=SessionState)
def start_session(
    interview_id: uuid.UUID, user: CandidateUser, db: DbSession, response: Response
) -> SessionState:
    """Start the interview (201), or resume the session already started (200). No restart."""
    view, created = InterviewSessionService(db).start(interview_id, user)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _state(view)


@router.get("/interview-sessions/{session_id}", response_model=SessionState)
def session_state(
    session_id: uuid.UUID,
    user: CandidateUser,
    db: DbSession,
    background: BackgroundTasks,
    runner: EvaluationRunnerDep,
) -> SessionState:
    """The authoritative state — what a refresh, a reconnect or the "processing" poll reads. It moves on
    only when the last answer's evaluation has resolved (or the wait ran out) — never skipping ahead."""
    view, rerun = _service(db, runner).state(session_id, user)
    _schedule(background, runner, rerun)
    return _state(view)


@router.post("/interview-sessions/{session_id}/answers", response_model=SessionState)
def submit_answer(
    session_id: uuid.UUID,
    payload: AnswerSubmit,
    user: CandidateUser,
    db: DbSession,
    background: BackgroundTasks,
    runner: EvaluationRunnerDep,
) -> SessionState:
    """Answer the current question. The response is the new state: the next question, completed, or
    `processing` while the answer is evaluated (poll the state). Only the answer and the item it answers
    are accepted; scores, versions and statuses are the server's.

    409 `stale_question` if `item_id` is not the current question (a retry or a replay) — nothing is
    saved. 409 `interview_completed` once the interview has ended, including by its deadline.
    """
    view, to_run = _service(db, runner).answer(session_id, user, payload.item_id, payload.answer_text)
    _schedule(background, runner, to_run)
    return _state(view)


@router.post("/interview-sessions/{session_id}/complete", response_model=SessionState)
def complete_session(session_id: uuid.UUID, user: CandidateUser, db: DbSession) -> SessionState:
    """End the interview early. Idempotent."""
    return _state(InterviewSessionService(db).complete(session_id, user))

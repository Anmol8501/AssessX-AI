"""The candidate's exam-taking endpoints (Phase 3A and 3B).

Everything here is candidate-only and scoped to the signed-in user by `CandidateUser`. No route
accepts a candidate id: the session is the identity, so there is nothing for a client to tamper
with. Sibling routes under `/candidates/me` live in `candidates.py`.

No route accepts timing either. A deadline is reported, never received: there is no field on any
request body for `expires_at`, `started_at` or a remaining time, so the only clock in play is the
server's own.

Phase 3B ends at a finished attempt. There is still no score, percentage, pass/fail or result —
those are Phase 3C (`docs/PHASE-3-PLAN.md`).
"""

import uuid

from fastapi import APIRouter, status

from app.api.deps import CandidateUser, DbSession
from app.models.attempt import AssessmentAttempt, AttemptAnswer
from app.models.base import utcnow
from app.schemas.assignment import MyAssessment
from app.schemas.attempt import (
    AttemptAnswerOut,
    AttemptDetail,
    AttemptSession,
    CandidateQuestion,
    ExamDetail,
    SaveAnswer,
)
from app.schemas.proctoring import ProctoringSessionOut
from app.schemas.result import CandidateResult, QuestionResult, ResultSummary
from app.services.attempts import AttemptService
from app.services.results import ResultService

router = APIRouter(prefix="/candidates/me", tags=["exam attempt"])


def _answer(answer: AttemptAnswer) -> AttemptAnswerOut:
    return AttemptAnswerOut(
        question_id=answer.question_id,
        selected_option_ids=answer.selected_option_ids,
        updated_at=answer.updated_at,
    )


def _session(attempt: AssessmentAttempt) -> AttemptSession:
    now = utcnow()
    return AttemptSession(
        attempt_id=attempt.id,
        status=attempt.status,
        started_at=attempt.started_at,
        expires_at=attempt.expires_at,
        submitted_at=attempt.submitted_at,
        finalized_at=attempt.finalized_at,
        server_time=now,
        remaining_seconds=attempt.remaining_seconds(now),
    )


def _attempt_detail(attempt: AssessmentAttempt, service: AttemptService) -> AttemptDetail:
    assessment = attempt.assessment
    now = utcnow()
    return AttemptDetail(
        id=attempt.id,
        assessment_id=attempt.assessment_id,
        assignment_id=attempt.assignment_id,
        attempt_number=attempt.attempt_number,
        max_attempts=assessment.max_attempts,
        status=attempt.status,
        started_at=attempt.started_at,
        expires_at=attempt.expires_at,
        submitted_at=attempt.submitted_at,
        finalized_at=attempt.finalized_at,
        server_time=now,
        remaining_seconds=attempt.remaining_seconds(now),
        title=assessment.title,
        instructions=assessment.instructions,
        duration_minutes=assessment.duration_minutes,
        total_marks=assessment.total_marks,
        question_navigation=assessment.question_navigation,
        # `CandidateQuestion` has no `is_correct` and no `explanation`; validating the ORM object
        # against it is what drops them, so the answer key cannot reach the client by accident.
        questions=[CandidateQuestion.model_validate(q) for q in service.questions_for(attempt)],
        answers=[_answer(a) for a in service.answers_for(attempt)],
        proctoring=(
            ProctoringSessionOut.model_validate(attempt.proctoring_session)
            if attempt.proctoring_session is not None
            else None
        ),
    )


@router.get("/assessments/{assessment_id}", response_model=ExamDetail)
def exam_detail(assessment_id: uuid.UUID, user: CandidateUser, db: DbSession) -> ExamDetail:
    """The exam details screen, including whether it can be started and why not.

    An assessment the candidate was not assigned returns 404 rather than 403, so this cannot be
    used to discover which exams exist.
    """
    service = AttemptService(db)
    assignment = service.assignment_or_404(user, assessment_id)
    assessment = assignment.assessment

    # `latest_attempts` settles the clock, so an exam whose time ran out while the app was shut
    # is already finished by the time this screen renders it.
    latest = service.latest_attempts(user).get(assessment_id)
    active = latest.id if latest is not None and latest.is_active else None
    used = service.attempts_used(user, assessment_id)
    blocker = service.start_blocker(assessment, attempts_used=used)

    card = MyAssessment.of(
        assignment,
        len(assessment.questions),
        active,
        latest.status if latest is not None else None,
    )
    return ExamDetail(
        **card.model_dump(),
        attempts_used=used,
        # A resumable attempt is offered through `active_attempt_id`, so "can start" means
        # "can start a new one".
        can_start=active is None and blocker is None,
        start_blocked_reason=None if active is not None else blocker,
        # `latest_attempt_status` arrives with the card above.
        latest_attempt_id=latest.id if latest is not None else None,
    )


@router.post(
    "/assessments/{assessment_id}/attempts",
    response_model=AttemptDetail,
    status_code=status.HTTP_200_OK,
)
def start_or_resume_attempt(assessment_id: uuid.UUID, user: CandidateUser, db: DbSession) -> AttemptDetail:
    """Starts the exam, or returns the attempt already under way.

    Idempotent on purpose: a refresh, a double-click or a retried request resumes rather than
    creating a second attempt, so 200 is returned in both cases rather than 201 for one of them.
    """
    service = AttemptService(db)
    attempt, _created = service.start_or_resume(user, assessment_id)
    return _attempt_detail(attempt, service)


@router.get("/attempts/{attempt_id}", response_model=AttemptDetail)
def get_attempt(attempt_id: uuid.UUID, user: CandidateUser, db: DbSession) -> AttemptDetail:
    """The attempt, its questions and every answer saved so far — what a reload restores from."""
    service = AttemptService(db)
    return _attempt_detail(service.get_attempt(user, attempt_id), service)


@router.get("/attempts/{attempt_id}/session", response_model=AttemptSession)
def attempt_session(attempt_id: uuid.UUID, user: CandidateUser, db: DbSession) -> AttemptSession:
    """The attempt's authoritative clock, without the paper.

    The countdown resynchronises against this, so it stays small enough to poll: re-sending every
    question and answer just to learn the time would be wasteful. Reading it also settles the
    attempt, which is what turns a candidate sitting on an open window into a `TIME_EXPIRED` row.
    """
    return _session(AttemptService(db).get_attempt(user, attempt_id))


@router.post("/attempts/{attempt_id}/submit", response_model=AttemptDetail)
def submit_attempt(attempt_id: uuid.UUID, user: CandidateUser, db: DbSession) -> AttemptDetail:
    """Finalizes the attempt. The candidate's answers stop being editable from here.

    Submitting an already-submitted attempt returns it unchanged rather than failing, so a retried
    request is harmless. Submitting one whose time has run out is refused with `attempt_locked`,
    and the attempt is left `TIME_EXPIRED` — the server's clock decides, not the client's.

    Returns the finalized attempt. No score: evaluation is Phase 3C.
    """
    service = AttemptService(db)
    return _attempt_detail(service.submit(user, attempt_id), service)


@router.get("/attempts/{attempt_id}/result", response_model=CandidateResult)
def attempt_result(attempt_id: uuid.UUID, user: CandidateUser, db: DbSession) -> CandidateResult:
    """The candidate's own result for one finished attempt.

    Refused with 409 while the attempt is still running — there is nothing to report until the
    answers stop changing. The score is included only when the assessment is configured to show
    results; the breakdown never names a correct option.
    """
    service = AttemptService(db)
    attempt = service.get_attempt(user, attempt_id)  # settles the clock, and is scoped to the user
    results = ResultService(db)
    result = results.for_attempt(attempt)

    assessment = attempt.assessment
    released = assessment.show_results
    return CandidateResult(
        attempt_id=attempt.id,
        assessment_id=assessment.id,
        assessment_title=assessment.title,
        attempt_number=attempt.attempt_number,
        attempt_status=attempt.status,
        submitted_at=attempt.submitted_at,
        finalized_at=attempt.finalized_at,
        released=released,
        score=result.score if released else None,
        maximum_score=result.maximum_score if released else None,
        percentage=result.percentage if released else None,
        passed=result.passed if released else None,
        correct_count=result.correct_count if released else None,
        incorrect_count=result.incorrect_count if released else None,
        unanswered_count=result.unanswered_count if released else None,
        evaluated_at=result.evaluated_at if released else None,
        questions=[
            QuestionResult(
                position=outcome.position,
                marks=outcome.marks,
                marks_awarded=outcome.marks_awarded,
                outcome=outcome.outcome,
            )
            for outcome in (results.outcomes(attempt) if released else [])
        ],
    )


@router.get("/results", response_model=list[ResultSummary])
def my_results(user: CandidateUser, db: DbSession) -> list[ResultSummary]:
    """The signed-in candidate's results, newest first.

    Only assessments configured to show results appear here; the rest are evaluated and stored,
    but are not the candidate's to see yet.
    """
    return [
        ResultSummary(
            attempt_id=result.attempt_id,
            assessment_id=result.assessment_id,
            assessment_title=result.assessment.title,
            attempt_number=result.attempt.attempt_number,
            attempt_status=result.attempt.status,
            score=result.score,
            maximum_score=result.maximum_score,
            percentage=result.percentage,
            passed=result.passed,
            correct_count=result.correct_count,
            incorrect_count=result.incorrect_count,
            unanswered_count=result.unanswered_count,
            evaluated_at=result.evaluated_at,
            submitted_at=result.attempt.submitted_at,
        )
        for result in ResultService(db).list_for_candidate(user)
        if result.assessment.show_results
    ]


@router.put("/attempts/{attempt_id}/answers/{question_id}", response_model=AttemptAnswerOut)
def save_answer(
    attempt_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: SaveAnswer,
    user: CandidateUser,
    db: DbSession,
) -> AttemptAnswerOut:
    """Stores the candidate's selection for one question. An empty list clears it.

    The selection is checked against that question's own options; nothing is evaluated.
    """
    answer = AttemptService(db).save_answer(user, attempt_id, question_id, payload.selected_option_ids)
    return _answer(answer)

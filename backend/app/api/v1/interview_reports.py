"""Phase 7C — interview reports and their human review (administrators only).

`AdminUser` on every route: candidates get 403, anonymous requests 401. A session is addressed through its
interview, and an answer through its session, so an id from elsewhere is 404 (no IDOR). Any administrator
may review any interview — the single-tenant scope of every admin route. Writes return the full report.

Nothing here evaluates, re-evaluates or decides: the report reads the stored evaluations, and the review
outcome is whatever the human reviewer chose.
"""

import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response, status

from app.api.deps import AdminUser, DbSession
from app.schemas.interview_report import (
    AnswerMarkSet,
    InterviewReportOut,
    ReportQueueOut,
    ReportQueueRow,
    ReviewDecisionCreate,
    ReviewNoteCreate,
)
from app.services.interview.report import InterviewReportService, QueueFilter
from app.services.interview.review import InterviewReviewService

router = APIRouter(prefix="/interviews", tags=["interview reports"])
#: Who read which interview report (ids only) — like evidence reads; review actions go to `audit_logs`.
access = logging.getLogger("assessx.interviews.report")

BASE = "/{interview_id}/sessions/{session_id}"


def _report(db, interview_id: uuid.UUID, session_id: uuid.UUID) -> InterviewReportOut:  # noqa: ANN001
    return InterviewReportOut.of(InterviewReportService(db).build(interview_id, session_id))


@router.get("/reports", response_model=ReportQueueOut)
def report_queue(
    _: AdminUser,
    db: DbSession,
    interview_id: uuid.UUID | None = None,
    session_status: Literal["ACTIVE", "COMPLETED"] | None = None,
    review_status: Literal["UNREVIEWED", "IN_REVIEW", "REVIEWED"] | None = None,
    evaluation_state: Literal["NONE", "PENDING", "PARTIAL", "COMPLETE"] | None = None,
    finished_from: datetime | None = None,
    finished_to: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
) -> ReportQueueOut:
    """Interview sessions, newest first, with interview, evaluation and review status — never ranked."""
    rows, counts, next_cursor = InterviewReportService(db).queue(
        QueueFilter(
            interview_id, session_status, review_status, evaluation_state, finished_from, finished_to
        ),
        limit=limit,
        cursor=cursor,
    )
    return ReportQueueOut(counts=counts, items=[ReportQueueRow.of(r) for r in rows], next_cursor=next_cursor)


@router.get(BASE + "/report", response_model=InterviewReportOut)
def interview_report(
    interview_id: uuid.UUID, session_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> InterviewReportOut:
    """The full report: completion, the AI-generated summary and topic analysis, every question with its
    answer and AI evaluation, the adaptive timeline, and the human review with its history.
    Bounded per administrator per hour (CX-12)."""
    from app.core.config import get_settings
    from app.services.rate_limit import enforce_hourly

    settings = get_settings()
    enforce_hourly(
        db, settings, "report_view", admin.id, settings.report_downloads_per_hour, "download_rate_limited"
    )
    report = _report(db, interview_id, session_id)
    access.info(
        "Interview report read",
        extra={"admin_id": str(admin.id), "interview_id": str(interview_id), "session_id": str(session_id)},
    )
    return report


@router.post(BASE + "/review", response_model=InterviewReportOut)
def start_review(
    interview_id: uuid.UUID, session_id: uuid.UUID, admin: AdminUser, db: DbSession, response: Response
) -> InterviewReportOut:
    """Start the human review (201), or return it as it is if already started (200)."""
    created = InterviewReviewService(db).start(interview_id, session_id, admin)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _report(db, interview_id, session_id)


@router.post(BASE + "/review/notes", response_model=InterviewReportOut, status_code=status.HTTP_201_CREATED)
def add_review_note(
    interview_id: uuid.UUID, session_id: uuid.UUID, payload: ReviewNoteCreate, admin: AdminUser, db: DbSession
) -> InterviewReportOut:
    """A human-authored note. Immutable; a correction is a new note."""
    InterviewReviewService(db).add_note(interview_id, session_id, admin, payload.body)
    return _report(db, interview_id, session_id)


@router.put(BASE + "/review/marks/{item_id}", response_model=InterviewReportOut)
def mark_answer(
    interview_id: uuid.UUID,
    session_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: AnswerMarkSet,
    admin: AdminUser,
    db: DbSession,
) -> InterviewReportOut:
    """Agree or disagree with one answer's AI evaluation. The evaluation itself never changes."""
    InterviewReviewService(db).mark(interview_id, session_id, item_id, admin, payload.mark)
    return _report(db, interview_id, session_id)


@router.post(BASE + "/review/complete", response_model=InterviewReportOut)
def complete_review(
    interview_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: ReviewDecisionCreate,
    admin: AdminUser,
    db: DbSession,
) -> InterviewReportOut:
    """Record the human outcome. 409 if the review changed since `expected_version`, the interview is
    still running, or answers are still being evaluated."""
    InterviewReviewService(db).complete(
        interview_id,
        session_id,
        admin,
        outcome=payload.outcome,
        rationale=payload.rationale,
        expected_version=payload.expected_version,
    )
    return _report(db, interview_id, session_id)


@router.post(BASE + "/review/revise", response_model=InterviewReportOut)
def revise_review(
    interview_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: ReviewDecisionCreate,
    admin: AdminUser,
    db: DbSession,
) -> InterviewReportOut:
    """A new revision of the completed review, with a reason. Earlier decisions stay in the record."""
    InterviewReviewService(db).revise(
        interview_id,
        session_id,
        admin,
        outcome=payload.outcome,
        rationale=payload.rationale,
        expected_version=payload.expected_version,
    )
    return _report(db, interview_id, session_id)

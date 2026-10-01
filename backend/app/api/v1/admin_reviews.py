"""Phase 6C — the human review of a proctored attempt, and the review queue.

Admin-only (`AdminUser`): a candidate gets 403, an anonymous request 401. A review is addressed by
its **attempt** — no route takes a review id — so one attempt's URL cannot reach another's review.
The reviewer is the authenticated administrator; every timestamp is the server's. Any administrator
may review any attempt, the same single-tenant scope as results, monitoring, risk and evidence.

Nothing here computes an outcome. Risk (6A) and evidence (6B) are read, never changed.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response, status

from app.api.deps import AdminUser, DbSession
from app.models.base import utcnow
from app.repositories.reviews import QueueFilter
from app.schemas.review import AttemptReviewOut, DecisionCreate, MarkSet, NoteCreate, ReviewQueueOut
from app.services.review.service import QUEUE_DEFAULT_LIMIT, QUEUE_MAX_LIMIT, ReviewService

router = APIRouter(prefix="/admin/attempts", tags=["admin reviews"])


@router.get("", response_model=ReviewQueueOut)
def review_queue(
    _: AdminUser,
    db: DbSession,
    review_status: Literal["UNREVIEWED", "IN_REVIEW", "REVIEWED"] | None = None,
    assessment_id: uuid.UUID | None = None,
    finished_from: datetime | None = None,
    finished_to: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=QUEUE_MAX_LIMIT)] = QUEUE_DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
) -> ReviewQueueOut:
    """Proctored attempts, newest first, with their review status and current risk signal.

    `counts` are per review status under the same filters. The risk shown prioritises review; it is
    not an outcome.
    """
    now = utcnow()
    result = ReviewService(db).queue(
        QueueFilter(review_status, assessment_id, finished_from, finished_to),
        limit=limit,
        cursor=cursor,
        now=now,
    )
    return ReviewQueueOut.of(result, now)


@router.get("/{attempt_id}/review", response_model=AttemptReviewOut)
def get_review(attempt_id: uuid.UUID, _: AdminUser, db: DbSession) -> AttemptReviewOut:
    """The attempt's review — `UNREVIEWED` when none has been started. 404 if not proctored."""
    return AttemptReviewOut.of(ReviewService(db).view(attempt_id))


@router.post("/{attempt_id}/review", response_model=AttemptReviewOut)
def start_review(
    attempt_id: uuid.UUID, admin: AdminUser, db: DbSession, response: Response
) -> AttemptReviewOut:
    """Start reviewing (UNREVIEWED → IN_REVIEW): 201. Already started: 200 with the review as it is."""
    view, created = ReviewService(db).start(attempt_id, admin)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return AttemptReviewOut.of(view)


@router.post(
    "/{attempt_id}/review/notes", response_model=AttemptReviewOut, status_code=status.HTTP_201_CREATED
)
def add_note(attempt_id: uuid.UUID, payload: NoteCreate, admin: AdminUser, db: DbSession) -> AttemptReviewOut:
    """Add a human-authored note. Notes are immutable; a correction is a new note."""
    return AttemptReviewOut.of(ReviewService(db).add_note(attempt_id, admin, payload.body))


@router.put("/{attempt_id}/review/marks/{evidence_id}", response_model=AttemptReviewOut)
def mark_evidence(
    attempt_id: uuid.UUID, evidence_id: uuid.UUID, payload: MarkSet, admin: AdminUser, db: DbSession
) -> AttemptReviewOut:
    """Confirm or dismiss one evidence item of this attempt while the review is open."""
    return AttemptReviewOut.of(ReviewService(db).mark(attempt_id, evidence_id, admin, payload.mark))


@router.post("/{attempt_id}/review/complete", response_model=AttemptReviewOut)
def complete_review(
    attempt_id: uuid.UUID, payload: DecisionCreate, admin: AdminUser, db: DbSession
) -> AttemptReviewOut:
    """Record the administrative outcome (IN_REVIEW → REVIEWED). 409 if the review changed since
    `expected_version`, or the attempt is still in progress."""
    return AttemptReviewOut.of(
        ReviewService(db).complete(
            attempt_id,
            admin,
            outcome=payload.outcome,
            rationale=payload.rationale,
            expected_version=payload.expected_version,
        )
    )


@router.post("/{attempt_id}/review/revise", response_model=AttemptReviewOut)
def revise_review(
    attempt_id: uuid.UUID, payload: DecisionCreate, admin: AdminUser, db: DbSession
) -> AttemptReviewOut:
    """Record a new revision of a completed review's outcome, with a reason. Earlier decisions stay."""
    return AttemptReviewOut.of(
        ReviewService(db).revise(
            attempt_id,
            admin,
            outcome=payload.outcome,
            rationale=payload.rationale,
            expected_version=payload.expected_version,
        )
    )

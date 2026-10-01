"""Phase 6C — the human review of one proctored attempt.

Every write follows one shape, inside the request's single transaction (committed once by
`DatabaseSessionMiddleware`, rolled back on any error): validate the attempt → lock and validate the
review's state and version → write the change → write its audit record. Nothing is half-done.

The reviewer is always the authenticated administrator and every time is the server's: no request
can name a reviewer, an author, a status or a timestamp. Risk (6A) and evidence (6B) are only read —
for display and for the decision's recorded basis — and are never changed by a review.
"""

import base64
import binascii
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AttemptStillOpen, NotFound, ReviewConflict, ReviewNotStarted, ValidationFailed
from app.models.attempt import AssessmentAttempt
from app.models.audit_log import AuditAction, AuditLog
from app.models.base import utcnow
from app.models.proctoring import ProctoringSession
from app.models.review import (
    AttemptReview,
    EvidenceMark,
    ReviewDecision,
    ReviewMark,
    ReviewNote,
    ReviewOutcome,
    ReviewStatus,
)
from app.models.user import User
from app.repositories.audit import AuditRepository
from app.repositories.reviews import QueueFilter, QueueRow, ReviewRepository
from app.services.attempts import AttemptService
from app.services.review import policy
from app.services.risk.engine import RiskAssessment
from app.services.risk.service import RiskService

log = logging.getLogger("assessx.review")

QUEUE_DEFAULT_LIMIT = 20
QUEUE_MAX_LIMIT = 50


@dataclass(frozen=True)
class ReviewView:
    attempt: AssessmentAttempt
    session: ProctoringSession
    review: AttemptReview | None
    notes: list[ReviewNote]
    decisions: list[ReviewDecision]
    marks: list[ReviewMark]
    history: list[AuditLog]


@dataclass(frozen=True)
class ReviewQueue:
    counts: dict[str, int]
    rows: list[QueueRow]
    risks: dict[uuid.UUID, RiskAssessment]
    next_cursor: str | None


def _encode_cursor(row: QueueRow) -> str:
    raw = f"{row.attempt.started_at.isoformat()}|{row.attempt.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        started, attempt_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(started), uuid.UUID(attempt_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as error:
        raise ValidationFailed(
            "Invalid cursor.",
            details=[{"field": "cursor", "message": "Use next_cursor from a previous page."}],
        ) from error


class ReviewService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ReviewRepository(db)
        self.audit = AuditRepository(db)
        self.risk = RiskService(db)

    # -- reading ---------------------------------------------------------------------------

    @staticmethod
    def _proctored(attempt: AssessmentAttempt | None) -> ProctoringSession:
        """Only proctored attempts have risk and evidence to review — the same 404 as 6A/6B."""
        if attempt is None or attempt.proctoring_session is None:
            raise NotFound("No proctoring session for that attempt.")
        return attempt.proctoring_session

    def view(self, attempt_id: uuid.UUID) -> ReviewView:
        attempt = self.repo.attempt(attempt_id)
        session = self._proctored(attempt)
        assert attempt is not None
        review = self.repo.get(attempt_id)
        if review is None:
            return ReviewView(attempt, session, None, [], [], [], self.audit.for_attempt(attempt_id))
        return ReviewView(
            attempt,
            session,
            review,
            self.repo.notes(review.id),
            self.repo.decisions(review.id),
            sorted(self.repo.current_marks(review.id).values(), key=lambda m: (m.created_at, str(m.id))),
            self.audit.for_attempt(attempt_id),
        )

    # -- state checks ----------------------------------------------------------------------

    @staticmethod
    def _conflict(review: AttemptReview) -> ReviewConflict:
        decided_by = review.completed_by.name if review.completed_by else None
        return ReviewConflict(
            details={
                "status": review.status.value,
                "version": review.version,
                "outcome": review.outcome.value if review.outcome else None,
                "completed_by": decided_by,
                "completed_at": review.completed_at.isoformat() if review.completed_at else None,
            }
        )

    def _expect(
        self, review: AttemptReview, allowed: frozenset[ReviewStatus], expected_version: int | None
    ) -> None:
        if review.status not in allowed:
            raise self._conflict(review)
        if expected_version is not None and review.version != expected_version:
            raise self._conflict(review)

    def _record(
        self, admin: User, action: AuditAction, attempt: AssessmentAttempt, **details: object
    ) -> None:
        self.audit.record(
            actor_id=admin.id,
            action=action,
            attempt_id=attempt.id,
            assessment_id=attempt.assessment_id,
            details={k: v for k, v in details.items() if v is not None},
        )
        log.info(
            "Review action",
            extra={"action": action.value, "admin_id": str(admin.id), "attempt_id": str(attempt.id)},
        )

    # -- writing ---------------------------------------------------------------------------

    def start(self, attempt_id: uuid.UUID, admin: User) -> tuple[ReviewView, bool]:
        """UNREVIEWED → IN_REVIEW. Idempotent: an existing review is returned as it is.

        Two administrators starting at once race on the unique `attempt_id`; the loser's savepoint
        is rolled back and it reads the winner's review, so both see the same one.
        """
        attempt = self.repo.attempt(attempt_id)
        self._proctored(attempt)
        assert attempt is not None
        if self.repo.get(attempt_id) is not None:
            return self.view(attempt_id), False
        review = AttemptReview(
            attempt_id=attempt.id,
            status=ReviewStatus.IN_REVIEW,
            version=1,
            started_by=admin,
            started_at=utcnow(),
        )
        try:
            with self.db.begin_nested():
                self.repo.add(review)
        except IntegrityError:
            if self.repo.get(attempt_id) is None:
                raise
            return self.view(attempt_id), False
        self._record(
            admin, AuditAction.REVIEW_STARTED, attempt, to_status=ReviewStatus.IN_REVIEW.value, version=1
        )
        return self.view(attempt_id), True

    def add_note(self, attempt_id: uuid.UUID, admin: User, body: str) -> ReviewView:
        """An immutable, human-authored note. Allowed while in review and after completion."""
        attempt = self.repo.attempt(attempt_id)
        self._proctored(attempt)
        assert attempt is not None
        review = self.repo.get(attempt_id)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, policy.NOTE_FROM, None)
        note = ReviewNote(review_id=review.id, author=admin, body=body, created_at=utcnow())
        self.repo.add(note)
        # The note's text is not copied into the audit record or the log — only that it exists.
        self._record(admin, AuditAction.REVIEW_NOTE_ADDED, attempt, note_id=str(note.id), length=len(body))
        return self.view(attempt_id)

    def mark(
        self, attempt_id: uuid.UUID, evidence_id: uuid.UUID, admin: User, mark: EvidenceMark
    ) -> ReviewView:
        """Confirm or dismiss one evidence item of *this* attempt (validated through Phase 6B).

        Only while the review is open. Never changes the evidence or the risk score.
        """
        attempt = self.repo.attempt(attempt_id)
        self._proctored(attempt)
        assert attempt is not None
        review = self.repo.get_locked(attempt_id)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, policy.MARK_FROM, None)
        # 404 unless the id is an evidence item of this attempt — the 6B rule, reused not repeated.
        self.risk.evidence_item(attempt_id, evidence_id)
        current = self.repo.current_marks(review.id).get(evidence_id)
        if current is not None and current.mark is mark:
            return self.view(attempt_id)
        self.repo.add(
            ReviewMark(
                review_id=review.id,
                evidence_event_id=evidence_id,
                mark=mark,
                author=admin,
                created_at=utcnow(),
            )
        )
        self._record(
            admin,
            AuditAction.REVIEW_EVIDENCE_MARKED,
            attempt,
            evidence_id=str(evidence_id),
            mark=mark.value,
            previous_mark=current.mark.value if current else None,
        )
        return self.view(attempt_id)

    def _decide(
        self, review: AttemptReview, admin: User, outcome: ReviewOutcome, rationale: str, now: datetime
    ) -> ReviewDecision:
        basis = self.risk.basis(review.attempt_id, now=now)
        decision = ReviewDecision(
            review_id=review.id,
            revision=self.repo.next_revision(review.id),
            outcome=outcome,
            rationale=rationale,
            decided_by=admin,
            decided_at=now,
            policy_version=basis.risk.policy_version,
            evidence_version=basis.evidence.evidence_version,
            risk_as_of=basis.risk.as_of,
            risk_score=basis.risk.current_score,
            risk_level=basis.risk.level,
            peak_score=basis.risk.peak_score,
            peak_level=basis.risk.peak_level,
            signal_count=basis.risk.signal_count,
            evidence_count=len(basis.evidence.items),
            episode_count=len(basis.evidence.episodes),
        )
        self.repo.add(decision)
        return decision

    def complete(
        self,
        attempt_id: uuid.UUID,
        admin: User,
        *,
        outcome: ReviewOutcome,
        rationale: str,
        expected_version: int,
    ) -> ReviewView:
        """IN_REVIEW → REVIEWED with a human-chosen outcome (revision 1). Transactional.

        The attempt is locked first (and its clock applied, as a submit would), then the review:
        a second administrator completing at the same moment waits here, then sees REVIEWED and a
        new version, and gets 409 — the first decision is never overwritten.
        """
        attempt = self.repo.attempt_locked(attempt_id)
        self._proctored(attempt)
        assert attempt is not None
        AttemptService(self.db).settle(attempt)
        review = self.repo.get_locked(attempt_id)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, policy.COMPLETE_FROM, expected_version)
        if not attempt.is_finalized:
            raise AttemptStillOpen()

        now = utcnow()
        decision = self._decide(review, admin, outcome, rationale, now)
        review.status = ReviewStatus.REVIEWED
        review.outcome = outcome
        review.completed_by = admin
        review.completed_at = now
        review.version += 1
        self.db.flush()
        self._record(
            admin,
            AuditAction.REVIEW_COMPLETED,
            attempt,
            from_status=ReviewStatus.IN_REVIEW.value,
            to_status=ReviewStatus.REVIEWED.value,
            outcome=outcome.value,
            revision=decision.revision,
            version=review.version,
            risk_level=decision.risk_level,
            risk_score=decision.risk_score,
            policy_version=decision.policy_version,
        )
        return self.view(attempt_id)

    def revise(
        self,
        attempt_id: uuid.UUID,
        admin: User,
        *,
        outcome: ReviewOutcome,
        rationale: str,
        expected_version: int,
    ) -> ReviewView:
        """A new revision of a completed review's outcome, with a required reason.

        The earlier decision is kept unchanged; the review's current outcome moves to the new one.
        Revising to the outcome already recorded is refused — a further remark is a note.
        """
        attempt = self.repo.attempt(attempt_id)
        self._proctored(attempt)
        assert attempt is not None
        review = self.repo.get_locked(attempt_id)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, policy.REVISE_FROM, expected_version)
        previous = review.outcome
        if outcome is previous:
            raise ValidationFailed(
                "That outcome is already recorded.",
                details=[
                    {"field": "outcome", "message": "Choose a different outcome, or add a note instead."}
                ],
            )

        now = utcnow()
        decision = self._decide(review, admin, outcome, rationale, now)
        review.outcome = outcome
        review.completed_by = admin
        review.completed_at = now
        review.version += 1
        self.db.flush()
        self._record(
            admin,
            AuditAction.REVIEW_REVISED,
            attempt,
            previous_outcome=previous.value if previous else None,
            outcome=outcome.value,
            revision=decision.revision,
            version=review.version,
            risk_level=decision.risk_level,
            risk_score=decision.risk_score,
            policy_version=decision.policy_version,
        )
        return self.view(attempt_id)

    # -- the queue -------------------------------------------------------------------------

    def queue(
        self, f: QueueFilter, *, limit: int, cursor: str | None, now: datetime | None = None
    ) -> ReviewQueue:
        """A bounded page of proctored attempts with their review status and current risk.

        The risk is 6A's, for the page only, from one batched events query. There is no risk-level
        filter: risk is derived on demand, so filtering by it would mean evaluating every attempt.
        """
        after = _decode_cursor(cursor) if cursor else None
        rows = self.repo.queue(f, limit=limit, after=after)
        page, more = rows[:limit], len(rows) > limit
        counts = self.repo.counts(f)
        risks = self.risk.assess_many([row.session for row in page], now=now or utcnow())
        return ReviewQueue(
            counts={s: counts.get(s, 0) for s in ("UNREVIEWED", "IN_REVIEW", "REVIEWED")},
            rows=page,
            risks=risks,
            next_cursor=_encode_cursor(page[-1]) if more and page else None,
        )

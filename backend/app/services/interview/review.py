"""Phase 7C — InterviewReviewService: the human review of an interview session.

The same shape as Phase 6C's review, for interviews: validate the session → lock and validate the review's
state and version → write → audit, in the request's one transaction. Every check runs before any write.

* **Human-authored only.** The reviewer and every time come from the server; no request names them. The
  outcome is chosen by a person — nothing computes, suggests or pre-selects it from an AI score.
* **AI and human kept apart.** The review reads the report; it never changes an evaluation, an answer or
  the session. A disagreement with an AI evaluation is a mark beside it, never an edit of it.
* **Nothing is overwritten.** Notes are immutable; a completed review changes only by a new revision with
  a reason, and every earlier decision stays.
* **Concurrency.** The review row is locked (`FOR UPDATE`) and the client's `expected_version` checked, so
  a second administrator gets 409 instead of silently replacing the first one's decision.
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import (
    EvaluationsPending,
    InterviewStillActive,
    NotFound,
    ReviewConflict,
    ReviewNotStarted,
    ValidationFailed,
)
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.interview import InterviewSession, InterviewSessionItem, InterviewSessionStatus
from app.models.interview_evaluation import EvaluationStatus, InterviewEvaluation
from app.models.interview_review import (
    AnswerMark,
    InterviewReview,
    InterviewReviewDecision,
    InterviewReviewMark,
    InterviewReviewNote,
    InterviewReviewOutcome,
    InterviewReviewStatus,
)
from app.models.user import User
from app.repositories.audit import AuditRepository
from app.services.interview.report import REPORT_POLICY_VERSION, InterviewReportService, Report
from app.services.interview.sessions import InterviewSessionService

log = logging.getLogger("assessx.interviews.review")

NOTE_FROM = frozenset({InterviewReviewStatus.IN_REVIEW, InterviewReviewStatus.REVIEWED})
MARK_FROM = frozenset({InterviewReviewStatus.IN_REVIEW})
COMPLETE_FROM = frozenset({InterviewReviewStatus.IN_REVIEW})
REVISE_FROM = frozenset({InterviewReviewStatus.REVIEWED})


class InterviewReviewService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.reports = InterviewReportService(db)
        self.audit = AuditRepository(db)

    # -- helpers -------------------------------------------------------------------------------------

    def _record(self, admin: User, action: AuditAction, session: InterviewSession, **details: object) -> None:
        self.audit.record(
            actor_id=admin.id,
            action=action,
            interview_id=session.interview_id,
            interview_session_id=session.id,
            details={k: v for k, v in details.items() if v is not None},
        )
        log.info("Interview review action", extra={"action": action.value, "session_id": str(session.id)})

    def _review(self, session: InterviewSession, *, lock: bool = False) -> InterviewReview | None:
        query = select(InterviewReview).where(InterviewReview.session_id == session.id)
        if lock:
            query = query.with_for_update(of=InterviewReview).execution_options(populate_existing=True)
        return self.db.scalar(query)

    @staticmethod
    def _conflict(review: InterviewReview) -> ReviewConflict:
        return ReviewConflict(
            details={
                "status": review.status.value,
                "version": review.version,
                "outcome": review.outcome.value if review.outcome else None,
                "completed_by": review.completed_by.name if review.completed_by else None,
                "completed_at": review.completed_at.isoformat() if review.completed_at else None,
            }
        )

    def _expect(
        self, review: InterviewReview, allowed: frozenset[InterviewReviewStatus], version: int | None
    ) -> None:
        if review.status not in allowed or (version is not None and review.version != version):
            raise self._conflict(review)

    def _decide(
        self,
        review: InterviewReview,
        report: Report,
        admin: User,
        outcome: InterviewReviewOutcome,
        rationale: str,
    ) -> InterviewReviewDecision:
        revision = (
            self.db.scalar(
                select(InterviewReviewDecision.revision)
                .where(InterviewReviewDecision.review_id == review.id)
                .order_by(InterviewReviewDecision.revision.desc())
                .limit(1)
            )
            or 0
        ) + 1
        s = report.summary
        decision = InterviewReviewDecision(
            review_id=review.id,
            revision=revision,
            outcome=outcome,
            rationale=rationale,
            decided_by=admin,
            decided_at=utcnow(),
            report_policy_version=REPORT_POLICY_VERSION,
            ai_score=s.ai_score,
            ai_score_partial=s.ai_score_partial,
            evaluation_state=s.evaluation_state,
            evaluated_primaries=s.evaluated_primaries,
            answered_primaries=s.answered_primaries,
            planned_primaries=max(s.planned_primaries, s.answered_primaries),
            evaluator_versions=s.evaluator_versions,
            rubric_versions=s.rubric_versions,
        )
        self.db.add(decision)
        self.db.flush()
        return decision

    # -- writing -------------------------------------------------------------------------------------

    def start(self, interview_id: uuid.UUID, session_id: uuid.UUID, admin: User) -> bool:
        """UNREVIEWED → IN_REVIEW. Idempotent: two simultaneous starts give one review."""
        session = self.reports.session(interview_id, session_id)
        if self._review(session) is not None:
            return False
        review = InterviewReview(
            session_id=session.id,
            status=InterviewReviewStatus.IN_REVIEW,
            version=1,
            started_by=admin,
            started_at=utcnow(),
        )
        try:
            with self.db.begin_nested():
                self.db.add(review)
                self.db.flush()
        except IntegrityError:
            if self._review(session) is None:
                raise
            return False
        self._record(admin, AuditAction.INTERVIEW_REVIEW_STARTED, session, to_status="IN_REVIEW", version=1)
        return True

    def add_note(self, interview_id: uuid.UUID, session_id: uuid.UUID, admin: User, body: str) -> None:
        session = self.reports.session(interview_id, session_id)
        review = self._review(session)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, NOTE_FROM, None)
        note = InterviewReviewNote(review_id=review.id, author=admin, body=body, created_at=utcnow())
        self.db.add(note)
        self.db.flush()
        # Only that a note exists, and its length — never its text.
        self._record(
            admin, AuditAction.INTERVIEW_REVIEW_NOTE_ADDED, session, note_id=str(note.id), length=len(body)
        )

    def mark(
        self,
        interview_id: uuid.UUID,
        session_id: uuid.UUID,
        item_id: uuid.UUID,
        admin: User,
        mark: AnswerMark,
    ) -> None:
        """Agree or disagree with one answer's AI evaluation. Never changes the evaluation or its score."""
        session = self.reports.session(interview_id, session_id)
        review = self._review(session, lock=True)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, MARK_FROM, None)
        item = self.db.scalar(
            select(InterviewSessionItem).where(
                InterviewSessionItem.id == item_id, InterviewSessionItem.session_id == session.id
            )
        )
        if item is None:
            raise NotFound("That answer is not part of this interview session.")
        evaluation = self.db.scalar(
            select(InterviewEvaluation)
            .where(
                InterviewEvaluation.item_id == item.id,
                InterviewEvaluation.status == EvaluationStatus.COMPLETED,
            )
            .order_by(InterviewEvaluation.requested_at.desc(), InterviewEvaluation.id.desc())
            .limit(1)
        )
        if evaluation is None:
            raise ValidationFailed(
                "This answer has no completed AI evaluation to agree or disagree with.",
                details=[{"field": "item_id", "message": "Not evaluated."}],
            )
        current = self.db.scalar(
            select(InterviewReviewMark)
            .where(InterviewReviewMark.review_id == review.id, InterviewReviewMark.item_id == item.id)
            .order_by(InterviewReviewMark.created_at.desc(), InterviewReviewMark.id.desc())
            .limit(1)
        )
        if current is not None and current.mark is mark:
            return
        self.db.add(
            InterviewReviewMark(
                review_id=review.id, item_id=item.id, evaluation_id=evaluation.id, mark=mark, author=admin,
                created_at=utcnow(),
            )
        )  # fmt: skip
        self.db.flush()
        self._record(
            admin,
            AuditAction.INTERVIEW_REVIEW_ANSWER_MARKED,
            session,
            item_id=str(item.id),
            evaluation_id=str(evaluation.id),
            mark=mark.value,
            previous_mark=current.mark.value if current else None,
        )

    def complete(
        self,
        interview_id: uuid.UUID,
        session_id: uuid.UUID,
        admin: User,
        *,
        outcome: InterviewReviewOutcome,
        rationale: str,
        expected_version: int,
    ) -> None:
        """IN_REVIEW → REVIEWED with a human-chosen outcome, once the interview has ended and every answer's
        evaluation has finished. Transactional; the decision keeps the report figures it was made on."""
        session = self.reports.session(interview_id, session_id, lock=True)
        InterviewSessionService(self.db).settle(session, utcnow())  # the server's clock, as for exam attempts
        review = self._review(session, lock=True)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, COMPLETE_FROM, expected_version)
        if session.status is not InterviewSessionStatus.COMPLETED:
            raise InterviewStillActive()
        report = self.reports.build(interview_id, session_id)
        if any(r.evaluation and r.evaluation.status is EvaluationStatus.PENDING for r in report.items):
            raise EvaluationsPending()

        decision = self._decide(review, report, admin, outcome, rationale)
        review.status = InterviewReviewStatus.REVIEWED
        review.outcome = outcome
        review.completed_by = admin
        review.completed_at = decision.decided_at
        review.version += 1
        self.db.flush()
        self._record(
            admin,
            AuditAction.INTERVIEW_REVIEW_COMPLETED,
            session,
            from_status="IN_REVIEW",
            to_status="REVIEWED",
            outcome=outcome.value,
            revision=decision.revision,
            version=review.version,
            ai_score=decision.ai_score,
            ai_score_partial=decision.ai_score_partial,
            evaluation_state=decision.evaluation_state,
            report_policy_version=REPORT_POLICY_VERSION,
        )

    def revise(
        self,
        interview_id: uuid.UUID,
        session_id: uuid.UUID,
        admin: User,
        *,
        outcome: InterviewReviewOutcome,
        rationale: str,
        expected_version: int,
    ) -> None:
        """A new revision of a completed review, with a reason. The earlier decision is kept unchanged."""
        session = self.reports.session(interview_id, session_id, lock=True)
        review = self._review(session, lock=True)
        if review is None:
            raise ReviewNotStarted()
        self._expect(review, REVISE_FROM, expected_version)
        previous = review.outcome
        if outcome is previous:
            raise ValidationFailed(
                "That outcome is already recorded.",
                details=[
                    {"field": "outcome", "message": "Choose a different outcome, or add a note instead."}
                ],
            )
        report = self.reports.build(interview_id, session_id)
        decision = self._decide(review, report, admin, outcome, rationale)
        review.outcome = outcome
        review.completed_by = admin
        review.completed_at = decision.decided_at
        review.version += 1
        self.db.flush()
        self._record(
            admin,
            AuditAction.INTERVIEW_REVIEW_REVISED,
            session,
            previous_outcome=previous.value if previous else None,
            outcome=outcome.value,
            revision=decision.revision,
            version=review.version,
            ai_score=decision.ai_score,
            report_policy_version=REPORT_POLICY_VERSION,
        )

"""Phase 7A/7B — a candidate's interview session: start, read, answer, complete. The server owns all of it.

* **Ownership.** Every lookup is scoped by the authenticated candidate; another candidate's interview
  or session is not found. Nothing in a request names a candidate, a status or a question number.
* **The clock.** `expires_at` is fixed at start. Every read and write first applies the server's clock
  (`settle`): an interview past its deadline is completed as TIME_EXPIRED, with `completed_at` set to
  the deadline — the moment it really ended. A client's time is never used. Waiting for an evaluation
  does not stop the clock.
* **One question at a time.** The current question is the one PRESENTED item. An answer names that
  item; anything else — a retry, a replay, a second window — is refused as stale and saves nothing.
* **Transactions.** Every write locks the session row (`FOR UPDATE`) first.

**Phase 7B — evaluation and adaptation.** Submitting an answer saves it and records an evaluation request
for *the stored answer*. With no evaluator configured the request is recorded as UNAVAILABLE and the
interview moves on at once by the 7A rules. With one, the answer response says the answer is being
processed; the evaluation runs in the background (`runner.py`) without holding this lock, and the next
question is presented — by the adaptive policy, from the validated result — when it completes, or by the
fallback rule once `evaluation_wait_seconds` have passed without one. Moving on happens only under the
session lock and only while no question is presented, so it happens exactly once whoever triggers it.
AI evaluation is an assessment signal: nothing here hires, rejects or ranks, and no score reaches the
candidate.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, InterviewCompleted, LiveInterview, NotFound, StaleInterviewQuestion
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.interview import (
    CompletionReason,
    Interview,
    InterviewFormat,
    InterviewSession,
    InterviewSessionItem,
    InterviewSessionStatus,
    InterviewStatus,
    ItemState,
    QuestionKind,
    SelectedBy,
)
from app.models.interview_evaluation import EvaluationFailure, EvaluationStatus, InterviewEvaluation
from app.models.user import User
from app.repositories.audit import AuditRepository
from app.repositories.interviews import InterviewRepository
from app.services.interview.adaptive import POLICY_VERSION, Signal, decide
from app.services.interview.evaluation import EVALUATOR_VERSION
from app.services.interview.prompts import PROMPT_VERSION
from app.services.interview.rubrics import rubric_for
from app.services.interview.selection import (
    available_follow_up,
    build_plan,
    follow_ups_by_parent,
    next_primary,
)

log = logging.getLogger("assessx.interviews")

#: A PENDING evaluation not picked up within this long (e.g. the server restarted) is run again.
STALE_PENDING_SECONDS = 10


@dataclass(frozen=True)
class EvaluatorInfo:
    """What the session service needs to know about the evaluator — never a key or a client."""

    provider: str
    model: str
    configured: bool
    wait_seconds: int = 25


NOT_CONFIGURED = EvaluatorInfo(provider="none", model="none", configured=False)


@dataclass(frozen=True)
class SessionView:
    session: InterviewSession
    items: list[InterviewSessionItem]
    now: datetime

    @property
    def current(self) -> InterviewSessionItem | None:
        if self.session.status is not InterviewSessionStatus.ACTIVE:
            return None
        return next((i for i in self.items if i.state is ItemState.PRESENTED), None)

    @property
    def processing(self) -> bool:
        """The last answer is being evaluated; the next question is not decided yet."""
        return (
            self.session.status is InterviewSessionStatus.ACTIVE and bool(self.items) and self.current is None
        )

    def number_of(self, item: InterviewSessionItem) -> int:
        """The primary question number an item belongs to (a follow-up shares its primary's)."""
        primaries = [i for i in self.items if i.kind is QuestionKind.PRIMARY]
        anchor = item.id if item.kind is QuestionKind.PRIMARY else item.parent_item_id
        return next((n for n, i in enumerate(primaries, start=1) if i.id == anchor), len(primaries))

    @property
    def primary_answered(self) -> int:
        return sum(i.kind is QuestionKind.PRIMARY and i.state is ItemState.ANSWERED for i in self.items)

    @property
    def follow_ups_answered(self) -> int:
        return sum(i.kind is QuestionKind.FOLLOW_UP and i.state is ItemState.ANSWERED for i in self.items)


class InterviewSessionService:
    def __init__(self, db: Session, evaluator: EvaluatorInfo = NOT_CONFIGURED) -> None:
        self.db = db
        self.repo = InterviewRepository(db)
        self.audit = AuditRepository(db)
        self.evaluator = evaluator

    # -- helpers -----------------------------------------------------------------------------

    def _record(
        self, actor_id: uuid.UUID, action: AuditAction, session: InterviewSession, **details: object
    ) -> None:
        self.audit.record(
            actor_id=actor_id,
            action=action,
            interview_id=session.interview_id,
            interview_session_id=session.id,
            details={k: v for k, v in details.items() if v is not None},
        )
        log.info("Interview session action", extra={"action": action.value, "session_id": str(session.id)})

    def _assigned_interview(self, interview_id: uuid.UUID, candidate: User) -> Interview:
        """A published interview this candidate is assigned to — anything else is not found."""
        assignment = self.repo.assignment(interview_id, candidate.id)
        if assignment is None or assignment.interview.status is not InterviewStatus.PUBLISHED:
            raise NotFound("Interview not found.")
        return assignment.interview

    def _complete(
        self,
        session: InterviewSession,
        reason: CompletionReason,
        at: datetime,
        actor_id: uuid.UUID,
        **extra: object,
    ) -> None:
        session.status = InterviewSessionStatus.COMPLETED
        session.completion_reason = reason
        session.completed_at = at
        self.db.flush()
        self._record(actor_id, AuditAction.INTERVIEW_SESSION_COMPLETED, session, reason=reason.value, **extra)

    def settle(self, session: InterviewSession, now: datetime) -> InterviewSession:
        """Applies the server's clock. Call only on a locked row. An expired interview is completed
        as of its deadline; the record names the server's clock as what ended it."""
        if session.status is InterviewSessionStatus.ACTIVE and session.has_expired_at(now):
            self._complete(
                session,
                CompletionReason.TIME_EXPIRED,
                session.expires_at,
                session.candidate_id,
                ended_by="server_clock",
            )
        return session

    def _view(self, session: InterviewSession, now: datetime) -> SessionView:
        return SessionView(session, self.repo.items(session.id), now)

    def _locked(self, session_id: uuid.UUID, candidate: User) -> InterviewSession:
        session = self.repo.session(session_id, candidate.id, lock=True)
        if session is None:
            raise NotFound("Interview session not found.")
        return session

    def _add_item(
        self,
        session: InterviewSession,
        items: list[InterviewSessionItem],
        *,
        question_id: uuid.UUID,
        kind: QuestionKind,
        parent: InterviewSessionItem | None,
        selected_by: SelectedBy,
        now: datetime,
    ) -> InterviewSessionItem:
        item = InterviewSessionItem(
            session_id=session.id,
            question_id=question_id,
            sequence=(items[-1].sequence + 1) if items else 1,
            kind=kind,
            parent_item_id=parent.id if parent else None,
            state=ItemState.PRESENTED,
            presented_at=now,
            selected_by=selected_by,
        )
        self.repo.add(item)
        if kind is QuestionKind.FOLLOW_UP:
            session.follow_ups_used += 1  # the budget is spent when a follow-up is asked
            self.db.flush()
        return item

    def evaluation_of(self, item: InterviewSessionItem) -> InterviewEvaluation | None:
        rubric = rubric_for(item.question.question_type)
        return self.db.scalar(
            select(InterviewEvaluation).where(
                InterviewEvaluation.item_id == item.id,
                InterviewEvaluation.evaluator_version == EVALUATOR_VERSION,
                InterviewEvaluation.rubric_version == rubric.version,
            )
        )

    # -- moving on (locked) --------------------------------------------------------------------

    def advance(self, session: InterviewSession, now: datetime) -> bool:
        """Presents the next question (or completes) after the last answer — once.

        Call only on a locked, settled session. Does nothing unless the session is ACTIVE with no question
        presented. While the last answer's evaluation is PENDING it waits, until the wait has run out (then
        the fallback rule applies). Returns True if it moved the interview on.
        """
        if session.status is not InterviewSessionStatus.ACTIVE:
            return False
        items = self.repo.items(session.id)
        if not items or any(i.state is ItemState.PRESENTED for i in items):
            return False
        last = items[-1]
        evaluation = self.evaluation_of(last)
        waited_out = last.answered_at is not None and now >= last.answered_at + timedelta(
            seconds=self.evaluator.wait_seconds
        )
        if evaluation is not None and evaluation.status is EvaluationStatus.PENDING and not waited_out:
            return False

        interview = session.interview
        questions = self.repo.questions(interview.id)
        signal = (
            Signal(
                overall_score=evaluation.overall_score or 0,
                confidence=evaluation.confidence or 0,
                missing_concepts=len(evaluation.missing_concepts),
            )
            if evaluation is not None and evaluation.status is EvaluationStatus.COMPLETED
            else None
        )
        follow_up = available_follow_up(
            last=last,
            follow_ups=follow_ups_by_parent(questions),
            follow_ups_enabled=interview.follow_ups_enabled,
            max_follow_ups=interview.max_follow_ups,
            follow_ups_used=session.follow_ups_used,
        )
        decision = decide(
            answered=last.kind,
            signal=signal,
            evaluated=evaluation is not None and evaluation.status is not EvaluationStatus.UNAVAILABLE,
            follow_up_available=follow_up is not None,
            adaptive=interview.adaptive_difficulty,
            current=session.current_difficulty,
            minimum=interview.min_difficulty,
            maximum=interview.difficulty,
        )
        if decision.change:
            session.current_difficulty = decision.difficulty
            session.difficulty_changes += 1

        presented: InterviewSessionItem | None = None
        if decision.follow_up and follow_up is not None:
            presented = self._add_item(
                session, items, question_id=follow_up.id, kind=QuestionKind.FOLLOW_UP, parent=last,
                selected_by=decision.selected_by, now=now,
            )  # fmt: skip
        else:
            primary_id = next_primary(
                plan=session.question_plan,
                items=items,
                question_count=interview.question_count,
                target=session.current_difficulty if interview.adaptive_difficulty else None,
                difficulty_of={str(q.id): q.difficulty for q in questions},
            )
            if primary_id is not None:
                presented = self._add_item(
                    session, items, question_id=primary_id, kind=QuestionKind.PRIMARY, parent=None,
                    selected_by=decision.selected_by, now=now,
                )  # fmt: skip

        if decision.selected_by is not SelectedBy.PLAN:
            # Recorded whenever an evaluator was involved: what was decided, from which signal, and why.
            self._record(
                session.candidate_id,
                AuditAction.INTERVIEW_ADAPTIVE_DECISION,
                session,
                answered_item_id=str(last.id),
                evaluation_status=evaluation.status.value if evaluation else None,
                overall_score=evaluation.overall_score if evaluation else None,
                follow_up=decision.follow_up,
                difficulty=decision.difficulty.value,
                difficulty_change=decision.change,
                selected_by=decision.selected_by.value,
                reason=decision.reason,
                policy_version=POLICY_VERSION,
                next_item_id=str(presented.id) if presented else None,
            )
        if presented is None:
            self._complete(session, CompletionReason.ALL_ANSWERED, now, session.candidate_id)
        return True

    def stale_evaluations(self, session: InterviewSession, now: datetime) -> list[uuid.UUID]:
        """PENDING evaluations of this session that nobody is running (lease expired or never taken)."""
        rows = self.db.scalars(
            select(InterviewEvaluation).where(
                InterviewEvaluation.session_id == session.id,
                InterviewEvaluation.status == EvaluationStatus.PENDING,
            )
        )
        cutoff = now - timedelta(seconds=STALE_PENDING_SECONDS)
        return [
            e.id
            for e in rows
            if (e.lease_until is None and e.requested_at <= cutoff)
            or (e.lease_until is not None and e.lease_until < now)
        ]

    # -- reading -----------------------------------------------------------------------------

    def my_interviews(
        self,
        candidate: User,
        page=None,  # noqa: ANN001 — a Page
    ) -> list[tuple[Interview, InterviewSession | None]]:
        return self.repo.for_candidate(candidate.id, page)

    def detail(self, interview_id: uuid.UUID, candidate: User) -> tuple[Interview, InterviewSession | None]:
        interview = self._assigned_interview(interview_id, candidate)
        return interview, self.repo.session_for(interview.id, candidate.id)

    def state(self, session_id: uuid.UUID, candidate: User) -> tuple[SessionView, list[uuid.UUID]]:
        """The authoritative state. Reading it applies the clock, moves on if the last answer's evaluation
        has resolved (or the wait has run out), and reports evaluations to re-run. It never skips ahead."""
        now = utcnow()
        session = self.settle(self._locked(session_id, candidate), now)
        self.advance(session, now)
        return self._view(session, now), self.stale_evaluations(session, now)

    # -- writing -----------------------------------------------------------------------------

    def start(self, interview_id: uuid.UUID, candidate: User) -> tuple[SessionView, bool]:
        """Starts the candidate's session, or returns the one they already have (resume). There is
        one session per candidate per interview, so a completed interview is shown, not restarted."""
        interview = self._assigned_interview(interview_id, candidate)
        if interview.format is InterviewFormat.LIVE:
            raise LiveInterview()
        now = utcnow()
        existing = self.repo.session_for(interview.id, candidate.id, lock=True)
        if existing is not None:
            return self._view(self.settle(existing, now), now), False

        questions = self.repo.questions(interview.id)
        plan = build_plan(interview, questions)
        if not plan:
            raise Conflict("This interview has no questions to ask.")
        assignment = self.repo.assignment(interview.id, candidate.id)
        assert assignment is not None
        start_at = interview.starting_difficulty if interview.adaptive_difficulty else interview.difficulty
        session = InterviewSession(
            interview_id=interview.id,
            candidate_id=candidate.id,
            assignment_id=assignment.id,
            status=InterviewSessionStatus.ACTIVE,
            started_at=now,
            expires_at=now + timedelta(minutes=interview.duration_minutes),
            question_plan=plan,
            follow_ups_used=0,
            current_difficulty=start_at,
            difficulty_changes=0,
        )
        try:
            # A savepoint: two simultaneous starts race on the unique (interview, candidate); the loser
            # rolls back to here and resumes the winner's session.
            with self.db.begin_nested():
                self.repo.add(session)
                first = next_primary(
                    plan=plan,
                    items=[],
                    question_count=interview.question_count,
                    target=start_at if interview.adaptive_difficulty else None,
                    difficulty_of={str(q.id): q.difficulty for q in questions},
                )
                assert first is not None
                self._add_item(
                    session, [], question_id=first, kind=QuestionKind.PRIMARY, parent=None,
                    selected_by=SelectedBy.PLAN, now=now,
                )  # fmt: skip
        except IntegrityError:
            winner = self.repo.session_for(interview.id, candidate.id, lock=True)
            if winner is None:
                raise
            return self._view(winner, now), False
        self._record(candidate.id, AuditAction.INTERVIEW_SESSION_STARTED, session, questions=len(plan))
        return self._view(session, now), True

    def answer(
        self, session_id: uuid.UUID, candidate: User, item_id: uuid.UUID, text: str
    ) -> tuple[SessionView, list[uuid.UUID]]:
        """Saves the answer to the current question, requests its evaluation, and — when no evaluator is
        configured — moves on at once. Returns the new state and the evaluations to run."""
        now = utcnow()
        session = self.settle(self._locked(session_id, candidate), now)
        if session.status is not InterviewSessionStatus.ACTIVE:
            raise InterviewCompleted(details={"completion_reason": session.completion_reason.value})
        items = self.repo.items(session.id)
        current = next((i for i in items if i.state is ItemState.PRESENTED), None)
        if current is None or current.id != item_id:
            raise StaleInterviewQuestion(details={"current_item_id": str(current.id) if current else None})

        current.state = ItemState.ANSWERED
        current.answer_text = text
        current.answered_at = now
        self.db.flush()  # the answered row must leave PRESENTED before the next one is presented
        # The answer's text is never copied into the audit record or the log — only its length.
        self._record(
            candidate.id,
            AuditAction.INTERVIEW_ANSWER_SUBMITTED,
            session,
            item_id=str(current.id),
            question_id=str(current.question_id),
            kind=current.kind.value,
            sequence=current.sequence,
            length=len(text),
        )

        rubric = rubric_for(current.question.question_type)
        configured = self.evaluator.configured
        evaluation = InterviewEvaluation(
            item_id=current.id,
            session_id=session.id,
            question_id=current.question_id,
            status=EvaluationStatus.PENDING if configured else EvaluationStatus.UNAVAILABLE,
            failure_reason=None if configured else EvaluationFailure.NOT_CONFIGURED,
            provider=self.evaluator.provider,
            model=self.evaluator.model,
            evaluator_version=EVALUATOR_VERSION,
            rubric_id=rubric.id,
            rubric_version=rubric.version,
            prompt_version=PROMPT_VERSION,
            attempts=0,
            requested_at=now,
        )
        self.repo.add(evaluation)
        if not configured:
            self.advance(session, now)
            return self._view(session, now), []
        self._record(
            candidate.id, AuditAction.INTERVIEW_EVALUATION_REQUESTED, session, **evaluation.details()
        )
        return self._view(session, now), [evaluation.id]

    def complete(self, session_id: uuid.UUID, candidate: User) -> SessionView:
        """Ends the interview early, at the candidate's request. Idempotent once completed. The
        question on screen is left unanswered — nothing is invented for it."""
        now = utcnow()
        session = self.settle(self._locked(session_id, candidate), now)
        if session.status is InterviewSessionStatus.ACTIVE:
            self._complete(session, CompletionReason.ENDED_BY_CANDIDATE, now, candidate.id)
        return self._view(session, now)

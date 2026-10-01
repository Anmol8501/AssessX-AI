"""Phase 7C — InterviewReportService: the administrative report of one interview session.

Derived on demand from the stored rows — the session, its questions and answers, the Phase 7B
evaluations, the adaptive decisions recorded in the audit log, and the human review. Nothing is
re-evaluated and nothing is invented: an answer with no completed evaluation is shown as *answered, not
evaluated*, never as 0. A COMPLETED evaluation never changes, so a finished session's report is stable;
the human review records the figures it was made on (`InterviewReviewDecision`'s basis).

**Aggregation policy `7C-v1`** (deterministic, documented; reuses 7B's stored per-answer scores — no
second scoring algorithm):

* *AI assessment score* = the mean, rounded half up, of the `overall_score` of the **evaluated primary**
  answers. Follow-up answers are shown and evaluated but not averaged: a follow-up is asked only after a
  weak answer, so averaging it would make the score depend on the interview's path.
* The score is **partial** when some answered primary was not evaluated (failed, unavailable, pending).
* *Topic score* = the same mean within one topic. *Dimension means* are per rubric version, one decimal.
* *Completion* = answered primaries / planned primaries — a completion figure, never a score.

AI evaluation is an assessment signal and does not make hiring decisions; the report says so.
"""

import base64
import binascii
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import Select, String, case, func, literal, select, tuple_
from sqlalchemy.orm import Session

from app.core.errors import NotFound, ValidationFailed
from app.models.audit_log import AuditAction, AuditLog
from app.models.base import utcnow
from app.models.interview import (
    Interview,
    InterviewSession,
    InterviewSessionItem,
    ItemState,
    QuestionKind,
)
from app.models.interview_evaluation import EvaluationStatus, InterviewEvaluation
from app.models.interview_review import (
    INTERVIEW_UNREVIEWED,
    InterviewReview,
    InterviewReviewDecision,
    InterviewReviewMark,
    InterviewReviewNote,
)
from app.models.user import User

REPORT_POLICY_VERSION = "7C-v1"
HISTORY_LIMIT = 200
_REVIEW_ACTIONS = (
    AuditAction.INTERVIEW_REVIEW_STARTED,
    AuditAction.INTERVIEW_REVIEW_NOTE_ADDED,
    AuditAction.INTERVIEW_REVIEW_ANSWER_MARKED,
    AuditAction.INTERVIEW_REVIEW_COMPLETED,
    AuditAction.INTERVIEW_REVIEW_REVISED,
)

AI_NOTE = (
    "AI-generated assessment signal from the stored answer evaluations. It does not make hiring decisions "
    "and must be interpreted by a person. Unevaluated answers are excluded, never counted as zero."
)


# -- pure aggregation (policy 7C-v1) -------------------------------------------------------------------


def mean_half_up(values: list[int]) -> int | None:
    if not values:
        return None
    return int((Decimal(sum(values)) / Decimal(len(values))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def percent(part: int, whole: int) -> int:
    """`part / whole` as a whole percentage, rounded half up; 0 when there is nothing to complete."""
    if whole <= 0:
        return 0
    return int((Decimal(100 * part) / Decimal(whole)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def evaluation_state(statuses: list[EvaluationStatus | None]) -> str:
    """Over the *answered* items: NONE (nothing answered or nothing evaluated), PENDING (any still being
    evaluated), COMPLETE (every answer evaluated), PARTIAL (some evaluated, some failed/unavailable)."""
    if not statuses:
        return "NONE"
    if any(s is EvaluationStatus.PENDING for s in statuses):
        return "PENDING"
    completed = sum(s is EvaluationStatus.COMPLETED for s in statuses)
    if completed == len(statuses):
        return "COMPLETE"
    return "NONE" if completed == 0 else "PARTIAL"


@dataclass(frozen=True)
class ReportItem:
    item: InterviewSessionItem
    number: int
    evaluation: InterviewEvaluation | None
    #: The adaptive decision recorded right after this answer (policy reason codes — not AI reasoning).
    decision: dict[str, Any] | None
    #: The reviewer's current agree/disagree on this answer's evaluation.
    mark: InterviewReviewMark | None

    @property
    def answered(self) -> bool:
        return self.item.state is ItemState.ANSWERED

    @property
    def evaluated(self) -> bool:
        return self.evaluation is not None and self.evaluation.status is EvaluationStatus.COMPLETED


@dataclass(frozen=True)
class TopicSummary:
    topic: str
    asked: int
    answered: int
    evaluated: int
    ai_score: int | None
    #: `(concept, how many evaluated answers in this topic missed it)`, most frequent first.
    common_missing: list[tuple[str, int]]


@dataclass(frozen=True)
class Summary:
    planned_primaries: int
    primaries_asked: int
    answered_primaries: int
    follow_ups_asked: int
    follow_ups_answered: int
    answered_total: int
    evaluated_primaries: int
    evaluated_total: int
    evaluation_state: str
    ai_score: int | None
    ai_score_partial: bool
    completion_percent: int
    duration_seconds: int
    evaluator_versions: list[str]
    rubric_versions: list[str]
    models: list[str]
    #: `{rubric version: {dimension: mean 0–10, one decimal}}` over evaluated primary answers.
    dimension_means: dict[str, dict[str, float]]


def summarize(session: InterviewSession, items: list[ReportItem], now: datetime) -> Summary:
    primaries = [r for r in items if r.item.kind is QuestionKind.PRIMARY]
    follow_ups = [r for r in items if r.item.kind is QuestionKind.FOLLOW_UP]
    answered = [r for r in items if r.answered]
    answered_primaries = [r for r in primaries if r.answered]
    evaluated_primaries = [r for r in answered_primaries if r.evaluated]
    evaluated_all = [r for r in answered if r.evaluated]
    planned = min(session.interview.question_count, len(session.question_plan))

    dimensions: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for r in evaluated_primaries:
        assert r.evaluation is not None and r.evaluation.dimension_scores is not None
        for key, score in r.evaluation.dimension_scores.items():
            dimensions[r.evaluation.rubric_version][key].append(score)

    ended = session.completed_at or now
    return Summary(
        planned_primaries=planned,
        primaries_asked=len(primaries),
        answered_primaries=len(answered_primaries),
        follow_ups_asked=len(follow_ups),
        follow_ups_answered=sum(r.answered for r in follow_ups),
        answered_total=len(answered),
        evaluated_primaries=len(evaluated_primaries),
        evaluated_total=len(evaluated_all),
        evaluation_state=evaluation_state([r.evaluation.status if r.evaluation else None for r in answered]),
        ai_score=mean_half_up([r.evaluation.overall_score or 0 for r in evaluated_primaries if r.evaluation]),
        ai_score_partial=len(evaluated_primaries) < len(answered_primaries),
        completion_percent=percent(len(answered_primaries), planned),
        duration_seconds=max(0, int((ended - session.started_at).total_seconds())),
        evaluator_versions=sorted({r.evaluation.evaluator_version for r in evaluated_all if r.evaluation}),
        rubric_versions=sorted({r.evaluation.rubric_version for r in evaluated_all if r.evaluation}),
        models=sorted(
            {f"{r.evaluation.provider}/{r.evaluation.model}" for r in evaluated_all if r.evaluation}
        ),
        dimension_means={
            rubric: {
                key: float(
                    (Decimal(sum(v)) / Decimal(len(v))).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
                )
                for key, v in dims.items()
            }
            for rubric, dims in dimensions.items()
        },
    )


def topics(items: list[ReportItem]) -> list[TopicSummary]:
    by_topic: dict[str, list[ReportItem]] = defaultdict(list)
    for r in items:
        by_topic[r.item.question.topic].append(r)
    out: list[TopicSummary] = []
    for topic, rows in by_topic.items():
        primaries = [r for r in rows if r.item.kind is QuestionKind.PRIMARY]
        evaluated_primaries = [r for r in primaries if r.answered and r.evaluated]
        missing = Counter(
            concept for r in rows if r.evaluated and r.evaluation for concept in r.evaluation.missing_concepts
        )
        out.append(
            TopicSummary(
                topic=topic,
                asked=len(primaries),
                answered=sum(r.answered for r in primaries),
                evaluated=len(evaluated_primaries),
                ai_score=mean_half_up(
                    [r.evaluation.overall_score or 0 for r in evaluated_primaries if r.evaluation]
                ),
                common_missing=sorted(missing.items(), key=lambda kv: (-kv[1], kv[0]))[:5],
            )
        )
    return sorted(out, key=lambda t: t.topic.lower())


# -- loading ------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ReviewState:
    review: InterviewReview | None
    notes: list[InterviewReviewNote] = field(default_factory=list)
    decisions: list[InterviewReviewDecision] = field(default_factory=list)
    history: list[AuditLog] = field(default_factory=list)


@dataclass(frozen=True)
class Report:
    interview: Interview
    session: InterviewSession
    candidate: User
    items: list[ReportItem]
    summary: Summary
    topics: list[TopicSummary]
    review: ReviewState
    generated_at: datetime


@dataclass(frozen=True)
class QueueFilter:
    interview_id: uuid.UUID | None = None
    session_status: str | None = None
    review_status: str | None = None
    evaluation_state: str | None = None
    finished_from: datetime | None = None
    finished_to: datetime | None = None


@dataclass(frozen=True)
class QueueRow:
    session: InterviewSession
    candidate: User
    review: InterviewReview | None
    evaluation_state: str
    answered: int
    ai_score: int | None


def _encode(session: InterviewSession) -> str:
    return base64.urlsafe_b64encode(f"{session.started_at.isoformat()}|{session.id}".encode()).decode()


def _decode(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        started, session_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(started), uuid.UUID(session_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as error:
        raise ValidationFailed(
            "Invalid cursor.",
            details=[{"field": "cursor", "message": "Use next_cursor from a previous page."}],
        ) from error


class InterviewReportService:
    """Builds reports in a fixed number of queries, whatever the number of answers."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def session(
        self, interview_id: uuid.UUID, session_id: uuid.UUID, *, lock: bool = False
    ) -> InterviewSession:
        """The session — only if it belongs to *this* interview (another interview's session is 404)."""
        query = select(InterviewSession).where(
            InterviewSession.id == session_id, InterviewSession.interview_id == interview_id
        )
        if lock:
            query = query.with_for_update(of=InterviewSession).execution_options(populate_existing=True)
        session = self.db.scalar(query)
        if session is None:
            raise NotFound("Interview session not found.")
        return session

    def items(self, session: InterviewSession, review: InterviewReview | None) -> list[ReportItem]:
        rows = list(
            self.db.scalars(
                select(InterviewSessionItem)
                .where(InterviewSessionItem.session_id == session.id)
                .order_by(InterviewSessionItem.sequence)
            )
        )
        newest: dict[uuid.UUID, InterviewEvaluation] = {}
        for e in self.db.scalars(
            select(InterviewEvaluation)
            .where(InterviewEvaluation.session_id == session.id)
            .order_by(InterviewEvaluation.requested_at, InterviewEvaluation.id)
        ):
            newest[e.item_id] = e
        decisions: dict[str, dict[str, Any]] = {}
        for a in self.db.scalars(
            select(AuditLog)
            .where(
                AuditLog.interview_session_id == session.id,
                AuditLog.action == AuditAction.INTERVIEW_ADAPTIVE_DECISION,
            )
            .order_by(AuditLog.occurred_at, AuditLog.id)
        ):
            decisions[str(a.details.get("answered_item_id"))] = a.details
        marks: dict[uuid.UUID, InterviewReviewMark] = {}
        if review is not None:
            for m in self.db.scalars(
                select(InterviewReviewMark)
                .where(InterviewReviewMark.review_id == review.id)
                .order_by(InterviewReviewMark.created_at, InterviewReviewMark.id)
            ):
                marks[m.item_id] = m  # newest wins
        numbers: dict[uuid.UUID, int] = {}
        out: list[ReportItem] = []
        for item in rows:
            if item.kind is QuestionKind.PRIMARY:
                numbers[item.id] = len(numbers) + 1
            number = numbers.get(item.id) or numbers.get(item.parent_item_id or item.id, 0)
            out.append(
                ReportItem(item, number, newest.get(item.id), decisions.get(str(item.id)), marks.get(item.id))
            )
        return out

    def review_state(self, session: InterviewSession) -> ReviewState:
        review = self.db.scalar(select(InterviewReview).where(InterviewReview.session_id == session.id))
        history = list(
            self.db.scalars(
                select(AuditLog)
                .where(AuditLog.interview_session_id == session.id, AuditLog.action.in_(_REVIEW_ACTIONS))
                .order_by(AuditLog.occurred_at, AuditLog.id)
                .limit(HISTORY_LIMIT)
            )
        )
        if review is None:
            return ReviewState(None, history=history)
        notes = list(
            self.db.scalars(
                select(InterviewReviewNote)
                .where(InterviewReviewNote.review_id == review.id)
                .order_by(InterviewReviewNote.created_at, InterviewReviewNote.id)
            )
        )
        decisions = list(
            self.db.scalars(
                select(InterviewReviewDecision)
                .where(InterviewReviewDecision.review_id == review.id)
                .order_by(InterviewReviewDecision.revision.desc())
            )
        )
        return ReviewState(review, notes, decisions, history)

    def build(self, interview_id: uuid.UUID, session_id: uuid.UUID) -> Report:
        session = self.session(interview_id, session_id)
        candidate = self.db.get(User, session.candidate_id)
        assert candidate is not None
        review = self.review_state(session)
        items = self.items(session, review.review)
        now = utcnow()
        return Report(
            interview=session.interview,
            session=session,
            candidate=candidate,
            items=items,
            summary=summarize(session, items, now),
            topics=topics(items),
            review=review,
            generated_at=now,
        )

    # -- the queue ------------------------------------------------------------------------------------

    def _state_expr(self):  # noqa: ANN202 — a SQL expression
        answered = (
            select(func.count())
            .select_from(InterviewSessionItem)
            .where(
                InterviewSessionItem.session_id == InterviewSession.id,
                InterviewSessionItem.answer_text.is_not(None),
            )
            .scalar_subquery()
        )
        pending = (
            select(func.count())
            .select_from(InterviewEvaluation)
            .where(
                InterviewEvaluation.session_id == InterviewSession.id,
                InterviewEvaluation.status == EvaluationStatus.PENDING,
            )
            .scalar_subquery()
        )
        completed = (
            select(func.count(func.distinct(InterviewEvaluation.item_id)))
            .where(
                InterviewEvaluation.session_id == InterviewSession.id,
                InterviewEvaluation.status == EvaluationStatus.COMPLETED,
            )
            .scalar_subquery()
        )
        state = case(
            (answered == 0, literal("NONE", String)),
            (pending > 0, literal("PENDING", String)),
            (completed >= answered, literal("COMPLETE", String)),
            (completed == 0, literal("NONE", String)),
            else_=literal("PARTIAL", String),
        )
        return state, answered

    def _filtered(self, query: Select, f: QueueFilter, state, *, with_review: bool) -> Select:  # noqa: ANN001
        if f.interview_id is not None:
            query = query.where(InterviewSession.interview_id == f.interview_id)
        if f.session_status is not None:
            query = query.where(InterviewSession.status == f.session_status)
        if f.evaluation_state is not None:
            query = query.where(state == f.evaluation_state)
        if f.finished_from is not None:
            query = query.where(InterviewSession.completed_at >= f.finished_from)
        if f.finished_to is not None:
            query = query.where(InterviewSession.completed_at < f.finished_to)
        if with_review and f.review_status is not None:
            if f.review_status == INTERVIEW_UNREVIEWED:
                query = query.where(InterviewReview.id.is_(None))
            else:
                query = query.where(InterviewReview.status == f.review_status)
        return query

    def queue(
        self, f: QueueFilter, *, limit: int, cursor: str | None
    ) -> tuple[list[QueueRow], dict[str, int], str | None]:
        """Sessions newest first (keyset on `(started_at, id)`), with review status, evaluation state and the
        AI score for the page only. Never ranked or sorted by score."""
        state, answered = self._state_expr()
        query = (
            select(InterviewSession, User, InterviewReview, state.label("state"), answered.label("answered"))
            .join(User, User.id == InterviewSession.candidate_id)
            .outerjoin(InterviewReview, InterviewReview.session_id == InterviewSession.id)
        )
        query = self._filtered(query, f, state, with_review=True)
        if cursor:
            query = query.where(
                tuple_(InterviewSession.started_at, InterviewSession.id) < tuple_(*_decode(cursor))
            )
        query = query.order_by(InterviewSession.started_at.desc(), InterviewSession.id.desc()).limit(
            limit + 1
        )
        rows = self.db.execute(query).all()
        page, more = rows[:limit], len(rows) > limit

        # The page's AI scores in one query (evaluated primary answers, policy 7C-v1).
        ids = [r[0].id for r in page]
        scores: dict[uuid.UUID, list[int]] = defaultdict(list)
        if ids:
            for session_id, score in self.db.execute(
                select(InterviewEvaluation.session_id, InterviewEvaluation.overall_score)
                .join(InterviewSessionItem, InterviewSessionItem.id == InterviewEvaluation.item_id)
                .where(
                    InterviewEvaluation.session_id.in_(ids),
                    InterviewEvaluation.status == EvaluationStatus.COMPLETED,
                    InterviewSessionItem.kind == QuestionKind.PRIMARY,
                )
            ):
                scores[session_id].append(score)

        status = func.coalesce(InterviewReview.status, INTERVIEW_UNREVIEWED, type_=String)
        count_query = (
            select(status, func.count())
            .select_from(InterviewSession)
            .outerjoin(InterviewReview, InterviewReview.session_id == InterviewSession.id)
            .group_by(status)
        )
        counts = {
            str(k): int(v)
            for k, v in self.db.execute(self._filtered(count_query, f, state, with_review=False)).all()
        }
        out = [
            QueueRow(session, user, review, str(st), int(ans), mean_half_up(scores.get(session.id, [])))
            for session, user, review, st, ans in page
        ]
        return (
            out,
            {s: counts.get(s, 0) for s in (INTERVIEW_UNREVIEWED, "IN_REVIEW", "REVIEWED")},
            _encode(page[-1][0]) if more and page else None,
        )

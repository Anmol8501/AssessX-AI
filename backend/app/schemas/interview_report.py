"""Phase 7C — the interview report and its human review (administrators only; nothing here is served to
candidates, and there is no candidate-facing report).

Provenance is explicit in the shapes: AI material is under `summary` / each question's `evaluation`
(labelled AI-generated), human material under `review` (`authored_by: "HUMAN"`). Requests are strict: a
body naming a reviewer, status, score, candidate, version or time is rejected — the server derives them.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.interview import (
    CompletionReason,
    InterviewDifficulty,
    InterviewQuestionType,
    InterviewType,
    ItemState,
    QuestionKind,
)
from app.models.interview_evaluation import EvaluationStatus
from app.models.interview_review import AnswerMark, InterviewReviewOutcome
from app.schemas.interview import EvaluationOut
from app.schemas.review import HistoryEntry, Person
from app.services.interview.report import AI_NOTE, REPORT_POLICY_VERSION, Report, ReportItem, TopicSummary
from app.services.interview.report import QueueRow as QueueRowData

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
AnswerState = Literal["NOT_ANSWERED", "EVALUATION_PENDING", "ANSWERED_NOT_EVALUATED", "EVALUATED"]

OUTCOME_DESCRIPTIONS: dict[InterviewReviewOutcome, str] = {
    InterviewReviewOutcome.MEETS_EXPECTATIONS: (
        "In the reviewer's judgement, the interview meets the expectations set for it."
    ),
    InterviewReviewOutcome.NEEDS_FURTHER_ASSESSMENT: (
        "The reviewer wants further assessment before reaching a view."
    ),
    InterviewReviewOutcome.DOES_NOT_MEET_EXPECTATIONS: (
        "In the reviewer's judgement, the interview does not meet the expectations set for it."
    ),
    InterviewReviewOutcome.INCONCLUSIVE: (
        "The session does not represent the candidate fairly (for example technical problems or an abandoned "
        "interview)."
    ),
}
REVIEW_NOTE = (
    "Human administrative interpretation, written by a reviewer. It is not an AI decision, and the AI "
    "evaluation does not determine it."
)
PROCTORING_NOTE = (
    "Not applicable: interviews are not proctored in this build. Proctoring risk is never combined with "
    "interview results."
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReviewNoteCreate(_Strict):
    body: Text


class AnswerMarkSet(_Strict):
    mark: AnswerMark


class ReviewDecisionCreate(_Strict):
    outcome: InterviewReviewOutcome
    rationale: Text
    expected_version: int = Field(ge=1)


# -- the report -----------------------------------------------------------------------------------------


class ReportCandidate(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    roll_number: str | None


class ReportInterview(BaseModel):
    id: uuid.UUID
    title: str
    interview_type: InterviewType
    difficulty: InterviewDifficulty
    adaptive_difficulty: bool
    min_difficulty: InterviewDifficulty
    starting_difficulty: InterviewDifficulty
    topics: list[str]
    duration_minutes: int
    question_count: int
    follow_ups_enabled: bool
    max_follow_ups: int


class ReportSession(BaseModel):
    id: uuid.UUID
    status: str
    completion_reason: CompletionReason | None
    started_at: datetime
    expires_at: datetime
    completed_at: datetime | None
    current_difficulty: InterviewDifficulty
    difficulty_changes: int


class ReportSummary(BaseModel):
    """Completion figures (not scores) and the AI-generated assessment summary (a signal)."""

    planned_primaries: int
    primaries_asked: int
    answered_primaries: int
    follow_ups_asked: int
    follow_ups_answered: int
    answered_total: int
    completion_percent: int
    duration_seconds: int
    evaluation_state: Literal["NONE", "PENDING", "PARTIAL", "COMPLETE"]
    evaluated_primaries: int
    evaluated_total: int
    ai_score: int | None
    ai_score_partial: bool
    dimension_means: dict[str, dict[str, float]]
    evaluator_versions: list[str]
    rubric_versions: list[str]
    models: list[str]
    report_policy_version: str = REPORT_POLICY_VERSION
    source: Literal["AI"] = "AI"
    note: str = AI_NOTE


class ReportTopic(BaseModel):
    topic: str
    asked: int
    answered: int
    evaluated: int
    ai_score: int | None
    common_missing: list[tuple[str, int]]

    @classmethod
    def of(cls, t: TopicSummary) -> "ReportTopic":
        return cls(**vars(t))


class ReviewMarkOut(BaseModel):
    mark: AnswerMark
    marked_by: Person
    marked_at: datetime
    authored_by: Literal["HUMAN"] = "HUMAN"


class ReportQuestion(BaseModel):
    item_id: uuid.UUID
    sequence: int
    kind: QuestionKind
    number: int
    question_text: str
    context: str | None
    topic: str
    difficulty: InterviewDifficulty
    question_type: InterviewQuestionType
    expected_concepts: list[str]
    competency: str | None
    selected_by: str
    presented_at: datetime
    answered_at: datetime | None
    answer_text: str | None
    answer_state: AnswerState
    evaluation: EvaluationOut | None
    review_mark: ReviewMarkOut | None


class TimelineDecision(BaseModel):
    """The adaptive policy's recorded decision after an answer — reason codes, not AI reasoning."""

    follow_up: bool
    difficulty_change: int
    difficulty: str
    reason: str
    policy_version: str


class TimelineEntry(BaseModel):
    sequence: int
    kind: QuestionKind
    number: int
    topic: str
    difficulty: InterviewDifficulty
    selected_by: str
    answer_state: AnswerState
    ai_score: int | None
    decision: TimelineDecision | None


class DecisionBasisOut(BaseModel):
    report_policy_version: str
    ai_score: int | None
    ai_score_partial: bool
    evaluation_state: str
    evaluated_primaries: int
    answered_primaries: int
    planned_primaries: int
    evaluator_versions: list[str]
    rubric_versions: list[str]


class ReviewDecisionOut(BaseModel):
    revision: int
    outcome: InterviewReviewOutcome
    outcome_description: str
    rationale: str
    decided_by: Person
    decided_at: datetime
    basis: DecisionBasisOut
    authored_by: Literal["HUMAN"] = "HUMAN"


class ReviewNoteOut(BaseModel):
    note_id: uuid.UUID
    author: Person
    body: str
    created_at: datetime
    authored_by: Literal["HUMAN"] = "HUMAN"


class OutcomeOption(BaseModel):
    outcome: InterviewReviewOutcome
    description: str


class ReportReview(BaseModel):
    status: Literal["UNREVIEWED", "IN_REVIEW", "REVIEWED"]
    version: int | None
    outcome: InterviewReviewOutcome | None
    started_by: Person | None
    started_at: datetime | None
    completed_by: Person | None
    completed_at: datetime | None
    #: Why an outcome cannot be recorded yet (None when it can).
    blocked_reason: Literal["INTERVIEW_IN_PROGRESS", "EVALUATIONS_PENDING"] | None
    notes: list[ReviewNoteOut]
    decisions: list[ReviewDecisionOut]
    history: list[HistoryEntry]
    outcome_options: list[OutcomeOption]
    authored_by: Literal["HUMAN"] = "HUMAN"
    note: str = REVIEW_NOTE


class ReportProctoring(BaseModel):
    applicable: bool = False
    note: str = PROCTORING_NOTE


class InterviewReportOut(BaseModel):
    generated_at: datetime
    report_policy_version: str = REPORT_POLICY_VERSION
    candidate: ReportCandidate
    interview: ReportInterview
    session: ReportSession
    summary: ReportSummary
    topics: list[ReportTopic]
    questions: list[ReportQuestion]
    timeline: list[TimelineEntry]
    review: ReportReview
    proctoring: ReportProctoring = ReportProctoring()

    @classmethod
    def of(cls, r: Report) -> "InterviewReportOut":
        questions = [_question(i) for i in r.items]
        review = r.review.review
        blocked: Literal["INTERVIEW_IN_PROGRESS", "EVALUATIONS_PENDING"] | None = None
        if r.session.status.value != "COMPLETED":
            blocked = "INTERVIEW_IN_PROGRESS"
        elif r.summary.evaluation_state == "PENDING":
            blocked = "EVALUATIONS_PENDING"
        s, i = r.session, r.interview
        return cls(
            generated_at=r.generated_at,
            candidate=ReportCandidate(
                id=r.candidate.id,
                name=r.candidate.name,
                email=r.candidate.email,
                roll_number=r.candidate.roll_number,
            ),
            interview=ReportInterview(
                id=i.id,
                title=i.title,
                interview_type=i.interview_type,
                difficulty=i.difficulty,
                adaptive_difficulty=i.adaptive_difficulty,
                min_difficulty=i.min_difficulty,
                starting_difficulty=i.starting_difficulty,
                topics=i.topics,
                duration_minutes=i.duration_minutes,
                question_count=i.question_count,
                follow_ups_enabled=i.follow_ups_enabled,
                max_follow_ups=i.max_follow_ups,
            ),
            session=ReportSession(
                id=s.id,
                status=s.status.value,
                completion_reason=s.completion_reason,
                started_at=s.started_at,
                expires_at=s.expires_at,
                completed_at=s.completed_at,
                current_difficulty=s.current_difficulty,
                difficulty_changes=s.difficulty_changes,
            ),
            summary=ReportSummary(**vars(r.summary)),
            topics=[ReportTopic.of(t) for t in r.topics],
            questions=questions,
            timeline=[
                TimelineEntry(
                    sequence=q.sequence,
                    kind=q.kind,
                    number=q.number,
                    topic=q.topic,
                    difficulty=q.difficulty,
                    selected_by=q.selected_by,
                    answer_state=q.answer_state,
                    ai_score=q.evaluation.overall_score if q.evaluation else None,
                    decision=_decision(item.decision),
                )
                for q, item in zip(questions, r.items, strict=True)
            ],
            review=ReportReview(
                status=review.status.value if review else "UNREVIEWED",
                version=review.version if review else None,
                outcome=review.outcome if review else None,
                started_by=Person.of(review.started_by) if review else None,
                started_at=review.started_at if review else None,
                completed_by=Person.of(review.completed_by) if review else None,
                completed_at=review.completed_at if review else None,
                blocked_reason=blocked,
                notes=[
                    ReviewNoteOut(
                        note_id=n.id, author=Person.of(n.author), body=n.body, created_at=n.created_at
                    )
                    for n in r.review.notes
                ],
                decisions=[
                    ReviewDecisionOut(
                        revision=d.revision,
                        outcome=d.outcome,
                        outcome_description=OUTCOME_DESCRIPTIONS[d.outcome],
                        rationale=d.rationale,
                        decided_by=Person.of(d.decided_by),
                        decided_at=d.decided_at,
                        basis=DecisionBasisOut(
                            report_policy_version=d.report_policy_version,
                            ai_score=d.ai_score,
                            ai_score_partial=d.ai_score_partial,
                            evaluation_state=d.evaluation_state,
                            evaluated_primaries=d.evaluated_primaries,
                            answered_primaries=d.answered_primaries,
                            planned_primaries=d.planned_primaries,
                            evaluator_versions=d.evaluator_versions,
                            rubric_versions=d.rubric_versions,
                        ),
                    )
                    for d in r.review.decisions
                ],
                history=[HistoryEntry.of(h) for h in r.review.history],
                outcome_options=[
                    OutcomeOption(outcome=o, description=t) for o, t in OUTCOME_DESCRIPTIONS.items()
                ],
            ),
        )


def _answer_state(r: ReportItem) -> AnswerState:
    if r.item.state is not ItemState.ANSWERED:
        return "NOT_ANSWERED"
    if r.evaluation is None:
        return "ANSWERED_NOT_EVALUATED"
    if r.evaluation.status is EvaluationStatus.COMPLETED:
        return "EVALUATED"
    if r.evaluation.status is EvaluationStatus.PENDING:
        return "EVALUATION_PENDING"
    return "ANSWERED_NOT_EVALUATED"


def _question(r: ReportItem) -> ReportQuestion:
    q = r.item.question
    return ReportQuestion(
        item_id=r.item.id,
        sequence=r.item.sequence,
        kind=r.item.kind,
        number=r.number,
        question_text=q.text,
        context=q.context,
        topic=q.topic,
        difficulty=q.difficulty,
        question_type=q.question_type,
        expected_concepts=q.expected_concepts,
        competency=q.competency,
        selected_by=r.item.selected_by.value,
        presented_at=r.item.presented_at,
        answered_at=r.item.answered_at,
        answer_text=r.item.answer_text,
        answer_state=_answer_state(r),
        evaluation=EvaluationOut.of(r.evaluation) if r.evaluation else None,
        review_mark=(
            ReviewMarkOut(mark=r.mark.mark, marked_by=Person.of(r.mark.author), marked_at=r.mark.created_at)
            if r.mark
            else None
        ),
    )


def _decision(details: dict | None) -> TimelineDecision | None:
    if not details:
        return None
    return TimelineDecision(
        follow_up=bool(details.get("follow_up")),
        difficulty_change=int(details.get("difficulty_change") or 0),
        difficulty=str(details.get("difficulty") or ""),
        reason=str(details.get("reason") or ""),
        policy_version=str(details.get("policy_version") or ""),
    )


# -- the queue ------------------------------------------------------------------------------------------


class ReportQueueRow(BaseModel):
    session_id: uuid.UUID
    interview_id: uuid.UUID
    interview_title: str
    candidate_name: str
    candidate_roll_number: str | None
    session_status: str
    completion_reason: CompletionReason | None
    started_at: datetime
    completed_at: datetime | None
    answered: int
    evaluation_state: str
    #: AI-generated assessment signal (evaluated primary answers). Never used for ordering.
    ai_score: int | None
    review_status: str
    review_outcome: InterviewReviewOutcome | None
    reviewed_by: Person | None
    reviewed_at: datetime | None

    @classmethod
    def of(cls, row: QueueRowData) -> "ReportQueueRow":
        s, review = row.session, row.review
        return cls(
            session_id=s.id,
            interview_id=s.interview_id,
            interview_title=s.interview.title,
            candidate_name=row.candidate.name,
            candidate_roll_number=row.candidate.roll_number,
            session_status=s.status.value,
            completion_reason=s.completion_reason,
            started_at=s.started_at,
            completed_at=s.completed_at,
            answered=row.answered,
            evaluation_state=row.evaluation_state,
            ai_score=row.ai_score,
            review_status=review.status.value if review else "UNREVIEWED",
            review_outcome=review.outcome if review else None,
            reviewed_by=Person.of(review.completed_by) if review else None,
            reviewed_at=review.completed_at if review else None,
        )


class ReportQueueOut(BaseModel):
    counts: dict[str, int]
    items: list[ReportQueueRow]
    next_cursor: str | None
    note: str = "Sorted by start time, newest first. Interviews are never ranked by score."

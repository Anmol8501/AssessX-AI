"""Phase 7A interview shapes.

**Two audiences, two sets of shapes.** Admin shapes carry every question field, including the
evaluation metadata (`expected_concepts`, `competency`) that Phase 7B will use. Candidate shapes are
separate classes that simply do not have those fields — not the same class with fields blanked — so
the metadata cannot leak by accident. Requests are strict (`extra="forbid"`): a body naming a status,
a candidate, a session state, a score or a time is rejected; the server derives all of those.
"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.interview import (
    CompletionReason,
    InterviewDifficulty,
    InterviewFormat,
    InterviewQuestionType,
    InterviewStatus,
    InterviewType,
    QuestionKind,
)
from app.models.interview_evaluation import InterviewEvaluation
from app.services.interview import policy

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=policy.MAX_CONTEXT)]
QuestionText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=policy.MAX_QUESTION_TEXT)
]
Topic = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=policy.MAX_TOPIC_LENGTH)
]
Concept = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=policy.MAX_CONCEPT_LENGTH)
]
Answer = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=policy.MAX_ANSWER)]


def _unique(values: list[str]) -> list[str]:
    """De-duplicate case-insensitively, keeping the first spelling and the order."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value.lower() not in seen:
            seen.add(value.lower())
            out.append(value)
    return out


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# -- admin requests ---------------------------------------------------------------------------------


class InterviewCreate(_Strict):
    title: Title
    description: LongText | None = None
    instructions: LongText | None = None
    interview_type: InterviewType
    #: Phase 7D. AI: the server-run text interview. LIVE: a video call with a human interviewer.
    format: InterviewFormat = InterviewFormat.AI
    difficulty: InterviewDifficulty
    topics: list[Topic] = Field(default_factory=list, max_length=policy.MAX_TOPICS)
    duration_minutes: int = Field(ge=5, le=180)
    question_count: int = Field(ge=1, le=30)
    follow_ups_enabled: bool = False
    max_follow_ups: int = Field(default=0, ge=0, le=30)
    #: Phase 7B. `difficulty` is the maximum; min ≤ starting ≤ difficulty (checked by the service).
    adaptive_difficulty: bool = False
    min_difficulty: InterviewDifficulty = InterviewDifficulty.EASY
    #: Defaults to `difficulty` when omitted.
    starting_difficulty: InterviewDifficulty | None = None

    @field_validator("topics")
    @classmethod
    def dedupe_topics(cls, value: list[str]) -> list[str]:
        return _unique(value)


class InterviewUpdate(_Strict):
    title: Title | None = None
    description: LongText | None = None
    instructions: LongText | None = None
    interview_type: InterviewType | None = None
    format: InterviewFormat | None = None
    difficulty: InterviewDifficulty | None = None
    topics: list[Topic] | None = Field(default=None, max_length=policy.MAX_TOPICS)
    duration_minutes: int | None = Field(default=None, ge=5, le=180)
    question_count: int | None = Field(default=None, ge=1, le=30)
    follow_ups_enabled: bool | None = None
    max_follow_ups: int | None = Field(default=None, ge=0, le=30)
    adaptive_difficulty: bool | None = None
    min_difficulty: InterviewDifficulty | None = None
    starting_difficulty: InterviewDifficulty | None = None

    @field_validator("topics")
    @classmethod
    def dedupe_topics(cls, value: list[str] | None) -> list[str] | None:
        return _unique(value) if value is not None else value


class QuestionCreate(_Strict):
    text: QuestionText
    question_type: InterviewQuestionType
    topic: Topic
    difficulty: InterviewDifficulty
    expected_concepts: list[Concept] = Field(default_factory=list, max_length=policy.MAX_CONCEPTS)
    competency: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    context: LongText | None = None
    time_limit_seconds: int | None = Field(default=None, ge=10, le=3600)
    is_active: bool = True

    @field_validator("expected_concepts")
    @classmethod
    def dedupe_concepts(cls, value: list[str]) -> list[str]:
        return _unique(value)


class QuestionUpdate(_Strict):
    text: QuestionText | None = None
    question_type: InterviewQuestionType | None = None
    topic: Topic | None = None
    difficulty: InterviewDifficulty | None = None
    expected_concepts: list[Concept] | None = Field(default=None, max_length=policy.MAX_CONCEPTS)
    competency: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    context: LongText | None = None
    time_limit_seconds: int | None = Field(default=None, ge=10, le=3600)
    is_active: bool | None = None

    @field_validator("expected_concepts")
    @classmethod
    def dedupe_concepts(cls, value: list[str] | None) -> list[str] | None:
        return _unique(value) if value is not None else value


class FollowUpCreate(_Strict):
    """A follow-up inherits its primary's topic, difficulty and type."""

    text: QuestionText
    expected_concepts: list[Concept] = Field(default_factory=list, max_length=policy.MAX_CONCEPTS)
    time_limit_seconds: int | None = Field(default=None, ge=10, le=3600)
    is_active: bool = True

    @field_validator("expected_concepts")
    @classmethod
    def dedupe_concepts(cls, value: list[str]) -> list[str]:
        return _unique(value)


class QuestionReorder(_Strict):
    #: Every primary question id, in the new order.
    question_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class InterviewAssign(_Strict):
    candidate_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


# -- admin responses --------------------------------------------------------------------------------


class InterviewQuestionAdmin(BaseModel):
    """Every field, for the administrator — including the evaluation metadata."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: QuestionKind
    parent_question_id: uuid.UUID | None
    text: str
    question_type: InterviewQuestionType
    topic: str
    difficulty: InterviewDifficulty
    expected_concepts: list[str]
    competency: str | None
    context: str | None
    time_limit_seconds: int | None
    position: int
    is_active: bool


class ReadinessIssue(BaseModel):
    field: str
    message: str


class InterviewSummary(BaseModel):
    id: uuid.UUID
    title: str
    interview_type: InterviewType
    format: InterviewFormat
    difficulty: InterviewDifficulty
    status: InterviewStatus
    duration_minutes: int
    question_count: int
    primary_question_count: int
    assignment_count: int
    created_at: datetime
    published_at: datetime | None


class InterviewDetail(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    instructions: str | None
    interview_type: InterviewType
    format: InterviewFormat
    difficulty: InterviewDifficulty
    topics: list[str]
    duration_minutes: int
    question_count: int
    follow_ups_enabled: bool
    max_follow_ups: int
    adaptive_difficulty: bool
    min_difficulty: InterviewDifficulty
    starting_difficulty: InterviewDifficulty
    status: InterviewStatus
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None
    questions: list[InterviewQuestionAdmin]
    #: How many primary questions a session could draw from under the current configuration.
    eligible_question_count: int
    #: Why it cannot be published yet. Empty when it can.
    issues: list[ReadinessIssue]


class AssignmentRow(BaseModel):
    """One assigned candidate and how far they have got — never their answers (Phase 7C)."""

    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    candidate_roll_number: str | None
    assigned_at: datetime
    #: For opening the session's report (Phase 7C). None until the candidate starts.
    session_id: uuid.UUID | None = None
    #: Phase 7D: the live call currently open with this candidate, if any.
    open_call_id: uuid.UUID | None = None
    session_status: str  # NOT_STARTED | ACTIVE | COMPLETED
    completion_reason: CompletionReason | None
    started_at: datetime | None
    completed_at: datetime | None
    primary_answered: int
    primary_total: int
    follow_ups_answered: int


class AssignResult(BaseModel):
    assigned: list[uuid.UUID]
    already_assigned: list[uuid.UUID]


# -- candidate --------------------------------------------------------------------------------------


class AnswerSubmit(_Strict):
    """The answer to the question currently shown — identified by the item the server presented, so
    an answer can never be filed against a question the session has not reached or has moved past."""

    item_id: uuid.UUID
    answer_text: Answer


class MyInterview(BaseModel):
    interview_id: uuid.UUID
    title: str
    description: str | None
    interview_type: InterviewType
    format: InterviewFormat
    difficulty: InterviewDifficulty
    duration_minutes: int
    question_count: int
    #: LIVE interviews: the call the interviewer has open now, to join.
    open_call_id: uuid.UUID | None = None
    session_id: uuid.UUID | None
    session_status: str  # NOT_STARTED | ACTIVE | COMPLETED
    completion_reason: CompletionReason | None


class CandidateInterviewDetail(MyInterview):
    instructions: str | None
    topics: list[str]
    follow_ups_enabled: bool


class CandidateQuestion(BaseModel):
    """The current question, as the candidate sees it. No evaluation metadata, no bank ids."""

    item_id: uuid.UUID
    kind: QuestionKind
    #: Primary question number (a follow-up shares its primary's number).
    number: int
    text: str
    context: str | None
    topic: str
    difficulty: InterviewDifficulty
    question_type: InterviewQuestionType
    #: Advisory only; the interview deadline is what the server enforces.
    time_limit_seconds: int | None
    presented_at: datetime


class InterviewProgress(BaseModel):
    primary_total: int
    primary_answered: int
    follow_ups_answered: int


class SessionState(BaseModel):
    """The authoritative state of the candidate's session — what a refresh or reconnect reads."""

    session_id: uuid.UUID
    interview_id: uuid.UUID
    interview_title: str
    status: str  # ACTIVE | COMPLETED
    completion_reason: CompletionReason | None
    server_time: datetime
    started_at: datetime
    expires_at: datetime
    completed_at: datetime | None
    remaining_seconds: int
    progress: InterviewProgress
    current: CandidateQuestion | None
    #: The last answer is being processed; the next question will follow. No score is ever included.
    processing: bool = False


# -- admin: evaluations (Phase 7B) ------------------------------------------------------------------


class EvaluationOut(BaseModel):
    """A validated AI evaluation — an assessment signal for a human, not a decision. Never the raw model
    output, the prompt or any reasoning trace (none is stored)."""

    status: str
    failure_reason: str | None
    overall_score: int | None
    dimension_scores: dict[str, int] | None
    confidence: float | None
    present_concepts: list[str]
    missing_concepts: list[str]
    incorrect_points: list[str]
    strengths: list[str]
    evidence_quotes: list[str]
    feedback: str | None
    flags: list[str]
    provider: str
    model: str
    evaluator_version: str
    rubric_version: str
    prompt_version: str
    requested_at: datetime
    completed_at: datetime | None

    @classmethod
    def of(cls, e: InterviewEvaluation) -> "EvaluationOut":
        return cls(
            status=e.status.value,
            failure_reason=e.failure_reason.value if e.failure_reason else None,
            overall_score=e.overall_score,
            dimension_scores=e.dimension_scores,
            confidence=float(e.confidence) if e.confidence is not None else None,
            present_concepts=e.present_concepts,
            missing_concepts=e.missing_concepts,
            incorrect_points=e.incorrect_points,
            strengths=e.strengths,
            evidence_quotes=e.evidence_quotes,
            feedback=e.feedback,
            flags=e.flags,
            provider=e.provider,
            model=e.model,
            evaluator_version=e.evaluator_version,
            rubric_version=e.rubric_version,
            prompt_version=e.prompt_version,
            requested_at=e.requested_at,
            completed_at=e.completed_at,
        )


class EvaluatedAnswer(BaseModel):
    sequence: int
    kind: QuestionKind
    number: int
    question_text: str
    topic: str
    difficulty: InterviewDifficulty
    selected_by: str
    answer_text: str | None
    answered_at: datetime | None
    evaluation: EvaluationOut | None


class SessionEvaluations(BaseModel):
    candidate_id: uuid.UUID
    session_status: str
    completion_reason: CompletionReason | None
    current_difficulty: InterviewDifficulty
    difficulty_changes: int
    answers: list[EvaluatedAnswer]
    note: str = (
        "AI evaluation is an assessment signal and does not make hiring decisions. Scores are provisional "
        "and must be reviewed by a person."
    )

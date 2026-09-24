"""Candidate-facing exam shapes (Phase 3A).

Every model here is sent to a candidate, so none of them carries an answer key. `is_correct` and
`explanation` exist on the admin shapes in `app/schemas/question.py` and must never be added to
`CandidateQuestionOption` / `CandidateQuestion` (OQ-17): a Tauri WebView client can read anything
the server sends it, so the boundary is here, not in the UI.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.assessment import QuestionNavigation
from app.models.attempt import AttemptStatus
from app.models.question import QuestionType
from app.schemas.assignment import MyAssessment

#: A generous ceiling on one question's selections; the per-question rules are stricter still.
MAX_SELECTED_OPTIONS = 10


class CandidateQuestionOption(BaseModel):
    """An option as the candidate sees it. No `is_correct`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    position: int


class CandidateQuestion(BaseModel):
    """A question as the candidate sees it. No answer key and no `explanation` — the explanation
    is the worked solution, so it waits for Phase 3C's results screen."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: QuestionType
    text: str
    marks: int
    position: int
    options: list[CandidateQuestionOption]


class AttemptAnswerOut(BaseModel):
    """What the candidate has recorded for one question. `selected_option_ids` is empty when an
    answer was given and then cleared."""

    question_id: uuid.UUID
    selected_option_ids: list[uuid.UUID]
    updated_at: datetime


class AttemptSession(BaseModel):
    """The authoritative clock for one attempt, and nothing else.

    This is what the countdown resynchronises against, so it is deliberately small: no questions,
    no answers, just the timing the server will actually enforce. `server_time` is included so the
    client can measure its own clock's offset once and then count down locally without ever
    trusting the local clock's absolute value — a candidate who winds their system clock forward
    or back changes only their own display.

    `remaining_seconds` is the server's own arithmetic, provided so the two can never disagree
    about the answer even if they disagree about the question.
    """

    attempt_id: uuid.UUID
    status: AttemptStatus
    started_at: datetime
    expires_at: datetime
    submitted_at: datetime | None
    finalized_at: datetime | None
    server_time: datetime
    remaining_seconds: int


class AttemptDetail(BaseModel):
    """An attempt, with everything the exam screen needs to render, resume and time.

    The timing fields are the same values `AttemptSession` carries, so opening the exam needs one
    request rather than two. `duration_minutes` remains informational; `expires_at` is what is
    enforced.
    """

    id: uuid.UUID
    assessment_id: uuid.UUID
    assignment_id: uuid.UUID
    attempt_number: int
    max_attempts: int
    status: AttemptStatus
    started_at: datetime
    expires_at: datetime
    submitted_at: datetime | None
    finalized_at: datetime | None
    server_time: datetime
    remaining_seconds: int

    title: str
    instructions: str | None
    duration_minutes: int
    total_marks: int
    question_navigation: QuestionNavigation

    questions: list[CandidateQuestion]
    answers: list[AttemptAnswerOut]


class ExamDetail(MyAssessment):
    """The exam details screen: the My Exams card plus everything about starting it.

    The server decides whether the exam can be started and says why not, so the button state is
    the backend's answer rather than the client's guess.
    """

    attempts_used: int
    can_start: bool
    #: Human-readable reason the exam cannot be started; `None` when it can.
    start_blocked_reason: str | None
    #: The newest attempt, whatever its state — how the finished screen is reached after a
    #: submission or an expiry, when there is no longer an active attempt to resume.
    #: Its status is inherited from `MyAssessment.latest_attempt_status`.
    latest_attempt_id: uuid.UUID | None


class SaveAnswer(BaseModel):
    """A whole selection, replacing whatever was stored. An empty list clears the answer.

    Which selections are allowed depends on the question type and is checked server-side against
    that question's own options — see `app/services/attempts.py`.
    """

    selected_option_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_SELECTED_OPTIONS)

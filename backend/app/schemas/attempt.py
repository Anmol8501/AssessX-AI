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
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.question import QuestionType
from app.schemas.assignment import MyAssessment
from app.schemas.proctoring import ProctoringSessionOut

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


class CodingProgressRow(BaseModel):
    question_id: uuid.UUID
    status: str
    submissions: int
    best_passed: int | None
    total: int | None


class AttemptControl(BaseModel):
    """Exam control for one attempt: the tab-switch count against the rule, and whether it is on hold.

    The same shape is pushed live to the candidate's app (`ATTEMPT_CONTROL`) and returned with the
    attempt and its clock, so a reload or a missed push still shows the right state. The
    administrator's note is never part of it.
    """

    tab_switches: int
    #: The switch that reaches this count puts the attempt on hold; the ones before it are warnings.
    tab_switch_limit: int
    on_hold: bool
    hold_reason: str | None
    held_at: datetime | None
    #: The exam was ended by an administrator (the answers saved so far were submitted).
    ended_by_admin: bool

    @classmethod
    def of(cls, attempt: AssessmentAttempt) -> "AttemptControl":
        from app.services.attempt_control import TAB_SWITCH_LIMIT

        return cls(
            tab_switches=attempt.tab_switch_count or 0,
            tab_switch_limit=TAB_SWITCH_LIMIT,
            on_hold=attempt.is_on_hold,
            hold_reason=attempt.hold_reason.value if attempt.is_on_hold and attempt.hold_reason else None,
            held_at=attempt.held_at if attempt.is_on_hold else None,
            ended_by_admin=attempt.ended_by_id is not None,
        )


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
    #: Exam control — also how the app notices a hold or release if a live push was missed.
    control: AttemptControl | None = None


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

    #: The attempt's proctoring session (Phase 4A), or `None` when this attempt is not proctored.
    #: Per attempt rather than per assessment: it reflects the setting at the moment the attempt
    #: started, so a later change to the assessment does not change a running exam.
    proctoring: ProctoringSessionOut | None
    #: MCQ only, coding only, or mixed — what the exam screen labels questions as.
    assessment_type: str = "MCQ"
    #: Coding questions' progress (empty for an MCQ-only assessment).
    coding: list[CodingProgressRow] = []
    #: Copy and paste are allowed inside the code editor (an assessment setting; elsewhere they stay
    #: restricted in a proctored exam).
    coding_allow_paste: bool = False
    #: Exam control: tab switches and whether the attempt is on hold (frozen).
    control: AttemptControl | None = None


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

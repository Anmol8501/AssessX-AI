import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models.assessment import AssessmentStatus, QuestionNavigation
from app.schemas.question import QuestionOut

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]

MAX_DURATION_MINUTES = 24 * 60
MAX_MARKS = 10_000
MAX_ATTEMPTS = 100


class AssessmentSettings(BaseModel):
    """Exam configuration. Phase 2B stores and validates it; the exam runtime honours it later."""

    max_attempts: int = Field(default=1, gt=0, le=MAX_ATTEMPTS)
    randomize_questions: bool = False
    randomize_options: bool = False
    show_results: bool = False
    question_navigation: QuestionNavigation = QuestionNavigation.FREE
    #: Phase 4A: candidates must pass a camera/microphone check and sit the exam under a
    #: proctoring session. Deliberately one switch — the detailed secure-exam configuration
    #: (fullscreen, shortcuts, clipboard) belongs to Phase 4B.
    proctoring_required: bool = False
    availability_start: datetime | None = None
    availability_end: datetime | None = None

    @model_validator(mode="after")
    def _availability_order(self) -> "AssessmentSettings":
        if (
            self.availability_start
            and self.availability_end
            and self.availability_end <= self.availability_start
        ):
            raise ValueError("Availability end must be after availability start.")
        return self


class AssessmentCreate(BaseModel):
    title: Title
    description: LongText | None = None
    instructions: LongText | None = None
    duration_minutes: int = Field(gt=0, le=MAX_DURATION_MINUTES, description="Exam duration in minutes")
    total_marks: int = Field(gt=0, le=MAX_MARKS)
    passing_marks: int = Field(ge=0, le=MAX_MARKS)

    @model_validator(mode="after")
    def _passing_within_total(self) -> "AssessmentCreate":
        if self.passing_marks > self.total_marks:
            raise ValueError("Passing marks cannot exceed total marks.")
        return self


class AssessmentUpdate(BaseModel):
    """Every field optional: a PATCH changes only what it sends. Basic information and settings
    share this shape so the builder's sections can save independently."""

    title: Title | None = None
    description: LongText | None = None
    instructions: LongText | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=MAX_DURATION_MINUTES)
    total_marks: int | None = Field(default=None, gt=0, le=MAX_MARKS)
    passing_marks: int | None = Field(default=None, ge=0, le=MAX_MARKS)

    max_attempts: int | None = Field(default=None, gt=0, le=MAX_ATTEMPTS)
    randomize_questions: bool | None = None
    randomize_options: bool | None = None
    show_results: bool | None = None
    question_navigation: QuestionNavigation | None = None
    proctoring_required: bool | None = None
    availability_start: datetime | None = None
    availability_end: datetime | None = None


class ReadinessIssue(BaseModel):
    """One reason an assessment cannot be marked READY. `field` lets the UI point at the section."""

    field: str
    message: str


class ReadinessReport(BaseModel):
    is_ready: bool
    issues: list[ReadinessIssue]


class AssessmentSummary(BaseModel):
    """List row: no questions, but the counts an admin needs to see at a glance."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    status: AssessmentStatus
    duration_minutes: int
    total_marks: int
    passing_marks: int
    question_count: int
    allocated_marks: int
    assignment_count: int
    created_at: datetime
    updated_at: datetime


class AssessmentDetail(AssessmentSummary):
    """Detail view: the assessment, its settings, its questions in order, and why it is (not) ready."""

    instructions: str | None
    settings: AssessmentSettings
    questions: list[QuestionOut]
    readiness: ReadinessReport


class ReorderQuestions(BaseModel):
    """The assessment's questions in their new order — every id exactly once."""

    question_ids: list[uuid.UUID] = Field(min_length=1)

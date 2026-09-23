import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.assessment import AssessmentStatus
from app.models.assignment import AssignmentStatus
from app.schemas.common import Email

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
RollNumber = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]


class CandidateCreate(BaseModel):
    """Creating a demo candidate. The role is always CANDIDATE — it is never taken from the client.

    A roll number is required because that is how candidates sign in (see migration 0002), and an
    initial password is set by the administrator: this showcase build has no email delivery, so
    there is no invitation or reset flow yet.
    """

    name: Name
    email: Email
    roll_number: RollNumber
    initial_password: str = Field(min_length=8, max_length=128)


class CandidateSummary(BaseModel):
    """A candidate as the admin list shows them, with how many assessments they hold."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    roll_number: str | None
    is_active: bool
    assignment_count: int
    created_at: datetime


class AssignCandidates(BaseModel):
    candidate_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class AssignmentOut(BaseModel):
    """One assignment, as the admin's assignment list shows it."""

    id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    candidate_roll_number: str | None
    status: AssignmentStatus
    assigned_at: datetime


class AssignmentResult(BaseModel):
    """The outcome of an assign call: what was created, and who was already assigned."""

    assigned: list[AssignmentOut]
    already_assigned: list[uuid.UUID]


class MyAssessment(BaseModel):
    """A candidate's view of an assessment assigned to them.

    Deliberately omits questions and answer keys: a candidate sees only what an exam card needs
    until the exam runtime exists (Phase 3).
    """

    assignment_id: uuid.UUID
    assessment_id: uuid.UUID
    title: str
    description: str | None
    instructions: str | None
    duration_minutes: int
    total_marks: int
    passing_marks: int
    question_count: int
    max_attempts: int
    availability_start: datetime | None
    availability_end: datetime | None
    status: AssignmentStatus
    assessment_status: AssessmentStatus
    assigned_at: datetime

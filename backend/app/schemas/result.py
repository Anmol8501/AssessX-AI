"""Result shapes (Phase 3C).

The candidate shapes carry a score and a breakdown of how each question turned out. They do not
carry the answer key — no `is_correct`, no correct option, no explanation — so a candidate can see
*that* question 3 was wrong without being handed the answer. That boundary is the same one
`schemas/attempt.py` holds during the exam, and it does not relax after submission.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.attempt import AttemptStatus
from app.services.evaluation import AnswerOutcome


class QuestionResult(BaseModel):
    """One question's contribution. Identified by its position in the paper, not its id — the
    candidate has no use for the id, and a number they recognise is friendlier."""

    position: int
    marks: int
    marks_awarded: int
    outcome: AnswerOutcome


class ResultSummary(BaseModel):
    """The numbers, without the breakdown. Used for the candidate's results list."""

    attempt_id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_title: str
    attempt_number: int
    attempt_status: AttemptStatus
    score: int
    maximum_score: int
    percentage: Decimal
    passed: bool
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    evaluated_at: datetime
    submitted_at: datetime | None


class CandidateResult(BaseModel):
    """A candidate's own result for one attempt.

    `released` reflects the assessment's `show_results` setting. When it is false the attempt has
    still been evaluated and the administrator can see the score — the candidate simply is not
    shown it, and every numeric field is `None` rather than zero, so a withheld result can never
    be mistaken for a failed one.
    """

    attempt_id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_title: str
    attempt_number: int
    attempt_status: AttemptStatus
    submitted_at: datetime | None
    finalized_at: datetime | None

    released: bool
    score: int | None
    maximum_score: int | None
    percentage: Decimal | None
    passed: bool | None
    correct_count: int | None
    incorrect_count: int | None
    unanswered_count: int | None
    evaluated_at: datetime | None
    questions: list[QuestionResult]


class AdminResult(BaseModel):
    """One candidate's result, as the administrator's table shows it.

    Carries the candidate's identity, which the candidate-facing shapes never do, and the
    threshold the result was judged against so a later change to the assessment is visible rather
    than silent.
    """

    attempt_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    candidate_roll_number: str | None
    attempt_number: int
    attempt_status: AttemptStatus
    score: int
    maximum_score: int
    percentage: Decimal
    passing_marks: int
    passed: bool
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    submitted_at: datetime | None
    evaluated_at: datetime


class AssessmentResults(BaseModel):
    """Every result for one assessment, with the totals an administrator scans first."""

    assessment_id: uuid.UUID
    assessment_title: str
    total_marks: int
    passing_marks: int
    #: How many candidates hold the assessment, whether or not they have finished.
    assigned_count: int
    results: list[AdminResult]

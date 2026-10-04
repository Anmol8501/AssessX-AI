"""Scoring a finished attempt (Phase 3C).

This is the only place in the codebase that reads `question_options.is_correct` alongside a
candidate's answers. Nothing it produces is ever accepted from a request: a client cannot tell the
server what it scored, only what it selected.

The rules are deliberately small, and identical for all three objective types:

* the selected set must equal the correct set — nothing else earns marks;
* an empty selection is *unanswered*, not wrong, and scores zero either way;
* no partial credit and no negative marking.

Coding questions (coding assessments, stage C4) are scored from the candidate's **best** judged
submission: full marks when it was accepted; with partial scoring, the marks times the share of test weight
it passed, rounded down (never over-awarded); otherwise nothing. A coding question with no judged
submission is unanswered. While any submission of the attempt is still being judged, the result waits
(`ensure_result` returns None); the runner's completion finishes it.
"""

import enum
import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.models.attempt import AssessmentAttempt, AttemptAnswer
from app.models.base import utcnow
from app.models.code_execution import CodeExecution, ExecutionKind, ExecutionStatus, Verdict
from app.models.question import Question, QuestionType
from app.models.result import AttemptResult
from app.repositories.attempts import AttemptRepository
from app.repositories.questions import QuestionRepository
from app.repositories.results import ResultRepository

log = logging.getLogger("assessx.evaluation")

#: Percentages are stored to two decimal places: 87.5 stays 87.5, and a boundary is never rounded
#: into a different verdict. Pass/fail is decided on raw marks regardless — see `ensure_result`.
PERCENTAGE_QUANTUM = Decimal("0.01")


class AnswerOutcome(enum.StrEnum):
    """How one question turned out. `UNANSWERED` is kept distinct from `INCORRECT` because the
    candidate is shown the difference and the two mean different things."""

    CORRECT = "CORRECT"
    INCORRECT = "INCORRECT"
    UNANSWERED = "UNANSWERED"
    #: Coding with partial scoring: some marks, not all.
    PARTIAL = "PARTIAL"


@dataclass(frozen=True)
class CodingBest:
    """A coding question's best judged submission — what it is scored from."""

    execution_id: uuid.UUID
    verdict: str
    passed: int
    total: int
    passed_weight: int
    total_weight: int
    language: str


@dataclass(frozen=True)
class QuestionOutcome:
    """One question's contribution to the score. Carries no answer key."""

    question_id: uuid.UUID
    position: int
    marks: int
    marks_awarded: int
    outcome: AnswerOutcome
    #: Coding questions only: the submission the marks came from.
    coding: CodingBest | None = None
    question_type: str = "OBJECTIVE"


@dataclass(frozen=True)
class Scoring:
    """The whole attempt, scored. Pure arithmetic — nothing here touches the database."""

    outcomes: list[QuestionOutcome]
    score: int
    maximum_score: int
    percentage: Decimal
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    partial_count: int = 0
    #: Section totals, None when the attempt has no question of that kind.
    mcq_score: int | None = None
    mcq_maximum: int | None = None
    coding_score: int | None = None
    coding_maximum: int | None = None


def coding_marks(marks: int, partial: bool, best: CodingBest) -> int:
    """Marks for one judged submission. Rounded down, so a candidate is never over-awarded."""
    if best.verdict == "ACCEPTED":
        return marks
    if partial and best.total_weight > 0:
        return (marks * best.passed_weight) // best.total_weight
    return 0


def score_coding(question: Question, submissions: list[CodingBest]) -> QuestionOutcome:
    """Scores a coding question from its best judged submission (ties: the earliest)."""
    partial = bool(question.coding_version and question.coding_version.partial_scoring)
    if not submissions:
        return QuestionOutcome(
            question.id, question.position, question.marks, 0, AnswerOutcome.UNANSWERED, None, "CODING"
        )
    best = max(submissions, key=lambda s: coding_marks(question.marks, partial, s))
    awarded = coding_marks(question.marks, partial, best)
    outcome = (
        AnswerOutcome.CORRECT
        if awarded == question.marks
        else AnswerOutcome.PARTIAL
        if awarded > 0
        else AnswerOutcome.INCORRECT
    )
    return QuestionOutcome(question.id, question.position, question.marks, awarded, outcome, best, "CODING")


def score_question(question: Question, answer: AttemptAnswer | None) -> QuestionOutcome:
    """Scores one question against one stored answer.

    The empty-selection check comes first on purpose. A malformed question with no correct option
    would otherwise compare equal to an empty selection and award full marks for answering
    nothing.
    """
    selected = set(answer.selected_option_ids) if answer is not None else set()
    if not selected:
        return QuestionOutcome(question.id, question.position, question.marks, 0, AnswerOutcome.UNANSWERED)

    correct = {option.id for option in question.options if option.is_correct}
    if correct and selected == correct:
        return QuestionOutcome(
            question.id, question.position, question.marks, question.marks, AnswerOutcome.CORRECT
        )
    return QuestionOutcome(question.id, question.position, question.marks, 0, AnswerOutcome.INCORRECT)


def score_attempt(
    questions: list[Question],
    answers: list[AttemptAnswer],
    coding: dict[uuid.UUID, list[CodingBest]] | None = None,
) -> Scoring:
    """Scores every question of an attempt.

    Driven by the questions, not the answers: a question the candidate never opened has no answer
    row at all and still has to count towards the maximum.
    """
    by_question = {answer.question_id: answer for answer in answers}
    coding = coding or {}
    outcomes = [
        score_coding(question, coding.get(question.id, []))
        if question.type is QuestionType.CODING
        else score_question(question, by_question.get(question.id))
        for question in questions
    ]

    score = sum(outcome.marks_awarded for outcome in outcomes)
    maximum = sum(outcome.marks for outcome in outcomes)
    coding_ids = {q.id for q in questions if q.type is QuestionType.CODING}
    mcq = [o for o in outcomes if o.question_id not in coding_ids]
    code = [o for o in outcomes if o.question_id in coding_ids]
    return Scoring(
        outcomes=outcomes,
        score=score,
        maximum_score=maximum,
        percentage=percentage_of(score, maximum),
        correct_count=sum(o.outcome is AnswerOutcome.CORRECT for o in outcomes),
        incorrect_count=sum(o.outcome is AnswerOutcome.INCORRECT for o in outcomes),
        unanswered_count=sum(o.outcome is AnswerOutcome.UNANSWERED for o in outcomes),
        partial_count=sum(o.outcome is AnswerOutcome.PARTIAL for o in outcomes),
        mcq_score=sum(o.marks_awarded for o in mcq) if mcq else None,
        mcq_maximum=sum(o.marks for o in mcq) if mcq else None,
        coding_score=sum(o.marks_awarded for o in code) if code else None,
        coding_maximum=sum(o.marks for o in code) if code else None,
    )


def percentage_of(score: int, maximum: int) -> Decimal:
    """`score / maximum * 100`, to two decimal places.

    Decimal throughout, and rounded exactly once at the end — rounding intermediates is how a
    percentage ends up disagreeing with the marks it came from. An assessment with no marks
    available scores 0%, rather than dividing by zero.
    """
    if maximum <= 0:
        return Decimal("0.00")
    return (Decimal(score) * 100 / Decimal(maximum)).quantize(PERCENTAGE_QUANTUM, rounding=ROUND_HALF_UP)


class EvaluationService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.results = ResultRepository(db)
        self.questions = QuestionRepository(db)
        self.attempts = AttemptRepository(db)

    #: How long a finished attempt waits for submissions still being judged before they are failed as
    #: system errors (never the candidate's fault) and the result is produced without them.
    EVALUATION_WAIT = timedelta(minutes=10)

    def pending_submissions(self, attempt: AssessmentAttempt) -> list[CodeExecution]:
        return list(
            self.db.scalars(
                select(CodeExecution).where(
                    CodeExecution.attempt_id == attempt.id,
                    CodeExecution.kind == ExecutionKind.SUBMIT,
                    CodeExecution.status.in_((ExecutionStatus.QUEUED, ExecutionStatus.RUNNING)),
                )
            )
        )

    def ensure_result(self, attempt: AssessmentAttempt) -> AttemptResult | None:
        """The attempt's result, evaluating it once if it has not been evaluated yet.

        Idempotent by design and by constraint: an existing result is returned untouched, and a
        concurrent second evaluation loses to `uq_attempt_result_attempt` and re-reads the winner.
        An existing result is never recalculated — see the note on `AttemptResult`.

        Raises `Conflict` for an attempt that is still running. Evaluation is only meaningful once
        the answers can no longer change.
        """
        if not attempt.is_finalized:
            raise Conflict("This attempt has not finished yet, so it has no result.")

        existing = self.results.get_for_attempt(attempt.id)
        if existing is not None:
            return existing

        pending = self.pending_submissions(attempt)
        if pending:
            if attempt.finalized_at and utcnow() - attempt.finalized_at < self.EVALUATION_WAIT:
                return None  # "being evaluated": the runner's completion finishes it
            for execution in pending:
                execution.status = ExecutionStatus.FAILED
                execution.verdict = Verdict.SYSTEM_ERROR
                execution.completed_at = utcnow()
            self.db.flush()

        scoring = self.score(attempt)
        assessment = attempt.assessment
        result = AttemptResult(
            attempt_id=attempt.id,
            candidate_id=attempt.candidate_id,
            assessment_id=attempt.assessment_id,
            score=scoring.score,
            maximum_score=scoring.maximum_score,
            percentage=scoring.percentage,
            passing_marks=assessment.passing_marks,
            # Decided on raw marks, never on the rounded percentage: a candidate one mark short
            # must not pass because 39.5% displayed as 40%.
            passed=scoring.score >= assessment.passing_marks,
            correct_count=scoring.correct_count,
            incorrect_count=scoring.incorrect_count,
            unanswered_count=scoring.unanswered_count,
            partial_count=scoring.partial_count,
            mcq_score=scoring.mcq_score,
            mcq_maximum=scoring.mcq_maximum,
            coding_score=scoring.coding_score,
            coding_maximum=scoring.coding_maximum,
            evaluated_at=utcnow(),
        )
        try:
            # A savepoint, so losing the race leaves the surrounding transaction usable.
            with self.db.begin_nested():
                self.results.add(result)
        except IntegrityError:
            winner = self.results.get_for_attempt(attempt.id)
            if winner is None:
                raise
            return winner

        log.info(
            "Attempt evaluated",
            extra={
                "attempt_id": str(attempt.id),
                "assessment_id": str(attempt.assessment_id),
                "user_id": str(attempt.candidate_id),
                "score": result.score,
                "maximum_score": result.maximum_score,
            },
        )
        return result

    def score(self, attempt: AssessmentAttempt) -> Scoring:
        """Scores the attempt without storing anything.

        Two queries, both eager-loading their children: the questions with their options, and the
        attempt's answers with their selections. No per-question lookups.
        """
        questions = self.questions.list_for_assessment(attempt.assessment_id)
        answers = self.attempts.list_answers(attempt.id)
        return score_attempt(questions, answers, self.coding_submissions(attempt))

    def coding_submissions(self, attempt: AssessmentAttempt) -> dict[uuid.UUID, list[CodingBest]]:
        """Every judged submission of the attempt, by question, oldest first (so ties go to the earliest)."""
        out: dict[uuid.UUID, list[CodingBest]] = {}
        for e in self.db.scalars(
            select(CodeExecution)
            .where(
                CodeExecution.attempt_id == attempt.id,
                CodeExecution.kind == ExecutionKind.SUBMIT,
                CodeExecution.status == ExecutionStatus.COMPLETED,
            )
            .order_by(CodeExecution.created_at)
        ):
            out.setdefault(e.question_id, []).append(
                CodingBest(
                    e.id,
                    e.verdict.value if e.verdict else "SYSTEM_ERROR",
                    e.passed or 0,
                    e.total or 0,
                    e.passed_weight or 0,
                    e.total_weight or 0,
                    e.language,
                )
            )
        return out

    def outcomes_for(self, attempt: AssessmentAttempt) -> list[QuestionOutcome]:
        """The per-question breakdown shown to a candidate: what each question was worth and how
        it turned out. Never which option was correct."""
        return self.score(attempt).outcomes

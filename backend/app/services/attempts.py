"""Taking an exam: starting an attempt, recording answers, and finishing (Phase 3A–3C).

Everything a candidate can do to an attempt goes through here. Three rules shape the whole module:

* **The session decides who the candidate is.** No method accepts a candidate id from a request
  body or query string; each takes the authenticated `User` and scopes its queries to it.
* **The server owns the clock.** `expires_at` is written once at creation and read back against
  the server's own `utcnow()`. No request can set it, extend it or report a remaining time; the
  client is told what the deadline is and never asked. Every entry point runs `settle()` first, so
  an attempt whose time ran out is finished by the next thing the candidate does, whether or not
  their countdown ever fired.
* **Nothing here decides whether an answer is right.** Answers are checked for structural
  validity only — that the option exists on that question, and that the count suits the question
  type. Correctness belongs to `services/evaluation.py`, which this module calls once, at the
  moment an attempt finalizes, inside the same transaction.
"""

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AttemptLocked, Conflict, NotFound, ValidationFailed
from app.models.assessment import Assessment, AssessmentStatus
from app.models.assignment import AssessmentAssignment
from app.models.attempt import AssessmentAttempt, AttemptAnswer, AttemptStatus
from app.models.base import utcnow
from app.models.question import SINGLE_ANSWER_TYPES, Question
from app.models.user import User
from app.repositories.assignments import AssignmentRepository
from app.repositories.attempts import AttemptRepository
from app.repositories.questions import QuestionRepository
from app.services.evaluation import EvaluationService

log = logging.getLogger("assessx.attempts")


class AttemptService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.attempts = AttemptRepository(db)
        self.assignments = AssignmentRepository(db)
        self.questions = QuestionRepository(db)

    # -- starting ------------------------------------------------------------------------

    def start_or_resume(self, candidate: User, assessment_id: uuid.UUID) -> tuple[AssessmentAttempt, bool]:
        """Returns `(attempt, created)` for the candidate's own attempt at this assessment.

        Resuming comes before every other rule: a refresh, a double-click or a retried request
        must land back on the attempt the candidate already holds, never on a second one and never
        on an error. Only when there is no open attempt do the "may they start one?" checks run.
        """
        assignment = self.assignment_or_404(candidate, assessment_id)
        assessment = assignment.assessment

        existing = self.attempts.get_active(assessment_id, candidate.id)
        if existing is not None:
            # An attempt whose time ran out while the app was closed is finished here, not resumed.
            self.settle(existing)
            if existing.is_active:
                return existing, False

        self._check_startable(assessment)
        used = self.attempts.count_for_candidate(assessment_id, candidate.id)
        if used >= assessment.max_attempts:
            raise Conflict(self._attempts_exhausted(assessment))

        # The deadline is fixed here, once, from the server's clock — never recomputed on a later
        # read, so refreshing or reopening the app cannot extend the exam (FR-006).
        started_at = utcnow()
        attempt = AssessmentAttempt(
            assessment_id=assessment.id,
            candidate_id=candidate.id,
            assignment_id=assignment.id,
            attempt_number=used + 1,
            status=AttemptStatus.IN_PROGRESS,
            started_at=started_at,
            expires_at=started_at + timedelta(minutes=assessment.duration_minutes),
        )
        try:
            # A savepoint, so that losing the race leaves the surrounding transaction usable.
            with self.db.begin_nested():
                self.attempts.add(attempt)
        except IntegrityError:
            # Two requests started at once and the partial unique index rejected this one. The
            # winner's attempt is the right answer to both, so resume it.
            winner = self.attempts.get_active(assessment_id, candidate.id)
            if winner is None:
                raise
            log.info(
                "Concurrent exam start resolved to the existing attempt",
                extra={"attempt_id": str(winner.id), "user_id": str(candidate.id)},
            )
            return winner, False

        log.info(
            "Exam attempt started",
            extra={
                "attempt_id": str(attempt.id),
                "assessment_id": str(assessment.id),
                "user_id": str(candidate.id),
                "attempt_number": attempt.attempt_number,
            },
        )
        return attempt, True

    def start_blocker(self, assessment: Assessment, *, attempts_used: int) -> str | None:
        """Why this candidate cannot start a new attempt, or `None` if they can.

        The details screen shows this and the start endpoint enforces it; both call this method so
        the button can never offer something the server would refuse.
        """
        try:
            self._check_startable(assessment)
        except Conflict as blocked:
            return blocked.message
        if attempts_used >= assessment.max_attempts:
            return self._attempts_exhausted(assessment)
        return None

    @staticmethod
    def _attempts_exhausted(assessment: Assessment) -> str:
        noun = "attempt" if assessment.max_attempts == 1 else "attempts"
        return f"You have used all {assessment.max_attempts} {noun} for this exam."

    def _check_startable(self, assessment: Assessment) -> None:
        if assessment.status is not AssessmentStatus.PUBLISHED:
            raise Conflict("This exam is not open. Contact your administrator.")

        # The availability window is enforced at the moment of starting only. An attempt already
        # under way is not ended when the window closes — expiry is Phase 3B.
        now = utcnow()
        if assessment.availability_start and now < assessment.availability_start:
            raise Conflict("This exam has not opened yet.")
        if assessment.availability_end and now > assessment.availability_end:
            raise Conflict("This exam has closed.")

    def assignment_or_404(self, candidate: User, assessment_id: uuid.UUID) -> AssessmentAssignment:
        """The candidate's assignment, or 404.

        Not 403: an assessment the candidate was never given should not be distinguishable from
        one that does not exist, or the endpoint becomes a way to enumerate exams.
        """
        assignment = self.assignments.get(assessment_id, candidate.id)
        if assignment is None:
            raise NotFound("Exam not found.")
        return assignment

    # -- the clock -----------------------------------------------------------------------

    def settle(self, attempt: AssessmentAttempt, *, now: datetime | None = None) -> AssessmentAttempt:
        """Applies the passage of time to an attempt, and persists it if the deadline has passed.

        This is the mechanism behind automatic timeout, and it deliberately does not need a
        background worker to be correct: an attempt that ran out is finished by the next thing the
        candidate does — reading the exam, saving an answer, submitting, or simply opening My
        Exams. A client that sits open with a frozen countdown, or one that never runs at all,
        changes nothing, because the transition happens on the server's clock.

        `finalized_at` is set to `expires_at`, not to now: the exam ended when the time ran out,
        not at the later moment the server happened to notice.
        """
        if not attempt.is_active:
            return attempt
        now = now or utcnow()
        if not attempt.has_expired_at(now):
            return attempt

        attempt.status = AttemptStatus.TIME_EXPIRED
        attempt.finalized_at = attempt.expires_at
        self.db.flush()
        # Evaluated in the same transaction that ended it, so an expired attempt never exists in a
        # finished-but-unscored state that a candidate could observe.
        EvaluationService(self.db).ensure_result(attempt)
        log.info(
            "Exam attempt expired",
            extra={
                "attempt_id": str(attempt.id),
                "assessment_id": str(attempt.assessment_id),
                "user_id": str(attempt.candidate_id),
            },
        )
        return attempt

    # -- reading -------------------------------------------------------------------------

    def get_attempt(self, candidate: User, attempt_id: uuid.UUID) -> AssessmentAttempt:
        """The candidate's own attempt, with the clock applied.

        Someone else's is not found, not forbidden.
        """
        attempt = self.attempts.get_for_candidate(attempt_id, candidate.id)
        if attempt is None:
            raise NotFound("Attempt not found.")
        return self.settle(attempt)

    def questions_for(self, attempt: AssessmentAttempt) -> list[Question]:
        """The attempt's questions in their authored order (`position`).

        `randomize_questions` / `randomize_options` are stored by Phase 2B but not applied: a
        randomised order has to be fixed per attempt and persisted, or a resume would reshuffle the
        paper (OQ-19). That decision is recorded in `docs/PHASE-3-PLAN.md` and is not made here.
        """
        return self.questions.list_for_assessment(attempt.assessment_id)

    def answers_for(self, attempt: AssessmentAttempt) -> list[AttemptAnswer]:
        return self.attempts.list_answers(attempt.id)

    def active_attempt_ids(self, candidate: User) -> dict[uuid.UUID, uuid.UUID]:
        return self.attempts.active_attempt_ids_by_assessment(candidate.id)

    def latest_attempts(self, candidate: User) -> dict[uuid.UUID, AssessmentAttempt]:
        """`{assessment_id: newest attempt}`, each settled.

        Opening My Exams is an interaction, so it is also a moment at which an attempt that ran
        out gets finished — the candidate cannot dodge expiry by never opening the exam screen.
        """
        latest = self.attempts.latest_by_assessment(candidate.id)
        for attempt in latest.values():
            self.settle(attempt)
        return latest

    def attempts_used(self, candidate: User, assessment_id: uuid.UUID) -> int:
        return self.attempts.count_for_candidate(assessment_id, candidate.id)

    # -- answering -----------------------------------------------------------------------

    def save_answer(
        self,
        candidate: User,
        attempt_id: uuid.UUID,
        question_id: uuid.UUID,
        selected_option_ids: list[uuid.UUID],
    ) -> AttemptAnswer:
        """Replaces the stored selection for one question. An empty list clears it."""
        attempt = self._open_attempt(candidate, attempt_id)
        question = self._question_of(attempt, question_id)

        selected = list(dict.fromkeys(selected_option_ids))
        allowed = {option.id for option in question.options}
        unknown = [str(option_id) for option_id in selected if option_id not in allowed]
        if unknown:
            # Covers both a fabricated id and an id belonging to a different question.
            raise ValidationFailed(
                "That option does not belong to this question.",
                details=[{"field": "selected_option_ids", "message": f"Unknown option: {unknown[0]}."}],
            )
        if question.type in SINGLE_ANSWER_TYPES and len(selected) > 1:
            raise ValidationFailed(
                "Select a single option for this question.",
                details=[
                    {"field": "selected_option_ids", "message": "This question accepts one answer only."}
                ],
            )

        answer = self._answer_row(attempt, question_id)
        self.attempts.replace_selections(answer, selected)
        return answer

    # -- finishing -----------------------------------------------------------------------

    def submit(self, candidate: User, attempt_id: uuid.UUID) -> AssessmentAttempt:
        """Finalizes the candidate's own attempt.

        The row is taken `FOR UPDATE` first, which is what makes the submit-versus-expiry race
        deterministic rather than a coin toss: whichever transaction gets the lock settles the
        attempt, and the other one reads the outcome instead of overwriting it. The decision is
        made from the server's clock against the stored deadline — a request that *left* the
        client before the deadline but arrives after it is late, because only arrival is
        observable and only the server's clock is trusted.

        Submitting twice is not an error. A retried or double-clicked request returns the same
        finalized attempt, for the same reason starting twice resumes rather than duplicating.
        """
        attempt = self.attempts.get_for_candidate_locked(attempt_id, candidate.id)
        if attempt is None:
            raise NotFound("Attempt not found.")

        self.settle(attempt)

        if attempt.status is AttemptStatus.SUBMITTED:
            return attempt  # idempotent: the same submission, arriving twice
        if attempt.status is AttemptStatus.TIME_EXPIRED:
            raise AttemptLocked("Time ran out before this exam was submitted.")

        now = utcnow()
        attempt.status = AttemptStatus.SUBMITTED
        attempt.submitted_at = now
        attempt.finalized_at = now
        self.db.flush()
        # Same transaction as the submission: the candidate cannot see a submitted attempt that
        # has no result, and a failed evaluation rolls the submission back rather than leaving
        # half a finish behind.
        EvaluationService(self.db).ensure_result(attempt)
        log.info(
            "Exam attempt submitted",
            extra={
                "attempt_id": str(attempt.id),
                "assessment_id": str(attempt.assessment_id),
                "user_id": str(candidate.id),
            },
        )
        return attempt

    def _open_attempt(self, candidate: User, attempt_id: uuid.UUID) -> AssessmentAttempt:
        """The attempt, only while it is still open to changes.

        `get_attempt` has already applied the clock, so an answer arriving after the deadline is
        refused here — and the attempt is left `TIME_EXPIRED` in the database, not merely rejected.
        """
        attempt = self.get_attempt(candidate, attempt_id)
        if attempt.is_finalized:
            raise AttemptLocked(
                "Time ran out for this exam."
                if attempt.status is AttemptStatus.TIME_EXPIRED
                else "This exam has been submitted and can no longer be changed."
            )
        return attempt

    def _question_of(self, attempt: AssessmentAttempt, question_id: uuid.UUID) -> Question:
        """The question, only if it belongs to this attempt's assessment.

        This is what stops a candidate answering question ids harvested from another exam: the
        lookup is scoped, so an unrelated question is simply not found.
        """
        question = self.questions.get(question_id, assessment_id=attempt.assessment_id)
        if question is None:
            raise NotFound("That question is not part of this exam.")
        return question

    def _answer_row(self, attempt: AssessmentAttempt, question_id: uuid.UUID) -> AttemptAnswer:
        """The attempt's answer row for this question, created the first time it is answered.

        `uq_attempt_answer_attempt_question` makes the row unique; a concurrent first write loses
        the insert and re-reads the winner rather than creating a duplicate.
        """
        answer = self.attempts.get_answer(attempt.id, question_id)
        if answer is not None:
            return answer
        try:
            with self.db.begin_nested():
                return self.attempts.add_answer(AttemptAnswer(attempt_id=attempt.id, question_id=question_id))
        except IntegrityError:
            existing = self.attempts.get_answer(attempt.id, question_id)
            if existing is None:
                raise
            return existing

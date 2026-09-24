"""Reading results (Phase 3C).

Two audiences with different rights, so two paths:

* a candidate may read their own result, and sees a score only when the assessment's
  `show_results` setting says so;
* an administrator may read every result for an assessment, always with the score.

Neither path accepts a score from anywhere. The numbers come from `attempt_results`, written once
by `EvaluationService`.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.attempt import AssessmentAttempt
from app.models.result import AttemptResult
from app.models.user import User
from app.repositories.results import ResultRepository
from app.services.evaluation import EvaluationService, QuestionOutcome


class ResultService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ResultRepository(db)
        self.evaluation = EvaluationService(db)

    def for_attempt(self, attempt: AssessmentAttempt) -> AttemptResult:
        """The attempt's result, evaluating it if it has not been evaluated yet.

        The lazy path matters for attempts that finished before Phase 3C existed, and for any
        future finalization route that forgets to evaluate: reading a finished attempt's result
        always produces one rather than a missing-data error. `ensure_result` refuses an attempt
        that is still running.
        """
        return self.evaluation.ensure_result(attempt)

    def outcomes(self, attempt: AssessmentAttempt) -> list[QuestionOutcome]:
        return self.evaluation.outcomes_for(attempt)

    def list_for_candidate(self, candidate: User) -> list[AttemptResult]:
        """The candidate's own results. Scoped to them by the query itself."""
        return self.repo.list_for_candidate(candidate.id)

    def list_for_assessment(self, assessment_id: uuid.UUID) -> list[AttemptResult]:
        """Every result for one assessment, evaluating any finished attempt that still lacks one.

        Without this, an attempt that finished before Phase 3C would simply be absent from the
        administrator's table with no explanation.
        """
        for attempt in self.repo.finalized_attempts_for_assessment(assessment_id):
            self.evaluation.ensure_result(attempt)
        return self.repo.list_for_assessment(assessment_id)

"""Phase 7B — EvaluationRunner: runs one PENDING evaluation, in the server process, after the response.

No Celery, Redis or worker: FastAPI runs `run()` as a background task once the answer's response has been
sent. Three steps, and **no database connection is held during the provider call**:

1. **Claim** (short transaction): lock the evaluation row; skip it unless PENDING and not leased by
   another run; take a lease; count the attempt (at most `MAX_RUNS` runs per evaluation, each with its own
   bounded provider retries); read the *stored* answer and its question.
2. **Evaluate** (no transaction): provider call with timeout and bounded retries, then strict validation.
3. **Record** (short transaction): lock the session, then the evaluation; if it is still PENDING write the
   validated result (COMPLETED) or the failure (FAILED) — once — then let the session move on.

If the process dies mid-run, the lease expires and the next read of the session schedules the evaluation
again; the candidate meanwhile moves on after `evaluation_wait_seconds` by the fallback rule. A failure
never becomes a score.
"""

import logging
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.database import SessionLocal
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.interview import InterviewQuestion, InterviewSession, InterviewSessionItem
from app.models.interview_evaluation import EvaluationFailure, EvaluationStatus, InterviewEvaluation
from app.repositories.audit import AuditRepository
from app.services import security_events
from app.services.interview.evaluation import EvaluationOutcome, evaluate
from app.services.interview.llm import EvaluationProvider, provider_from_settings
from app.services.interview.prompts import EvaluationContext, injection_signals
from app.services.interview.rubrics import RUBRICS
from app.services.interview.sessions import EvaluatorInfo, InterviewSessionService

log = logging.getLogger("assessx.interviews.evaluation")

MAX_RUNS = 3

SessionScope = Callable[[], AbstractContextManager[Session]]


@contextmanager
def database_scope() -> Iterator[Session]:
    """A transaction of its own (the request's has already committed)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class EvaluationRunner:
    def __init__(
        self,
        scope: SessionScope,
        provider: EvaluationProvider,
        settings: Settings,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.scope = scope
        self.provider = provider
        self.settings = settings
        self.sleep = sleep

    @property
    def info(self) -> EvaluatorInfo:
        return EvaluatorInfo(
            provider=self.provider.name,
            model=self.provider.model,
            configured=True,
            wait_seconds=self.settings.evaluation_wait_seconds,
        )

    def _lease_seconds(self) -> float:
        # Every provider call of one run, plus backoff, plus slack.
        return self.settings.llm_timeout_seconds * (1 + self.settings.llm_max_retries) + 15

    def _audit(self, db: Session, session: InterviewSession, action: AuditAction, **details: object) -> None:
        AuditRepository(db).record(
            actor_id=session.candidate_id,
            action=action,
            interview_id=session.interview_id,
            interview_session_id=session.id,
            details={**{k: v for k, v in details.items() if v is not None}, "initiated_by": "evaluator"},
        )

    def run(self, evaluation_id: uuid.UUID) -> None:
        """Never raises: a background task's failure must not take anything else down."""
        try:
            claimed = self._claim(evaluation_id)
            if claimed is None:
                return
            outcome = evaluate(
                claimed, self.provider, max_retries=self.settings.llm_max_retries, sleep=self.sleep
            )
            self._record(evaluation_id, outcome)
        except Exception:
            # Ids only — never the answer, the prompt or anything from the provider.
            log.exception("Evaluation run failed", extra={"evaluation_id": str(evaluation_id)})

    def _claim(self, evaluation_id: uuid.UUID) -> EvaluationContext | None:
        with self.scope() as db:
            evaluation = db.scalar(
                select(InterviewEvaluation)
                .where(InterviewEvaluation.id == evaluation_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            now = utcnow()
            if evaluation is None or evaluation.status is not EvaluationStatus.PENDING:
                return None
            if evaluation.lease_until is not None and evaluation.lease_until > now:
                return None  # another run holds it
            item = db.get(InterviewSessionItem, evaluation.item_id)
            session = db.get(InterviewSession, evaluation.session_id)
            question = db.get(InterviewQuestion, evaluation.question_id)
            assert item is not None and session is not None and question is not None
            if evaluation.attempts >= MAX_RUNS:
                self._finish(db, session, evaluation, EvaluationOutcome(failure=EvaluationFailure.TIMEOUT))
                return None
            evaluation.attempts += 1
            evaluation.lease_until = now + timedelta(seconds=self._lease_seconds())
            if evaluation.attempts > 1:
                self._audit(db, session, AuditAction.INTERVIEW_EVALUATION_RETRIED, **evaluation.details())
            db.flush()
            if evaluation.attempts == 1:
                signals = injection_signals(item.answer_text or "")
                if signals:
                    # Instruction-like text in an answer: recorded once, by session — never the answer.
                    security_events.record(
                        "ai_injection_suspected",
                        actor_id=session.candidate_id,
                        target_type="interview_session",
                        target_id=session.id,
                        details={"signals": len(signals)},
                    )
            rubric = next(r for r in RUBRICS if r.version == evaluation.rubric_version)
            interview = session.interview
            return EvaluationContext(
                interview_type=interview.interview_type.value,
                question_type=question.question_type.value,
                topic=question.topic,
                difficulty=question.difficulty.value,
                question=question.text,
                context=question.context,
                expected_concepts=tuple(question.expected_concepts),
                competency=question.competency,
                rubric=rubric,
                answer=item.answer_text or "",  # the stored answer — never client-supplied text
            )

    def _record(self, evaluation_id: uuid.UUID, outcome: EvaluationOutcome) -> None:
        with self.scope() as db:
            # Lock order everywhere: the session, then the evaluation.
            session_id = db.scalar(
                select(InterviewEvaluation.session_id).where(InterviewEvaluation.id == evaluation_id)
            )
            if session_id is None:
                return  # the session was deleted (e.g. unassigned) meanwhile
            session = db.scalar(
                select(InterviewSession)
                .where(InterviewSession.id == session_id)
                .with_for_update(of=InterviewSession)
                .execution_options(populate_existing=True)
            )
            evaluation = db.scalar(
                select(InterviewEvaluation)
                .where(InterviewEvaluation.id == evaluation_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if session is None or evaluation is None or evaluation.status is not EvaluationStatus.PENDING:
                return
            self._finish(db, session, evaluation, outcome)

    def _finish(
        self,
        db: Session,
        session: InterviewSession,
        evaluation: InterviewEvaluation,
        outcome: EvaluationOutcome,
    ) -> None:
        now = utcnow()
        evaluation.lease_until = None
        evaluation.latency_ms = outcome.latency_ms or evaluation.latency_ms
        evaluation.input_tokens = outcome.input_tokens
        evaluation.output_tokens = outcome.output_tokens
        result = outcome.result
        if result is not None:
            evaluation.status = EvaluationStatus.COMPLETED
            evaluation.dimension_scores = result.dimension_scores
            evaluation.overall_score = result.overall_score
            evaluation.confidence = result.confidence
            evaluation.present_concepts = result.present_concepts
            evaluation.missing_concepts = result.missing_concepts
            evaluation.incorrect_points = result.incorrect_points
            evaluation.strengths = result.strengths
            evaluation.evidence_quotes = result.evidence_quotes
            evaluation.feedback = result.feedback
            evaluation.flags = result.flags
            evaluation.completed_at = now
            action = AuditAction.INTERVIEW_EVALUATION_COMPLETED
        else:
            evaluation.status = EvaluationStatus.FAILED
            evaluation.failure_reason = outcome.failure or EvaluationFailure.PROVIDER_ERROR
            action = AuditAction.INTERVIEW_EVALUATION_FAILED
        db.flush()
        self._audit(
            db,
            session,
            action,
            **evaluation.details(),
            provider_calls=outcome.provider_calls,
            retried_for=outcome.retried_for or None,
            latency_ms=outcome.latency_ms,
            flags=evaluation.flags or None,
        )
        log.info(
            "Evaluation finished",
            extra={
                "evaluation_id": str(evaluation.id),
                "status": evaluation.status.value,
                "latency_ms": outcome.latency_ms,
            },
        )
        # The answer has been evaluated (or has failed): the interview may move on now, if still waiting.
        service = InterviewSessionService(db, self.info)
        service.settle(session, now)
        service.advance(session, now)  # moves on only if *this* answer was the one being waited for


def runner_from_settings(settings: Settings) -> EvaluationRunner | None:
    """The configured evaluator, or None (answers are then recorded as not evaluated)."""
    provider = provider_from_settings(settings)
    return EvaluationRunner(database_scope, provider, settings) if provider else None

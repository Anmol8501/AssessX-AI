"""Code execution (coding assessments, stage C2): queueing requests, handing jobs to runners, judging results.

The API never runs code. A request becomes a QUEUED `code_executions` row; a runner (a separate program
on a separate machine, see `runner/`) claims it over HTTPS, runs it in a sandbox and reports *raw* results
(exit status, output, time). **The server judges**: it alone compares each output with the expected answer,
which the runner is never sent. So a compromised runner can make code fail, but cannot see expected
outputs or mark a wrong answer as right.

Candidate requests are checked against the attempt (own, open, not on hold, proctoring active when
required), the question (in this attempt's assessment, a coding question), the language (enabled on the
pinned version), the assessment's policies (custom input, submission limit), per-attempt rate limits, one
job in flight per question, and a global queue cap. A retried request with the same idempotency key
returns the original execution instead of creating another.
"""

import hmac
import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import (
    AttemptLocked,
    AttemptOnHold,
    Conflict,
    ExecutionInProgress,
    ExecutionRateLimited,
    NotFound,
    RunnerBusy,
    SubmissionLimitReached,
    ValidationFailed,
)
from app.models.attempt import AssessmentAttempt
from app.models.base import utcnow
from app.models.code_execution import CodeExecution, ExecutionKind, ExecutionStatus, Verdict
from app.models.coding import CodingProblemVersion, CodingTestCase, TestCaseVisibility
from app.models.proctoring_event import ProctoringEventType
from app.models.question import Question, QuestionType
from app.models.user import User
from app.services.coding.languages import LANGUAGES

log = logging.getLogger("assessx.coding.execution")

MAX_SOURCE = 65_536
MAX_CUSTOM_INPUT = 65_536
#: Per attempt, in any 60 seconds.
RUNS_PER_MINUTE = 10
SUBMITS_PER_MINUTE = 3
#: Per attempt, across all its questions (Phase 8 final, CX-05): jobs waiting or running at once, and the
#: most runs one attempt may ever request. With one job per question and 10 runs a minute this bounds what
#: one candidate can put in front of the shared runner; generous for real use (a run takes seconds).
MAX_IN_FLIGHT_PER_ATTEMPT = 2
MAX_RUNS_PER_ATTEMPT = 300
#: Nothing more is queued once this many jobs are waiting (one runner must not be buried).
QUEUE_CAP = 500
#: How much of each test's output and error stream is kept.
KEEP_STDOUT = 8_192
KEEP_STDERR = 2_048
KEEP_COMPILE = 8_192
COMPILE_TIME_LIMIT_MS = 30_000
COMPILE_MEMORY_MB = 1024

IN_FLIGHT = (ExecutionStatus.QUEUED, ExecutionStatus.RUNNING)


# -- judging (pure) ----------------------------------------------------------------------------------------


def normalize(output: str) -> str:
    """Trailing spaces on each line and trailing blank lines are ignored; everything else must match."""
    lines = [line.rstrip() for line in output.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


#: Runner outcome → verdict, for everything except a clean exit (which is compared).
_OUTCOME_VERDICT = {
    "RUNTIME_ERROR": Verdict.RUNTIME_ERROR,
    "TIME_LIMIT": Verdict.TIME_LIMIT_EXCEEDED,
    "MEMORY_LIMIT": Verdict.MEMORY_LIMIT_EXCEEDED,
    "OUTPUT_LIMIT": Verdict.OUTPUT_LIMIT_EXCEEDED,
}


@dataclass(frozen=True)
class JudgeTest:
    id: str
    number: int
    visibility: str  # PUBLIC | HIDDEN | CUSTOM
    expected: str | None
    weight: int


@dataclass(frozen=True)
class Judgement:
    verdict: Verdict
    passed: int
    total: int
    passed_weight: int
    total_weight: int
    runtime_ms: int | None
    memory_kb: int | None
    compile_output: str | None
    results: list[dict[str, Any]]


def judge(tests: list[JudgeTest], report: dict[str, Any]) -> Judgement:
    """Turns a runner's raw report into verdicts. The runner never decides correctness."""
    compile_info = report.get("compile") or {}
    compile_output = (str(compile_info.get("output") or "")[:KEEP_COMPILE]) or None
    total_weight = sum(t.weight for t in tests)
    if compile_info.get("ok") is False:
        return Judgement(
            Verdict.COMPILATION_ERROR, 0, len(tests), 0, total_weight, None, None, compile_output, []
        )

    by_id = {str(r.get("id")): r for r in report.get("tests") or [] if isinstance(r, dict)}
    results: list[dict[str, Any]] = []
    passed = passed_weight = 0
    first_failure: Verdict | None = None
    runtimes: list[int] = []
    for test in tests:
        raw = by_id.get(test.id)
        if raw is None:
            verdict = Verdict.SYSTEM_ERROR
            stdout = stderr = ""
            runtime = None
        else:
            stdout = str(raw.get("stdout") or "")
            stderr = str(raw.get("stderr") or "")
            runtime = raw.get("runtime_ms") if isinstance(raw.get("runtime_ms"), int) else None
            outcome = raw.get("outcome")
            if outcome == "OK":
                if test.expected is None:
                    verdict = Verdict.COMPLETED
                else:
                    verdict = (
                        Verdict.ACCEPTED
                        if normalize(stdout) == normalize(test.expected)
                        else Verdict.WRONG_ANSWER
                    )
            else:
                verdict = _OUTCOME_VERDICT.get(str(outcome), Verdict.SYSTEM_ERROR)
        if runtime is not None:
            runtimes.append(runtime)
        if verdict in (Verdict.ACCEPTED, Verdict.COMPLETED):
            passed += 1
            passed_weight += test.weight
        elif first_failure is None:
            first_failure = verdict
        results.append(
            {
                "test_id": test.id,
                "number": test.number,
                "visibility": test.visibility,
                "verdict": verdict.value,
                "runtime_ms": runtime,
                "exit_code": raw.get("exit_code") if raw else None,
                "stdout": stdout[:KEEP_STDOUT],
                "stderr": stderr[:KEEP_STDERR],
            }
        )
    custom = len(tests) == 1 and tests[0].expected is None
    overall = first_failure or (Verdict.COMPLETED if custom else Verdict.ACCEPTED)
    memory = report.get("memory_kb") if isinstance(report.get("memory_kb"), int) else None
    return Judgement(
        overall,
        passed,
        len(tests),
        passed_weight,
        total_weight,
        max(runtimes) if runtimes else None,
        memory,
        compile_output,
        results,
    )


# -- the service ---------------------------------------------------------------------------------------------


class ExecutionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # -- candidate requests -----------------------------------------------------------------------------

    def _context(
        self, candidate: User, attempt_id: uuid.UUID, question_id: uuid.UUID
    ) -> tuple[AssessmentAttempt, Question]:
        from app.services.attempts import AttemptService
        from app.services.proctoring import ProctoringService

        # Locked FOR UPDATE: concurrent requests for one attempt are serialised, so the rate limits,
        # the in-flight rule and the submission limit cannot be raced past.
        attempt = AttemptService(self.db).get_attempt_for_update(candidate, attempt_id)
        if attempt.is_finalized:
            raise AttemptLocked("This exam has ended.")
        if attempt.is_on_hold:
            raise AttemptOnHold()
        ProctoringService(self.db).require_active_if_proctored(attempt)
        question = self.db.scalar(
            select(Question).where(
                Question.id == question_id, Question.assessment_id == attempt.assessment_id
            )
        )
        if question is None or question.type is not QuestionType.CODING or question.coding_version is None:
            raise NotFound("Coding question not found.")
        return attempt, question

    def _existing(self, attempt: AssessmentAttempt, key: str | None) -> CodeExecution | None:
        if not key:
            return None
        return self.db.scalar(
            select(CodeExecution).where(
                CodeExecution.attempt_id == attempt.id, CodeExecution.idempotency_key == key
            )
        )

    def _count(self, *conditions: Any) -> int:
        return int(self.db.scalar(select(func.count()).select_from(CodeExecution).where(*conditions)) or 0)

    def _guard(
        self, attempt: AssessmentAttempt, question: Question, kind: ExecutionKind, language: str, source: str
    ) -> None:
        version = question.coding_version
        if language not in version.languages or language not in LANGUAGES:
            raise ValidationFailed(
                "That language is not allowed for this problem.",
                details=[{"field": "language", "message": "Not enabled."}],
            )
        if not source.strip() or len(source) > MAX_SOURCE:
            raise ValidationFailed(f"Source code must be 1 to {MAX_SOURCE} characters.")
        if self._count(
            CodeExecution.attempt_id == attempt.id,
            CodeExecution.question_id == question.id,
            CodeExecution.status.in_(IN_FLIGHT),
        ):
            raise ExecutionInProgress()
        if self._count(CodeExecution.attempt_id == attempt.id, CodeExecution.status.in_(IN_FLIGHT)) >= (
            MAX_IN_FLIGHT_PER_ATTEMPT
        ):
            raise ExecutionInProgress("Wait for your code that is already running to finish.")
        if (
            kind is ExecutionKind.RUN
            and self._count(CodeExecution.attempt_id == attempt.id, CodeExecution.kind == kind)
            >= MAX_RUNS_PER_ATTEMPT
        ):
            raise ExecutionRateLimited(
                f"This exam allows at most {MAX_RUNS_PER_ATTEMPT} runs. You can still submit your answer."
            )
        window = utcnow() - timedelta(seconds=60)
        limit = RUNS_PER_MINUTE if kind is ExecutionKind.RUN else SUBMITS_PER_MINUTE
        if (
            self._count(
                CodeExecution.attempt_id == attempt.id,
                CodeExecution.kind == kind,
                CodeExecution.created_at >= window,
            )
            >= limit
        ):
            raise ExecutionRateLimited(
                "Too many runs in a short time. Wait a moment and try again."
                if kind is ExecutionKind.RUN
                else "Too many submissions in a short time. Wait a moment and try again."
            )
        if self._count(CodeExecution.status == ExecutionStatus.QUEUED) >= QUEUE_CAP:
            raise RunnerBusy()

    def record_event(
        self, attempt: AssessmentAttempt, question: Question, event_type: Any, **details: Any
    ) -> None:
        """A factual coding-activity event on the attempt's proctoring timeline (when it is proctored and
        the session is active). Never a judgement; the risk engine does not treat these as signals."""
        from app.models.proctoring import ProctoringSessionStatus
        from app.realtime import notify
        from app.services.proctoring_events import ProctoringEventRecorder

        session = attempt.proctoring_session
        if session is None or session.status is not ProctoringSessionStatus.ACTIVE:
            return
        event = ProctoringEventRecorder(self.db).record_server(
            session, event_type, {"question_number": question.position + 1, **details}
        )
        notify.event_recorded(self.db, session, event)

    def _create(self, execution: CodeExecution, attempt: AssessmentAttempt) -> tuple[CodeExecution, bool]:
        try:
            with self.db.begin_nested():
                self.db.add(execution)
                self.db.flush()
        except IntegrityError:
            existing = self._existing(attempt, execution.idempotency_key)
            if existing is None:
                raise
            return existing, False
        log.info("Execution queued", extra={"execution_id": str(execution.id), "kind": execution.kind.value})
        return execution, True

    def request_run(
        self,
        candidate: User,
        attempt_id: uuid.UUID,
        question_id: uuid.UUID,
        *,
        language: str,
        source: str,
        custom_input: str | None,
        idempotency_key: str | None,
    ) -> tuple[CodeExecution, bool]:
        attempt, question = self._context(candidate, attempt_id, question_id)
        existing = self._existing(attempt, idempotency_key)
        if existing is not None:
            return existing, False
        if custom_input is not None:
            if not attempt.assessment.coding_allow_custom_input:
                raise ValidationFailed("Running with your own input is not allowed in this assessment.")
            if len(custom_input) > MAX_CUSTOM_INPUT:
                raise ValidationFailed(f"Input can be at most {MAX_CUSTOM_INPUT} characters.")
        self._guard(attempt, question, ExecutionKind.RUN, language, source)
        created = self._create(
            CodeExecution(
                kind=ExecutionKind.RUN,
                attempt_id=attempt.id,
                question_id=question.id,
                problem_version_id=question.coding_problem_version_id,
                requested_by_id=candidate.id,
                language=language,
                source=source,
                custom_input=custom_input,
                idempotency_key=idempotency_key,
                results=[],
                claim_count=0,
            ),
            attempt,
        )
        if created[1]:
            self.record_event(
                attempt,
                question,
                ProctoringEventType.CODE_RUN_REQUESTED,
                language=language,
                custom_input=custom_input is not None,
            )
        return created

    def request_submit(
        self,
        candidate: User,
        attempt_id: uuid.UUID,
        question_id: uuid.UUID,
        *,
        language: str,
        source: str,
        idempotency_key: str | None,
    ) -> tuple[CodeExecution, bool]:
        attempt, question = self._context(candidate, attempt_id, question_id)
        existing = self._existing(attempt, idempotency_key)
        if existing is not None:
            return existing, False
        used = self._count(
            CodeExecution.attempt_id == attempt.id,
            CodeExecution.question_id == question.id,
            CodeExecution.kind == ExecutionKind.SUBMIT,
        )
        if used >= attempt.assessment.coding_max_submissions:
            raise SubmissionLimitReached()
        self._guard(attempt, question, ExecutionKind.SUBMIT, language, source)
        created = self._create(
            CodeExecution(
                kind=ExecutionKind.SUBMIT,
                attempt_id=attempt.id,
                question_id=question.id,
                problem_version_id=question.coding_problem_version_id,
                requested_by_id=candidate.id,
                language=language,
                source=source,
                idempotency_key=idempotency_key,
                results=[],
                claim_count=0,
            ),
            attempt,
        )
        if created[1]:
            self.record_event(attempt, question, ProctoringEventType.CODE_SUBMITTED, language=language)
        return created

    def for_candidate(
        self, candidate: User, attempt_id: uuid.UUID, question_id: uuid.UUID, execution_id: uuid.UUID
    ) -> CodeExecution:
        """Only the candidate's own execution, through its own attempt and question; anything else is 404."""
        execution = self.db.scalar(
            select(CodeExecution)
            .join(AssessmentAttempt, AssessmentAttempt.id == CodeExecution.attempt_id)
            .where(
                CodeExecution.id == execution_id,
                CodeExecution.attempt_id == attempt_id,
                CodeExecution.question_id == question_id,
                AssessmentAttempt.candidate_id == candidate.id,
            )
        )
        if execution is None:
            raise NotFound("Execution not found.")
        return execution

    def submissions(
        self, candidate: User, attempt_id: uuid.UUID, question_id: uuid.UUID
    ) -> list[CodeExecution]:
        return list(
            self.db.scalars(
                select(CodeExecution)
                .join(AssessmentAttempt, AssessmentAttempt.id == CodeExecution.attempt_id)
                .where(
                    CodeExecution.attempt_id == attempt_id,
                    CodeExecution.question_id == question_id,
                    CodeExecution.kind == ExecutionKind.SUBMIT,
                    AssessmentAttempt.candidate_id == candidate.id,
                )
                .order_by(CodeExecution.created_at.desc())
            )
        )

    # -- administrator validation ------------------------------------------------------------------------

    def request_validation(self, admin: User, version: CodingProblemVersion) -> CodeExecution:
        if not version.reference_solution or version.reference_language not in version.languages:
            raise ValidationFailed("Add a reference solution in an enabled language first.")
        if not version.test_cases:
            raise ValidationFailed("Add test cases first.")
        if self._count(
            CodeExecution.problem_version_id == version.id,
            CodeExecution.kind == ExecutionKind.VALIDATE,
            CodeExecution.status.in_(IN_FLIGHT),
        ):
            raise ExecutionInProgress("Validation is already running.")
        if self._count(CodeExecution.status == ExecutionStatus.QUEUED) >= QUEUE_CAP:
            raise RunnerBusy()
        execution = CodeExecution(
            kind=ExecutionKind.VALIDATE,
            problem_version_id=version.id,
            requested_by_id=admin.id,
            language=version.reference_language,
            source=version.reference_solution,
            results=[],
            claim_count=0,
        )
        self.db.add(execution)
        self.db.flush()
        return execution

    def latest_validation(self, version: CodingProblemVersion) -> CodeExecution | None:
        return self.db.scalar(
            select(CodeExecution)
            .where(
                CodeExecution.problem_version_id == version.id, CodeExecution.kind == ExecutionKind.VALIDATE
            )
            .order_by(CodeExecution.created_at.desc())
            .limit(1)
        )

    # -- runners -----------------------------------------------------------------------------------------

    @staticmethod
    def runner_token_ok(presented: str | None) -> bool | None:
        """None when no runner is configured; otherwise whether the token matches (constant time)."""
        token = get_settings().runner_token
        if token is None:
            return None
        return bool(presented) and hmac.compare_digest(presented.encode(), token.get_secret_value().encode())

    def _tests_for(self, execution: CodeExecution) -> list[CodingTestCase | None]:
        """The tests a job runs: the samples for a RUN, every test for SUBMIT and VALIDATE, or the
        candidate's own input (None) for a custom RUN."""
        if execution.kind is ExecutionKind.RUN and execution.custom_input is not None:
            return [None]
        tests = sorted(execution.problem_version.test_cases, key=lambda t: t.position)
        if execution.kind is ExecutionKind.RUN:
            tests = [t for t in tests if t.visibility is TestCaseVisibility.PUBLIC]
        return list(tests)

    def judge_tests(self, execution: CodeExecution) -> list[JudgeTest]:
        out: list[JudgeTest] = []
        for number, test in enumerate(self._tests_for(execution), start=1):
            if test is None:
                out.append(JudgeTest("custom", 1, "CUSTOM", None, 1))
            else:
                out.append(
                    JudgeTest(str(test.id), number, test.visibility.value, test.expected_output, test.weight)
                )
        return out

    def claim(self, runner_id: str) -> dict[str, Any] | None:
        """Hands the oldest waiting job (or one whose runner's lease expired) to this runner."""
        settings = get_settings()
        now = utcnow()
        for _ in range(5):
            execution = self.db.scalar(
                select(CodeExecution)
                .where(
                    or_(
                        CodeExecution.status == ExecutionStatus.QUEUED,
                        (CodeExecution.status == ExecutionStatus.RUNNING)
                        & (CodeExecution.lease_expires_at < now),
                    )
                )
                .order_by(CodeExecution.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if execution is None:
                return None
            if execution.claim_count >= settings.runner_max_claims:
                self._finish_failed(execution, "The job could not be completed.")
                continue
            execution.status = ExecutionStatus.RUNNING
            execution.claimed_by = runner_id
            execution.claimed_at = now
            execution.lease_expires_at = now + timedelta(seconds=settings.runner_lease_seconds)
            execution.claim_count += 1
            self.db.flush()
            return self._payload(execution)
        return None

    def _payload(self, execution: CodeExecution) -> dict[str, Any]:
        """What the runner needs — and nothing more: never an expected output."""
        version = execution.problem_version
        lang = LANGUAGES[execution.language]
        tests = []
        for test in self._tests_for(execution):
            if test is None:
                tests.append({"id": "custom", "input": execution.custom_input or ""})
            else:
                tests.append({"id": str(test.id), "input": test.input})
        return {
            "id": str(execution.id),
            "language": lang.id,
            "image": lang.image,
            "source_file": lang.source_file,
            "compile": list(lang.compile) if lang.compile else None,
            "run": list(lang.run),
            "source": execution.source,
            "time_limit_ms": int(version.time_limit_ms * lang.time_factor),
            "memory_limit_mb": version.memory_limit_mb + lang.memory_extra_mb,
            "compile_time_limit_ms": COMPILE_TIME_LIMIT_MS,
            "compile_memory_mb": COMPILE_MEMORY_MB,
            "output_limit_bytes": 65_536,
            "tests": tests,
        }

    def _running(self, execution_id: uuid.UUID, runner_id: str) -> CodeExecution:
        execution = self.db.scalar(
            select(CodeExecution)
            .where(CodeExecution.id == execution_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if execution is None:
            raise NotFound("Job not found.")
        if execution.status is not ExecutionStatus.RUNNING or execution.claimed_by != runner_id:
            raise Conflict("This job is not held by this runner.")
        return execution

    def complete(self, execution_id: uuid.UUID, runner_id: str, report: dict[str, Any]) -> CodeExecution:
        execution = self._running(execution_id, runner_id)
        if report.get("error"):
            self._finish_failed(execution, str(report.get("error"))[:200])
            return execution
        result = judge(self.judge_tests(execution), report)
        execution.status = ExecutionStatus.COMPLETED
        execution.verdict = result.verdict
        execution.passed = result.passed
        execution.total = result.total
        execution.passed_weight = result.passed_weight
        execution.total_weight = result.total_weight
        execution.runtime_ms = result.runtime_ms
        execution.memory_kb = result.memory_kb
        execution.compile_output = result.compile_output
        execution.results = result.results
        execution.completed_at = utcnow()
        execution.lease_expires_at = None
        if execution.kind is ExecutionKind.VALIDATE:
            version = execution.problem_version
            # Only a validation of the version as it still stands counts.
            if result.verdict is Verdict.ACCEPTED and version.updated_at <= execution.created_at:
                version.validated_at = execution.completed_at
        self.db.flush()
        log.info(
            "Execution judged", extra={"execution_id": str(execution.id), "verdict": result.verdict.value}
        )
        self._evaluate_if_finished(execution)
        return execution

    def fail(self, execution_id: uuid.UUID, runner_id: str, reason: str) -> CodeExecution:
        execution = self._running(execution_id, runner_id)
        self._finish_failed(execution, reason[:200])
        return execution

    def _finish_failed(self, execution: CodeExecution, reason: str) -> None:
        execution.status = ExecutionStatus.FAILED
        execution.verdict = Verdict.SYSTEM_ERROR
        execution.completed_at = utcnow()
        execution.lease_expires_at = None
        execution.compile_output = None
        self.db.flush()
        log.warning("Execution failed", extra={"execution_id": str(execution.id), "reason": reason})
        self._evaluate_if_finished(execution)

    def _evaluate_if_finished(self, execution: CodeExecution) -> None:
        """A submission of an attempt that has already ended: once nothing else is pending, the attempt's
        result is produced (the candidate saw "being evaluated" until now)."""
        if execution.kind is not ExecutionKind.SUBMIT or execution.attempt_id is None:
            return
        from app.services.evaluation import EvaluationService

        attempt = self.db.get(AssessmentAttempt, execution.attempt_id)
        if attempt is not None and attempt.is_finalized:
            EvaluationService(self.db).ensure_result(attempt)

"""The candidate's coding routes (coding assessments, stage C2): the problem, Run, Submit, results, history.

`CandidateUser` only, and every lookup goes through the candidate's own attempt: another candidate's
attempt, question or execution is 404. Responses are built from public data — sample tests, the
candidate's own input and output, counts for hidden tests — never hidden inputs, expected outputs,
hidden error text, or the reference solution.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Response, status
from sqlalchemy import func, select

from app.api.deps import CandidateUser, DbSession
from app.core.errors import NotFound
from app.models.code_execution import CodeExecution, ExecutionKind
from app.models.coding import TestCaseVisibility
from app.models.question import Question, QuestionType
from app.schemas.coding import (
    CandidateCodingQuestion,
    CodingProgress,
    DraftIn,
    DraftOut,
    ExecutionOut,
    HiddenResultOut,
    RunRequest,
    SubmissionRow,
    SubmitRequest,
    TestResultOut,
    for_candidate,
)
from app.services.attempts import AttemptService
from app.services.coding.drafts import DraftService
from app.services.coding.execution import ExecutionService

router = APIRouter(
    prefix="/candidates/me/attempts/{attempt_id}/coding/{question_id}", tags=["candidate coding"]
)
progress_router = APIRouter(prefix="/candidates/me/attempts/{attempt_id}", tags=["candidate coding"])


def execution_out(execution: CodeExecution) -> ExecutionOut:
    """The candidate's view of an execution: per-test detail for sample tests and custom input only; each
    hidden test only as its number among the hidden tests and its verdict."""
    tests_by_id = {str(t.id): t for t in execution.problem_version.test_cases}
    shown: list[TestResultOut] = []
    hidden_passed = hidden_total = 0
    hidden: list[HiddenResultOut] = []
    results: list[dict[str, Any]] = execution.results or []
    for result in results:
        visibility = result.get("visibility")
        if visibility == "HIDDEN":
            hidden_total += 1
            hidden_passed += result.get("verdict") == "ACCEPTED"
            # Only the verdict: nothing that could reveal the test's data.
            hidden.append(HiddenResultOut(number=hidden_total, verdict=str(result.get("verdict", ""))))
            continue
        test = tests_by_id.get(str(result.get("test_id")))
        if visibility == "PUBLIC" and test is not None and test.visibility is TestCaseVisibility.PUBLIC:
            shown.append(
                TestResultOut(
                    number=result.get("number", 0),
                    visibility="PUBLIC",
                    verdict=result.get("verdict", ""),
                    input=test.input,
                    expected_output=test.expected_output,
                    stdout=result.get("stdout", ""),
                    stderr=result.get("stderr", ""),
                    runtime_ms=result.get("runtime_ms"),
                )
            )
        elif visibility == "CUSTOM":
            shown.append(
                TestResultOut(
                    number=1,
                    visibility="CUSTOM",
                    verdict=result.get("verdict", ""),
                    input=execution.custom_input or "",
                    expected_output=None,
                    stdout=result.get("stdout", ""),
                    stderr=result.get("stderr", ""),
                    runtime_ms=result.get("runtime_ms"),
                )
            )
    has_hidden = execution.kind is ExecutionKind.SUBMIT
    return ExecutionOut(
        id=execution.id,
        kind=execution.kind.value,
        status=execution.status.value,
        verdict=execution.verdict.value if execution.verdict else None,
        language=execution.language,
        passed=execution.passed,
        total=execution.total,
        runtime_ms=execution.runtime_ms,
        memory_kb=execution.memory_kb,
        compile_output=execution.compile_output,
        tests=shown,
        hidden_passed=hidden_passed if has_hidden and execution.is_finished else None,
        hidden_total=hidden_total if has_hidden and execution.is_finished else None,
        hidden_results=hidden if has_hidden and execution.is_finished else [],
        created_at=execution.created_at,
        completed_at=execution.completed_at,
    )


@router.get("", response_model=CandidateCodingQuestion)
def coding_question(
    attempt_id: uuid.UUID, question_id: uuid.UUID, user: CandidateUser, db: DbSession
) -> CandidateCodingQuestion:
    attempt = AttemptService(db).get_attempt(user, attempt_id)
    question = db.scalar(
        select(Question).where(Question.id == question_id, Question.assessment_id == attempt.assessment_id)
    )
    if question is None or question.type is not QuestionType.CODING or question.coding_version is None:
        raise NotFound("Coding question not found.")
    version = question.coding_version
    used = db.scalar(
        select(func.count())
        .select_from(CodeExecution)
        .where(
            CodeExecution.attempt_id == attempt.id,
            CodeExecution.question_id == question.id,
            CodeExecution.kind == ExecutionKind.SUBMIT,
        )
    )
    return CandidateCodingQuestion(
        question_id=question.id,
        marks=question.marks,
        problem=for_candidate(version, list(version.test_cases)),
        allow_custom_input=attempt.assessment.coding_allow_custom_input,
        max_submissions=attempt.assessment.coding_max_submissions,
        submissions_used=int(used or 0),
        draft=(lambda d: DraftOut.model_validate(d) if d else None)(
            DraftService(db).get(attempt.id, question.id)
        ),
    )


@router.put("/draft", response_model=DraftOut)
def save_draft(
    attempt_id: uuid.UUID, question_id: uuid.UUID, payload: DraftIn, user: CandidateUser, db: DbSession
) -> DraftOut:
    """Autosave. Refused (409 `draft_conflict`, with the current revision) if newer code was saved
    elsewhere."""
    draft = DraftService(db).save(
        user,
        attempt_id,
        question_id,
        language=payload.language,
        source=payload.source,
        base_revision=payload.base_revision,
    )
    return DraftOut.model_validate(draft)


@progress_router.get("/coding-progress", response_model=list[CodingProgress])
def coding_progress(attempt_id: uuid.UUID, user: CandidateUser, db: DbSession) -> list[CodingProgress]:
    """Each coding question's status for the navigator: facts only, never a score."""
    attempt = AttemptService(db).get_attempt(user, attempt_id)
    return [CodingProgress(**row) for row in DraftService(db).progress(attempt)]


@router.post("/runs", response_model=ExecutionOut, status_code=status.HTTP_201_CREATED)
def run(
    attempt_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: RunRequest,
    user: CandidateUser,
    db: DbSession,
    response: Response,
) -> ExecutionOut:
    execution, created = ExecutionService(db).request_run(
        user,
        attempt_id,
        question_id,
        language=payload.language,
        source=payload.source,
        custom_input=payload.custom_input,
        idempotency_key=payload.idempotency_key,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return execution_out(execution)


@router.post("/submissions", response_model=ExecutionOut, status_code=status.HTTP_201_CREATED)
def submit(
    attempt_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: SubmitRequest,
    user: CandidateUser,
    db: DbSession,
    response: Response,
) -> ExecutionOut:
    execution, created = ExecutionService(db).request_submit(
        user,
        attempt_id,
        question_id,
        language=payload.language,
        source=payload.source,
        idempotency_key=payload.idempotency_key,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return execution_out(execution)


@router.get("/executions/{execution_id}", response_model=ExecutionOut)
def execution(
    attempt_id: uuid.UUID, question_id: uuid.UUID, execution_id: uuid.UUID, user: CandidateUser, db: DbSession
) -> ExecutionOut:
    return execution_out(ExecutionService(db).for_candidate(user, attempt_id, question_id, execution_id))


@router.get("/submissions", response_model=list[SubmissionRow])
def submissions(
    attempt_id: uuid.UUID, question_id: uuid.UUID, user: CandidateUser, db: DbSession
) -> list[SubmissionRow]:
    rows = ExecutionService(db).submissions(user, attempt_id, question_id)
    return [
        SubmissionRow(
            id=e.id,
            number=len(rows) - i,
            language=e.language,
            status=e.status.value,
            verdict=e.verdict.value if e.verdict else None,
            passed=e.passed,
            total=e.total,
            runtime_ms=e.runtime_ms,
            memory_kb=e.memory_kb,
            created_at=e.created_at,
        )
        for i, e in enumerate(rows)
    ]

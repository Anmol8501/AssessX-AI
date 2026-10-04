"""The coding-problem library (stage C1): administrators only.

`AdminUser` on every route: a candidate gets 403, an anonymous request 401. Hidden test cases and the
reference solution appear only in these admin responses; `/preview` returns exactly what a candidate
would be shown (`CodingProblemForCandidate`), which has no field for either.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import AdminUser, DbSession
from app.core.errors import NotFound
from app.models.coding import CodingDifficulty, CodingProblem, CodingProblemVersion
from app.schemas.coding import (
    AdminExecutionOut,
    CodingProblemForCandidate,
    LanguagesOut,
    ProblemCreate,
    ProblemDetail,
    ProblemSummary,
    ProblemUpdate,
    TestCaseCreate,
    TestCaseOut,
    TestCaseUpdate,
    VersionOut,
    VersionUpdate,
    for_candidate,
    language_out,
    version_ref,
)
from app.services.coding.execution import ExecutionService
from app.services.coding.languages import LANGUAGES
from app.services.coding.problems import CodingProblemService, publish_issues

router = APIRouter(prefix="/coding-problems", tags=["coding problems"])


def _summary(service: CodingProblemService, problem: CodingProblem, used: dict[uuid.UUID, int]) -> dict:
    latest = service.latest_published(problem)
    draft = service.open_draft(problem)
    return {
        "id": problem.id,
        "slug": problem.slug,
        "is_enabled": problem.is_enabled,
        "created_at": problem.created_at,
        "created_by": problem.created_by.name,
        "latest": version_ref(latest) if latest else None,
        "draft": version_ref(draft) if draft else None,
        "used_in": used.get(problem.id, 0),
    }


def _detail(service: CodingProblemService, problem: CodingProblem) -> ProblemDetail:
    return ProblemDetail(
        **_summary(service, problem, service.usage([problem.id])),
        versions=[version_ref(v) for v in problem.versions],
    )


def _version(version: CodingProblemVersion) -> VersionOut:
    out = VersionOut.model_validate(version)
    out.issues = publish_issues(version) if not version.is_published else []
    return out


@router.get("/languages", response_model=LanguagesOut)
def languages(_: AdminUser) -> LanguagesOut:
    """The registry: what an administrator can enable, and each language's default starter code."""
    return LanguagesOut(
        languages=[language_out(lang) for lang in LANGUAGES],
        starters={lang.id: lang.starter for lang in LANGUAGES.values()},
    )


@router.get("", response_model=list[ProblemSummary])
def list_problems(
    _: AdminUser,
    db: DbSession,
    search: Annotated[str | None, Query(max_length=100)] = None,
    difficulty: CodingDifficulty | None = None,
    tag: Annotated[str | None, Query(max_length=30)] = None,
    language: Annotated[str | None, Query(max_length=20)] = None,
    published_only: bool = False,
    enabled_only: bool = False,
) -> list[ProblemSummary]:
    service = CodingProblemService(db)
    problems = service.list(
        search=search,
        difficulty=difficulty,
        tag=tag,
        language=language,
        published_only=published_only,
        enabled_only=enabled_only,
    )
    used = service.usage([p.id for p in problems])
    return [ProblemSummary(**_summary(service, p, used)) for p in problems]


@router.post("", response_model=ProblemDetail, status_code=status.HTTP_201_CREATED)
def create_problem(payload: ProblemCreate, admin: AdminUser, db: DbSession) -> ProblemDetail:
    service = CodingProblemService(db)
    return _detail(service, service.create(payload, admin))


@router.get("/{problem_id}", response_model=ProblemDetail)
def get_problem(problem_id: uuid.UUID, _: AdminUser, db: DbSession) -> ProblemDetail:
    service = CodingProblemService(db)
    return _detail(service, service.get(problem_id))


@router.patch("/{problem_id}", response_model=ProblemDetail)
def update_problem(
    problem_id: uuid.UUID, payload: ProblemUpdate, _: AdminUser, db: DbSession
) -> ProblemDetail:
    service = CodingProblemService(db)
    return _detail(service, service.update_problem(problem_id, is_enabled=payload.is_enabled))


@router.delete("/{problem_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_problem(problem_id: uuid.UUID, admin: AdminUser, db: DbSession) -> Response:
    CodingProblemService(db).delete(problem_id, admin)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -- versions ------------------------------------------------------------------------------------------


@router.post("/{problem_id}/versions", response_model=VersionOut, status_code=status.HTTP_201_CREATED)
def new_version(problem_id: uuid.UUID, admin: AdminUser, db: DbSession) -> VersionOut:
    """Starts the next draft as a copy of the newest version, so a published one never changes."""
    return _version(CodingProblemService(db).new_version(problem_id, admin))


@router.get("/{problem_id}/versions/{version_id}", response_model=VersionOut)
def get_version(problem_id: uuid.UUID, version_id: uuid.UUID, _: AdminUser, db: DbSession) -> VersionOut:
    return _version(CodingProblemService(db).version(problem_id, version_id))


@router.patch("/{problem_id}/versions/{version_id}", response_model=VersionOut)
def update_version(
    problem_id: uuid.UUID, version_id: uuid.UUID, payload: VersionUpdate, _: AdminUser, db: DbSession
) -> VersionOut:
    return _version(CodingProblemService(db).update_version(problem_id, version_id, payload))


@router.delete("/{problem_id}/versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_draft(problem_id: uuid.UUID, version_id: uuid.UUID, _: AdminUser, db: DbSession) -> Response:
    CodingProblemService(db).discard_draft(problem_id, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{problem_id}/versions/{version_id}/publish", response_model=VersionOut)
def publish_version(
    problem_id: uuid.UUID, version_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> VersionOut:
    return _version(CodingProblemService(db).publish(problem_id, version_id, admin))


@router.get("/{problem_id}/versions/{version_id}/preview", response_model=CodingProblemForCandidate)
def preview(
    problem_id: uuid.UUID, version_id: uuid.UUID, _: AdminUser, db: DbSession
) -> CodingProblemForCandidate:
    """Exactly what a candidate will be shown — the same function the candidate API uses."""
    version = CodingProblemService(db).version(problem_id, version_id)
    return for_candidate(version, list(version.test_cases))


# -- test cases ----------------------------------------------------------------------------------------


@router.post(
    "/{problem_id}/versions/{version_id}/test-cases",
    response_model=TestCaseOut,
    status_code=status.HTTP_201_CREATED,
)
def add_test(
    problem_id: uuid.UUID, version_id: uuid.UUID, payload: TestCaseCreate, _: AdminUser, db: DbSession
) -> TestCaseOut:
    return TestCaseOut.model_validate(CodingProblemService(db).add_test(problem_id, version_id, payload))


@router.patch("/{problem_id}/versions/{version_id}/test-cases/{test_id}", response_model=TestCaseOut)
def update_test(
    problem_id: uuid.UUID,
    version_id: uuid.UUID,
    test_id: uuid.UUID,
    payload: TestCaseUpdate,
    _: AdminUser,
    db: DbSession,
) -> TestCaseOut:
    return TestCaseOut.model_validate(
        CodingProblemService(db).update_test(problem_id, version_id, test_id, payload)
    )


@router.delete(
    "/{problem_id}/versions/{version_id}/test-cases/{test_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_test(
    problem_id: uuid.UUID, version_id: uuid.UUID, test_id: uuid.UUID, _: AdminUser, db: DbSession
) -> Response:
    CodingProblemService(db).delete_test(problem_id, version_id, test_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -- validation (stage C2) -----------------------------------------------------------------------------


def _admin_execution(execution) -> AdminExecutionOut:  # noqa: ANN001
    return AdminExecutionOut(
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
        results=execution.results or [],
        created_at=execution.created_at,
        completed_at=execution.completed_at,
    )


@router.post(
    "/{problem_id}/versions/{version_id}/validate",
    response_model=AdminExecutionOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def validate(
    problem_id: uuid.UUID, version_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> AdminExecutionOut:
    """Runs the reference solution against every test on the runner. When it passes them all, the version
    is marked validated (required to publish a version that has a reference solution)."""
    version = CodingProblemService(db).version(problem_id, version_id)
    return _admin_execution(ExecutionService(db).request_validation(admin, version))


@router.get("/{problem_id}/versions/{version_id}/validation", response_model=AdminExecutionOut)
def validation(
    problem_id: uuid.UUID, version_id: uuid.UUID, _: AdminUser, db: DbSession
) -> AdminExecutionOut:
    version = CodingProblemService(db).version(problem_id, version_id)
    execution = ExecutionService(db).latest_validation(version)
    if execution is None:
        raise NotFound("This version has not been validated yet.")
    return _admin_execution(execution)

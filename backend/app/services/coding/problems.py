"""The coding-problem library (stage C1): problems, their versions and test cases.

Rules the service enforces (the database backs the important ones):
* only a DRAFT version can be edited, and a problem has at most one draft at a time;
* a PUBLISHED version never changes again — "editing" a published problem starts the next draft as a
  copy of the newest version, test cases included;
* publishing checks the draft is complete (`publish_issues`), and from stage C2 that the reference
  solution passes every test on the runner;
* a problem whose versions are used by any assessment cannot be deleted.

Creating, versioning, publishing and deleting are audited (ids and counts only, never content).
"""

import logging
import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.coding import (
    CodingDifficulty,
    CodingProblem,
    CodingProblemVersion,
    CodingTestCase,
    CodingVersionStatus,
    TestCaseVisibility,
)
from app.models.question import Question
from app.models.user import User
from app.repositories.audit import AuditRepository
from app.schemas.coding import (
    MAX_TEST_CASES,
    ProblemCreate,
    TestCaseCreate,
    TestCaseUpdate,
    VersionUpdate,
)
from app.services.coding.languages import LANGUAGES

log = logging.getLogger("assessx.coding.problems")

#: A new problem starts with every registered language and its starter template.
DEFAULT_LANGUAGES = list(LANGUAGES)


def _slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:70].strip("-")
    return slug or "problem"


def publish_issues(version: CodingProblemVersion) -> list[str]:
    """Every reason this version cannot be published, in the order an administrator would fix them."""
    issues: list[str] = []
    if not version.title.strip():
        issues.append("Add a title.")
    if not version.statement.strip():
        issues.append("Write the problem statement.")
    languages = [lang for lang in version.languages if lang in LANGUAGES]
    if not languages:
        issues.append("Enable at least one language.")
    tests = version.test_cases
    if not any(t.visibility is TestCaseVisibility.PUBLIC for t in tests):
        issues.append("Add at least one public (sample) test case.")
    if not any(t.visibility is TestCaseVisibility.HIDDEN for t in tests):
        issues.append("Add at least one hidden test case.")
    if any(not t.expected_output.strip() for t in tests):
        issues.append("Every test case needs an expected output.")
    if len(tests) > MAX_TEST_CASES:
        issues.append(f"At most {MAX_TEST_CASES} test cases.")
    if version.reference_solution and version.reference_language not in languages:
        issues.append("The reference solution's language must be one of the enabled languages.")
    if version.reference_language and not (version.reference_solution or "").strip():
        issues.append("Add the reference solution, or clear its language.")
    if (
        version.reference_solution
        and get_settings().coding_execution_enabled
        and version.validated_at is None
    ):
        issues.append("Validate the test cases: run the reference solution against them.")
    return issues


class CodingProblemService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.audit = AuditRepository(db)

    def _record(self, actor: User, action: AuditAction, **details: object) -> None:
        self.audit.record(
            actor_id=actor.id, action=action, details={k: v for k, v in details.items() if v is not None}
        )
        log.info("Coding library", extra={"action": action.value})

    # -- reading -------------------------------------------------------------------------------------

    def get(self, problem_id: uuid.UUID) -> CodingProblem:
        problem = self.db.get(CodingProblem, problem_id)
        if problem is None:
            raise NotFound("Coding problem not found.")
        return problem

    def version(self, problem_id: uuid.UUID, version_id: uuid.UUID) -> CodingProblemVersion:
        version = self.db.scalar(
            select(CodingProblemVersion).where(
                CodingProblemVersion.id == version_id, CodingProblemVersion.problem_id == problem_id
            )
        )
        if version is None:
            raise NotFound("Version not found.")
        return version

    def draft(self, problem_id: uuid.UUID, version_id: uuid.UUID) -> CodingProblemVersion:
        version = self.version(problem_id, version_id)
        if version.status is not CodingVersionStatus.DRAFT:
            raise Conflict("A published version cannot change. Create a new version to edit it.")
        return version

    @staticmethod
    def latest_published(problem: CodingProblem) -> CodingProblemVersion | None:
        published = [v for v in problem.versions if v.status is CodingVersionStatus.PUBLISHED]
        return published[-1] if published else None

    @staticmethod
    def open_draft(problem: CodingProblem) -> CodingProblemVersion | None:
        return next((v for v in problem.versions if v.status is CodingVersionStatus.DRAFT), None)

    def usage(self, problem_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        """How many assessment questions pin a version of each problem, in one query."""
        if not problem_ids:
            return {}
        rows = self.db.execute(
            select(CodingProblemVersion.problem_id, func.count(Question.id))
            .join(Question, Question.coding_problem_version_id == CodingProblemVersion.id)
            .where(CodingProblemVersion.problem_id.in_(problem_ids))
            .group_by(CodingProblemVersion.problem_id)
        )
        return {problem_id: count for problem_id, count in rows.all()}

    def list(
        self,
        *,
        search: str | None = None,
        difficulty: CodingDifficulty | None = None,
        tag: str | None = None,
        language: str | None = None,
        published_only: bool = False,
        enabled_only: bool = False,
    ) -> list[CodingProblem]:
        """The library, newest first, filtered on the newest version of each problem."""
        problems = list(
            self.db.scalars(
                select(CodingProblem)
                .options(selectinload(CodingProblem.versions))
                .order_by(CodingProblem.created_at.desc())
            ).unique()
        )
        result: list[CodingProblem] = []
        needle = (search or "").strip().lower()
        for problem in problems:
            shown = (
                self.latest_published(problem)
                if published_only
                else (self.open_draft(problem) or self.latest_published(problem))
            )
            if shown is None or (enabled_only and not problem.is_enabled):
                continue
            if needle and needle not in shown.title.lower() and needle not in problem.slug:
                continue
            if difficulty and shown.difficulty is not difficulty:
                continue
            if tag and tag.lower() not in [t.lower() for t in shown.tags]:
                continue
            if language and language not in shown.languages:
                continue
            result.append(problem)
        return result

    # -- writing -------------------------------------------------------------------------------------

    def create(self, payload: ProblemCreate, admin: User) -> CodingProblem:
        slug = payload.slug or self._free_slug(_slugify(payload.title))
        if self.db.scalar(select(CodingProblem.id).where(CodingProblem.slug == slug)):
            raise Conflict("That slug is already used by another problem.")
        problem = CodingProblem(slug=slug, created_by=admin)
        problem.versions.append(
            CodingProblemVersion(
                version=1,
                status=CodingVersionStatus.DRAFT,
                title=payload.title,
                difficulty=payload.difficulty,
                tags=list(payload.tags),
                statement="",
                examples=[],
                languages=list(DEFAULT_LANGUAGES),
                starter_code={lang: LANGUAGES[lang].starter for lang in DEFAULT_LANGUAGES},
                time_limit_ms=2000,
                memory_limit_mb=256,
                default_points=10,
                partial_scoring=True,
                created_by_id=admin.id,
            )
        )
        try:
            with self.db.begin_nested():
                self.db.add(problem)
                self.db.flush()
        except IntegrityError as error:
            raise Conflict("That slug is already used by another problem.") from error
        self._record(admin, AuditAction.CODING_PROBLEM_CREATED, problem_id=str(problem.id))
        return problem

    def _free_slug(self, base: str) -> str:
        taken = set(
            self.db.scalars(
                select(CodingProblem.slug).where(
                    or_(CodingProblem.slug == base, CodingProblem.slug.like(f"{base}-%"))
                )
            )
        )
        if base not in taken:
            return base
        n = 2
        while f"{base}-{n}" in taken:
            n += 1
        return f"{base}-{n}"

    def update_problem(self, problem_id: uuid.UUID, *, is_enabled: bool | None) -> CodingProblem:
        problem = self.get(problem_id)
        if is_enabled is not None:
            problem.is_enabled = is_enabled
            self.db.flush()
        return problem

    def update_version(
        self, problem_id: uuid.UUID, version_id: uuid.UUID, payload: VersionUpdate
    ) -> CodingProblemVersion:
        version = self.draft(problem_id, version_id)
        changes = payload.model_dump(exclude_unset=True)
        if "examples" in changes:
            changes["examples"] = [e.model_dump() for e in payload.examples or []]
        for field, value in changes.items():
            setattr(version, field, value)
        # Keep the starter code in step with the enabled languages: a newly enabled language gets its
        # template, and nothing is kept for a language that is switched off.
        if "languages" in changes or "starter_code" in changes:
            starters = dict(version.starter_code)
            version.starter_code = {
                lang: starters.get(lang) or LANGUAGES[lang].starter for lang in version.languages
            }
        if version.reference_solution == "":
            version.reference_solution = None
        version.validated_at = None  # any change invalidates a previous validation
        self.db.flush()
        return version

    def add_test(
        self, problem_id: uuid.UUID, version_id: uuid.UUID, payload: TestCaseCreate
    ) -> CodingTestCase:
        version = self.draft(problem_id, version_id)
        if len(version.test_cases) >= MAX_TEST_CASES:
            raise ValidationFailed(f"A problem can have at most {MAX_TEST_CASES} test cases.")
        test = CodingTestCase(
            position=len(version.test_cases),
            visibility=payload.visibility,
            input=payload.input,
            expected_output=payload.expected_output,
            weight=payload.weight,
        )
        version.test_cases.append(test)
        version.validated_at = None
        self.db.flush()
        return test

    def update_test(
        self, problem_id: uuid.UUID, version_id: uuid.UUID, test_id: uuid.UUID, payload: TestCaseUpdate
    ) -> CodingTestCase:
        version = self.draft(problem_id, version_id)
        test = next((t for t in version.test_cases if t.id == test_id), None)
        if test is None:
            raise NotFound("Test case not found.")
        for field, value in payload.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(test, field, value)
        version.validated_at = None
        self.db.flush()
        return test

    def delete_test(self, problem_id: uuid.UUID, version_id: uuid.UUID, test_id: uuid.UUID) -> None:
        version = self.draft(problem_id, version_id)
        test = next((t for t in version.test_cases if t.id == test_id), None)
        if test is None:
            raise NotFound("Test case not found.")
        version.test_cases.remove(test)
        self.db.flush()
        # Compact positions (two passes so the unique (version, position) never collides).
        remaining = sorted(version.test_cases, key=lambda t: t.position)
        for i, t in enumerate(remaining):
            t.position = 10_000 + i
        self.db.flush()
        for i, t in enumerate(remaining):
            t.position = i
        version.validated_at = None
        self.db.flush()

    def new_version(self, problem_id: uuid.UUID, admin: User) -> CodingProblemVersion:
        """Starts the next draft as a copy of the newest version (test cases included)."""
        problem = self.get(problem_id)
        if self.open_draft(problem) is not None:
            raise Conflict("This problem already has a draft. Edit or publish it first.")
        source = problem.versions[-1]
        draft = CodingProblemVersion(
            version=source.version + 1,
            status=CodingVersionStatus.DRAFT,
            created_by_id=admin.id,
            **{
                field: getattr(source, field)
                for field in (
                    "title",
                    "difficulty",
                    "statement",
                    "constraints",
                    "input_format",
                    "output_format",
                    "time_limit_ms",
                    "memory_limit_mb",
                    "default_points",
                    "partial_scoring",
                    "reference_language",
                    "reference_solution",
                )
            },
            tags=list(source.tags),
            examples=[dict(e) for e in source.examples],
            languages=list(source.languages),
            starter_code=dict(source.starter_code),
        )
        draft.test_cases = [
            CodingTestCase(
                position=t.position,
                visibility=t.visibility,
                input=t.input,
                expected_output=t.expected_output,
                weight=t.weight,
            )
            for t in source.test_cases
        ]
        try:
            with self.db.begin_nested():
                problem.versions.append(draft)
                self.db.flush()
        except IntegrityError as error:
            raise Conflict("This problem already has a draft. Edit or publish it first.") from error
        self._record(
            admin, AuditAction.CODING_VERSION_CREATED, problem_id=str(problem.id), version=draft.version
        )
        return draft

    def publish(self, problem_id: uuid.UUID, version_id: uuid.UUID, admin: User) -> CodingProblemVersion:
        version = self.draft(problem_id, version_id)
        issues = publish_issues(version)
        if issues:
            raise ValidationFailed(
                "This version is not ready to publish.",
                details=[{"field": "version", "message": message} for message in issues],
            )
        version.status = CodingVersionStatus.PUBLISHED
        version.published_at = utcnow()
        self.db.flush()
        self._record(
            admin,
            AuditAction.CODING_VERSION_PUBLISHED,
            problem_id=str(problem_id),
            version=version.version,
            test_cases=len(version.test_cases),
        )
        return version

    def discard_draft(self, problem_id: uuid.UUID, version_id: uuid.UUID) -> None:
        """Throws away a draft. The only draft of a never-published problem cannot be discarded —
        delete the problem instead."""
        version = self.draft(problem_id, version_id)
        problem = self.get(problem_id)
        if len(problem.versions) == 1:
            raise Conflict("This is the problem's only version. Delete the problem instead.")
        problem.versions.remove(version)
        self.db.flush()

    def delete(self, problem_id: uuid.UUID, admin: User) -> None:
        problem = self.get(problem_id)
        if self.usage([problem.id]).get(problem.id):
            raise Conflict(
                "This problem is used in an assessment, so it cannot be deleted. Disable it instead."
            )
        self.db.delete(problem)
        self.db.flush()
        self._record(admin, AuditAction.CODING_PROBLEM_DELETED, problem_id=str(problem_id))

"""Coding problems (stage C1): request and response shapes.

Two audiences, kept apart by type rather than by filtering:
* administrators get everything, including hidden test cases and the reference solution;
* `CodingProblemForCandidate` is the *only* shape a candidate (or the admin's "preview as candidate")
  ever receives. It has no field for hidden tests or the reference solution, so neither can leak through
  it by accident.

Requests are strict: unknown fields are refused, and languages are checked against the registry.
"""

import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.coding import (
    CodingDifficulty,
    CodingProblemVersion,
    CodingTestCase,
    CodingVersionStatus,
    TestCaseVisibility,
)
from app.services.coding.languages import LANGUAGES

MAX_STATEMENT = 20_000
MAX_SECTION = 5_000
MAX_EXAMPLE = 2_000
MAX_STARTER = 20_000
MAX_SOURCE = 65_536
MAX_TEST_DATA = 65_536
MAX_TAGS = 10
MAX_EXAMPLES = 10
MAX_TEST_CASES = 50
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
Section = Annotated[str, StringConstraints(max_length=MAX_SECTION)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _tags(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    seen: list[str] = []
    for tag in value:
        if tag.lower() not in [t.lower() for t in seen]:
            seen.append(tag)
    return seen


def _languages(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    unknown = [lang for lang in value if lang not in LANGUAGES]
    if unknown:
        raise ValueError(f"Unsupported language: {unknown[0]}.")
    return list(dict.fromkeys(value))


class Example(_Strict):
    input: Annotated[str, StringConstraints(max_length=MAX_EXAMPLE)]
    output: Annotated[str, StringConstraints(max_length=MAX_EXAMPLE)]
    explanation: Annotated[str, StringConstraints(max_length=MAX_EXAMPLE)] | None = None


class ProblemCreate(_Strict):
    title: Title
    #: Optional: derived from the title when omitted. Lowercase letters, digits and hyphens.
    slug: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80)] | None = None
    difficulty: CodingDifficulty = CodingDifficulty.EASY
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_TAGS)

    _clean_tags = field_validator("tags")(_tags)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        if value is not None and not SLUG.match(value):
            raise ValueError("Use lowercase letters, digits and single hyphens.")
        return value


class ProblemUpdate(_Strict):
    is_enabled: bool | None = None


class VersionUpdate(_Strict):
    """Edits a DRAFT version. Every field optional: a PATCH changes only what it sends."""

    title: Title | None = None
    difficulty: CodingDifficulty | None = None
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS)
    statement: Annotated[str, StringConstraints(max_length=MAX_STATEMENT)] | None = None
    constraints: Section | None = None
    input_format: Section | None = None
    output_format: Section | None = None
    examples: list[Example] | None = Field(default=None, max_length=MAX_EXAMPLES)
    languages: list[str] | None = Field(default=None, min_length=1, max_length=len(LANGUAGES))
    starter_code: dict[str, Annotated[str, StringConstraints(max_length=MAX_STARTER)]] | None = None
    time_limit_ms: int | None = Field(default=None, ge=100, le=10_000)
    memory_limit_mb: int | None = Field(default=None, ge=32, le=1024)
    default_points: int | None = Field(default=None, ge=1, le=100)
    partial_scoring: bool | None = None
    reference_language: str | None = None
    reference_solution: Annotated[str, StringConstraints(max_length=MAX_SOURCE)] | None = None

    _clean_tags = field_validator("tags")(_tags)
    _clean_languages = field_validator("languages")(_languages)

    @field_validator("starter_code")
    @classmethod
    def _starter_languages(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is not None:
            _languages(list(value))
        return value

    @field_validator("reference_language")
    @classmethod
    def _reference_language(cls, value: str | None) -> str | None:
        if value is not None:
            _languages([value])
        return value


class TestCaseCreate(_Strict):
    visibility: TestCaseVisibility
    input: Annotated[str, StringConstraints(max_length=MAX_TEST_DATA)] = ""
    expected_output: Annotated[str, StringConstraints(max_length=MAX_TEST_DATA)]
    weight: int = Field(default=1, ge=1, le=100)


class TestCaseUpdate(_Strict):
    visibility: TestCaseVisibility | None = None
    input: Annotated[str, StringConstraints(max_length=MAX_TEST_DATA)] | None = None
    expected_output: Annotated[str, StringConstraints(max_length=MAX_TEST_DATA)] | None = None
    weight: int | None = Field(default=None, ge=1, le=100)


# -- responses (administrators) ------------------------------------------------------------------------


class TestCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position: int
    visibility: TestCaseVisibility
    input: str
    expected_output: str
    weight: int


class LanguageOut(BaseModel):
    id: str
    name: str
    version: str


def language_out(language_id: str) -> LanguageOut:
    lang = LANGUAGES[language_id]
    return LanguageOut(id=lang.id, name=lang.name, version=lang.version)


class VersionOut(BaseModel):
    """A version as administrators see it: everything, including hidden tests and the reference."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    problem_id: uuid.UUID
    version: int
    status: CodingVersionStatus
    title: str
    difficulty: CodingDifficulty
    tags: list[str]
    statement: str
    constraints: str | None
    input_format: str | None
    output_format: str | None
    examples: list[dict]
    languages: list[str]
    starter_code: dict[str, str]
    time_limit_ms: int
    memory_limit_mb: int
    default_points: int
    partial_scoring: bool
    reference_language: str | None
    reference_solution: str | None
    validated_at: datetime | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    test_cases: list[TestCaseOut]
    #: Why this draft cannot be published yet (empty when it can, and for a published version).
    issues: list[str] = []


class VersionRef(BaseModel):
    """A version in a list: enough to recognise it."""

    id: uuid.UUID
    version: int
    status: CodingVersionStatus
    title: str
    difficulty: CodingDifficulty
    tags: list[str]
    languages: list[str]
    published_at: datetime | None


def version_ref(version: CodingProblemVersion) -> VersionRef:
    return VersionRef(
        id=version.id,
        version=version.version,
        status=version.status,
        title=version.title,
        difficulty=version.difficulty,
        tags=list(version.tags),
        languages=list(version.languages),
        published_at=version.published_at,
    )


class ProblemSummary(BaseModel):
    """One row of the library: the newest published version (if any) and the open draft (if any)."""

    id: uuid.UUID
    slug: str
    is_enabled: bool
    created_at: datetime
    created_by: str
    latest: VersionRef | None
    draft: VersionRef | None
    #: How many assessment questions pin any version of this problem.
    used_in: int


class ProblemDetail(ProblemSummary):
    versions: list[VersionRef]


# -- the candidate's view (and the admin's "preview as candidate") ---------------------------------------


class PublicTestCase(BaseModel):
    number: int
    input: str
    expected_output: str


class CodingProblemForCandidate(BaseModel):
    """What a candidate is shown. Built only from public data: there is no field that could carry a
    hidden test or the reference solution."""

    title: str
    difficulty: CodingDifficulty
    tags: list[str]
    statement: str
    constraints: str | None
    input_format: str | None
    output_format: str | None
    examples: list[Example]
    languages: list[LanguageOut]
    starter_code: dict[str, str]
    time_limit_ms: int
    memory_limit_mb: int
    sample_tests: list[PublicTestCase]
    #: Only the number of hidden tests — never their contents.
    hidden_test_count: int


def for_candidate(version: CodingProblemVersion, tests: list[CodingTestCase]) -> CodingProblemForCandidate:
    public = [t for t in tests if t.visibility is TestCaseVisibility.PUBLIC]
    return CodingProblemForCandidate(
        title=version.title,
        difficulty=version.difficulty,
        tags=list(version.tags),
        statement=version.statement,
        constraints=version.constraints,
        input_format=version.input_format,
        output_format=version.output_format,
        examples=[Example.model_validate(e) for e in version.examples],
        languages=[language_out(lang) for lang in version.languages if lang in LANGUAGES],
        starter_code={
            lang: version.starter_code.get(lang, LANGUAGES[lang].starter)
            for lang in version.languages
            if lang in LANGUAGES
        },
        time_limit_ms=version.time_limit_ms,
        memory_limit_mb=version.memory_limit_mb,
        sample_tests=[
            PublicTestCase(number=i, input=t.input, expected_output=t.expected_output)
            for i, t in enumerate(public, start=1)
        ],
        hidden_test_count=len(tests) - len(public),
    )


class LanguagesOut(BaseModel):
    languages: list[LanguageOut]
    starters: dict[str, str]


class CodingQuestionCreate(_Strict):
    """Adds a published coding problem version to an assessment."""

    problem_version_id: uuid.UUID
    #: Defaults to the version's suggested points.
    marks: int | None = Field(default=None, gt=0, le=100)


class CodingQuestionVersion(_Strict):
    """Moves a coding question to another published version of the same problem."""

    problem_version_id: uuid.UUID


VisibilityFilter = Literal["published", "draft", "all"]


# -- execution (stage C2) --------------------------------------------------------------------------------

IdempotencyKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{8,64}$")]
LanguageId = Annotated[str, StringConstraints(min_length=1, max_length=20)]
Source = Annotated[str, StringConstraints(min_length=1, max_length=MAX_SOURCE)]


class RunRequest(_Strict):
    language: LanguageId
    source: Source
    #: Only when the assessment allows custom input; otherwise the sample tests are used.
    custom_input: Annotated[str, StringConstraints(max_length=MAX_TEST_DATA)] | None = None
    #: A retry with the same key returns the original run instead of starting another.
    idempotency_key: IdempotencyKey | None = None


class SubmitRequest(_Strict):
    language: LanguageId
    source: Source
    idempotency_key: IdempotencyKey | None = None


class TestResultOut(BaseModel):
    """One test's result as a candidate sees it: sample tests and their own input only."""

    number: int
    visibility: Literal["PUBLIC", "CUSTOM"]
    verdict: str
    input: str
    expected_output: str | None
    stdout: str
    stderr: str
    runtime_ms: int | None


class HiddenResultOut(BaseModel):
    """One hidden test as a candidate sees it: its number among the hidden tests and its verdict (passed,
    wrong answer, time limit exceeded, …). Never its input, expected output, the program's output or
    errors, or its runtime."""

    model_config = ConfigDict(extra="forbid")

    number: int
    verdict: str


class ExecutionOut(BaseModel):
    """A run or submission as its candidate sees it. Sample tests in full; hidden tests only as a
    numbered verdict each, plus the counts."""

    id: uuid.UUID
    kind: str
    status: str
    verdict: str | None
    language: str
    passed: int | None
    total: int | None
    runtime_ms: int | None
    memory_kb: int | None
    compile_output: str | None
    tests: list[TestResultOut]
    hidden_passed: int | None
    hidden_total: int | None
    #: Submissions only, once judged: each hidden test's verdict, in order ("Hidden test 1", 2, …).
    hidden_results: list[HiddenResultOut] = Field(default_factory=list)
    created_at: datetime
    completed_at: datetime | None


class SubmissionRow(BaseModel):
    id: uuid.UUID
    number: int
    language: str
    status: str
    verdict: str | None
    passed: int | None
    total: int | None
    runtime_ms: int | None
    memory_kb: int | None
    created_at: datetime


class AdminExecutionOut(BaseModel):
    """An execution as administrators see it: every test, hidden ones included."""

    id: uuid.UUID
    kind: str
    status: str
    verdict: str | None
    language: str
    passed: int | None
    total: int | None
    runtime_ms: int | None
    memory_kb: int | None
    compile_output: str | None
    results: list[dict]
    created_at: datetime
    completed_at: datetime | None


class CandidateCodingQuestion(BaseModel):
    """What the candidate's coding page loads: the problem (public data only) and the policies."""

    question_id: uuid.UUID
    marks: int
    problem: CodingProblemForCandidate
    allow_custom_input: bool
    max_submissions: int
    submissions_used: int
    #: The candidate's autosaved code for this question, if any.
    draft: "DraftOut | None" = None


# -- the runner's protocol -------------------------------------------------------------------------------

RunnerId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.-]{1,64}$")]
_RAW = 70_000


class ClaimRequest(_Strict):
    runner_id: RunnerId


class RunnerCompile(_Strict):
    ok: bool
    output: Annotated[str, StringConstraints(max_length=_RAW)] = ""


class RunnerTest(_Strict):
    id: Annotated[str, StringConstraints(max_length=64)]
    outcome: Literal["OK", "RUNTIME_ERROR", "TIME_LIMIT", "MEMORY_LIMIT", "OUTPUT_LIMIT", "ERROR"]
    exit_code: int | None = None
    runtime_ms: int | None = Field(default=None, ge=0, le=600_000)
    stdout: Annotated[str, StringConstraints(max_length=_RAW)] = ""
    stderr: Annotated[str, StringConstraints(max_length=_RAW)] = ""


class RunnerReport(_Strict):
    runner_id: RunnerId
    compile: RunnerCompile | None = None
    tests: list[RunnerTest] = Field(default_factory=list, max_length=MAX_TEST_CASES)
    memory_kb: int | None = Field(default=None, ge=0, le=16_777_216)
    #: Set when the runner could not run the job at all (infrastructure, not the candidate's code).
    error: Annotated[str, StringConstraints(max_length=500)] | None = None


# -- drafts and progress (stage C3) ----------------------------------------------------------------------


class DraftIn(_Strict):
    language: LanguageId
    #: May be empty (the candidate cleared the editor).
    source: Annotated[str, StringConstraints(max_length=MAX_SOURCE)]
    #: The revision this save started from (0 or omitted for the first save).
    base_revision: int | None = Field(default=None, ge=0)


class DraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    language: str
    source: str
    revision: int
    updated_at: datetime


class CodingProgress(BaseModel):
    question_id: uuid.UUID
    status: Literal["NOT_STARTED", "IN_PROGRESS", "PENDING", "PASSED", "NOT_PASSED"]
    submissions: int
    best_passed: int | None
    total: int | None


CandidateCodingQuestion.model_rebuild()


# -- analytics (stage C4) -------------------------------------------------------------------------------


class QuestionAnalytics(BaseModel):
    question_id: uuid.UUID
    number: int
    coding_number: int
    title: str
    marks: int
    candidates_attempted: int
    submissions: int
    #: Accepted submissions as a share of judged submissions (%).
    acceptance_rate: Decimal | None
    #: Candidates with an accepted submission as a share of those who submitted (%).
    solved_rate: Decimal | None
    average_score: Decimal | None
    average_runtime_ms: Decimal | None
    languages: dict[str, int]
    common_failure: str | None


class CandidateProblem(BaseModel):
    question_id: uuid.UUID
    submissions: int
    best_verdict: str | None
    best_passed: int | None
    total: int | None
    marks: int | None


class CandidateAnalytics(BaseModel):
    attempt_id: uuid.UUID
    candidate_name: str
    attempt_number: int
    problems_attempted: int
    submissions: int
    languages: list[str]
    pass_rate: Decimal | None
    coding_score: int | None
    coding_maximum: int | None
    problems: list[CandidateProblem]


class AnalyticsSummary(BaseModel):
    results: int
    mcq_average: Decimal | None
    mcq_maximum: int | None
    coding_average: Decimal | None
    coding_maximum: int | None
    total_average: Decimal | None
    total_maximum: int | None


class CodingAnalytics(BaseModel):
    """Facts only. Candidates are listed by name, never ranked."""

    assessment_id: uuid.UUID
    questions: list[QuestionAnalytics]
    candidates: list[CandidateAnalytics]
    summary: AnalyticsSummary

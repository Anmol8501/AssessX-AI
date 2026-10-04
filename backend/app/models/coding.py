"""Coding problems (coding assessments, stage C1): a reusable library of problems with immutable versions.

* `CodingProblem` is the library entry: a stable slug and who created it.
* `CodingProblemVersion` is everything a candidate is examined on — title, statement, limits, languages,
  starter code, scoring and test cases. A DRAFT version is editable; a PUBLISHED version never changes
  again. Editing a published problem means creating the next draft version. An assessment question pins
  one published version, so an attempt is never affected by later edits.
* `CodingTestCase` belongs to one version. PUBLIC cases are the samples a candidate may run against;
  HIDDEN cases are only ever read by the server and the runner. The reference solution is admin-only.

Nothing here runs code: execution belongs to the separate runner (stage C2).
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User


class CodingDifficulty(enum.StrEnum):
    EASY = "EASY"
    MEDIUM = "MEDIUM"
    HARD = "HARD"


class CodingVersionStatus(enum.StrEnum):
    #: Editable by administrators; never used by an assessment.
    DRAFT = "DRAFT"
    #: Frozen: what assessments pin and candidates are examined on.
    PUBLISHED = "PUBLISHED"


class TestCaseVisibility(enum.StrEnum):
    #: A sample: shown to the candidate and used by Run.
    PUBLIC = "PUBLIC"
    #: Never sent to a candidate; only the server and the runner read it.
    HIDDEN = "HIDDEN"


class CodingProblem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "coding_problems"

    #: Stable, URL-safe identifier, unique across the library.
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    #: A disabled problem stays in the library (and in assessments that pin it) but cannot be added to
    #: new assessments.
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    created_by: Mapped["User"] = relationship(lazy="joined")
    versions: Mapped[list["CodingProblemVersion"]] = relationship(
        back_populates="problem",
        cascade="all, delete-orphan",
        order_by="CodingProblemVersion.version",
        passive_deletes=True,
    )


class CodingProblemVersion(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "coding_problem_versions"
    __table_args__ = (
        UniqueConstraint("problem_id", "version", name="uq_coding_versions_problem_version"),
        # At most one editable draft per problem.
        Index(
            "uq_coding_versions_one_draft",
            "problem_id",
            unique=True,
            postgresql_where=text("status = 'DRAFT'"),
        ),
        CheckConstraint("version > 0", name="ck_coding_versions_version_positive"),
        CheckConstraint("status IN ('DRAFT', 'PUBLISHED')", name="ck_coding_versions_status"),
        CheckConstraint("difficulty IN ('EASY', 'MEDIUM', 'HARD')", name="ck_coding_versions_difficulty"),
        CheckConstraint("time_limit_ms BETWEEN 100 AND 10000", name="ck_coding_versions_time_limit"),
        CheckConstraint("memory_limit_mb BETWEEN 32 AND 1024", name="ck_coding_versions_memory_limit"),
        CheckConstraint("default_points BETWEEN 1 AND 100", name="ck_coding_versions_points"),
        CheckConstraint(
            "(status = 'PUBLISHED') = (published_at IS NOT NULL)", name="ck_coding_versions_published_at"
        ),
    )

    problem_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("coding_problems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[CodingVersionStatus] = mapped_column(
        Enum(
            CodingVersionStatus,
            name="coding_version_status",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
        default=CodingVersionStatus.DRAFT,
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    difficulty: Mapped[CodingDifficulty] = mapped_column(
        Enum(CodingDifficulty, name="coding_difficulty", native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=CodingDifficulty.EASY,
    )
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    statement: Mapped[str] = mapped_column(Text, nullable=False, default="")
    constraints: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_format: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_format: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Worked examples shown with the statement: [{"input", "output", "explanation"}].
    examples: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    #: Language ids (see app/services/coding/languages.py) a candidate may choose.
    languages: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    #: {language id: starter source}.
    starter_code: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    time_limit_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=2000)
    memory_limit_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=256)
    #: The marks suggested when the problem is added to an assessment (the assessment's own marks rule).
    default_points: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    #: Partial credit by the share of test weight passed; otherwise all-or-nothing.
    partial_scoring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: Admin-only. Never part of any candidate-facing shape.
    reference_language: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reference_solution: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: When the reference solution last passed every test on the runner (stage C2). None until then.
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    problem: Mapped[CodingProblem] = relationship(back_populates="versions")
    test_cases: Mapped[list["CodingTestCase"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
        order_by="CodingTestCase.position",
        passive_deletes=True,
    )

    @property
    def is_published(self) -> bool:
        return self.status is CodingVersionStatus.PUBLISHED


class CodingTestCase(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "coding_test_cases"
    __table_args__ = (
        UniqueConstraint("version_id", "position", name="uq_coding_test_cases_version_position"),
        CheckConstraint("position >= 0", name="ck_coding_test_cases_position"),
        CheckConstraint("weight BETWEEN 1 AND 100", name="ck_coding_test_cases_weight"),
        CheckConstraint("visibility IN ('PUBLIC', 'HIDDEN')", name="ck_coding_test_cases_visibility"),
        CheckConstraint("char_length(input) <= 65536", name="ck_coding_test_cases_input_size"),
        CheckConstraint("char_length(expected_output) <= 65536", name="ck_coding_test_cases_output_size"),
    )

    version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("coding_problem_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    visibility: Mapped[TestCaseVisibility] = mapped_column(
        Enum(
            TestCaseVisibility,
            name="test_case_visibility",
            native_enum=False,
            length=10,
            validate_strings=True,
        ),
        nullable=False,
    )
    input: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expected_output: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: Share of the problem's score this case carries under partial scoring.
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    version: Mapped[CodingProblemVersion] = relationship(back_populates="test_cases")

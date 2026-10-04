"""Coding assessments, stage C1: assessment type, the coding-problem library, coding questions

* `assessments.assessment_type` (MCQ | CODING | MIXED), default MCQ, so every existing assessment keeps
  behaving as before.
* `coding_problems`, `coding_problem_versions` (immutable once published) and `coding_test_cases`
  (PUBLIC | HIDDEN). RLS is enabled with no policies on the new tables only (the API connects as their
  owner; this closes them to Supabase's public API roles). Existing tables are not touched.
* `questions.coding_problem_version_id` (RESTRICT) with a CHECK that exactly the CODING questions pin a
  version. The question type column has no database CHECK, so CODING needs no change there.
* The audit-action CHECK is widened with the four coding-library actions; the downgrade removes those
  rows first (the append-only trigger disabled only for that statement).

Revision ID: 0020
Revises: 0019
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0019 = (
    "REVIEW_STARTED",
    "REVIEW_NOTE_ADDED",
    "REVIEW_EVIDENCE_MARKED",
    "REVIEW_COMPLETED",
    "REVIEW_REVISED",
    "INTERVIEW_CREATED",
    "INTERVIEW_UPDATED",
    "INTERVIEW_DELETED",
    "INTERVIEW_PUBLISHED",
    "INTERVIEW_UNPUBLISHED",
    "INTERVIEW_QUESTION_CREATED",
    "INTERVIEW_QUESTION_UPDATED",
    "INTERVIEW_QUESTION_DELETED",
    "INTERVIEW_QUESTIONS_REORDERED",
    "INTERVIEW_ASSIGNED",
    "INTERVIEW_UNASSIGNED",
    "INTERVIEW_SESSION_STARTED",
    "INTERVIEW_ANSWER_SUBMITTED",
    "INTERVIEW_SESSION_COMPLETED",
    "INTERVIEW_EVALUATION_REQUESTED",
    "INTERVIEW_EVALUATION_COMPLETED",
    "INTERVIEW_EVALUATION_FAILED",
    "INTERVIEW_EVALUATION_RETRIED",
    "INTERVIEW_ADAPTIVE_DECISION",
    "INTERVIEW_REVIEW_STARTED",
    "INTERVIEW_REVIEW_NOTE_ADDED",
    "INTERVIEW_REVIEW_ANSWER_MARKED",
    "INTERVIEW_REVIEW_COMPLETED",
    "INTERVIEW_REVIEW_REVISED",
    "INTERVIEW_CALL_OPENED",
    "INTERVIEW_CALL_JOINED",
    "INTERVIEW_CALL_ENDED",
    "INTERVIEW_CALL_NOTE_ADDED",
    "ATTEMPT_HELD",
    "ATTEMPT_RELEASED",
    "ATTEMPT_ENDED_BY_ADMIN",
)
ACTIONS_C1 = (
    "CODING_PROBLEM_CREATED",
    "CODING_PROBLEM_DELETED",
    "CODING_VERSION_CREATED",
    "CODING_VERSION_PUBLISHED",
)
NEW_TABLES = ("coding_problems", "coding_problem_versions", "coding_test_cases")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column("assessment_type", sa.String(length=10), nullable=False, server_default="MCQ"),
    )
    op.create_check_constraint(
        "ck_assessments_type", "assessments", _in("assessment_type", ("MCQ", "CODING", "MIXED"))
    )

    op.create_table(
        "coding_problems",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(length=80), nullable=False, unique=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_coding_problems_created_by_id", "coding_problems", ["created_by_id"])

    op.create_table(
        "coding_problem_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "problem_id", sa.Uuid(), sa.ForeignKey("coding_problems.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("difficulty", sa.String(length=10), nullable=False),
        sa.Column("tags", JSONB(), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("constraints", sa.Text(), nullable=True),
        sa.Column("input_format", sa.Text(), nullable=True),
        sa.Column("output_format", sa.Text(), nullable=True),
        sa.Column("examples", JSONB(), nullable=False),
        sa.Column("languages", JSONB(), nullable=False),
        sa.Column("starter_code", JSONB(), nullable=False),
        sa.Column("time_limit_ms", sa.Integer(), nullable=False),
        sa.Column("memory_limit_mb", sa.Integer(), nullable=False),
        sa.Column("default_points", sa.Integer(), nullable=False),
        sa.Column("partial_scoring", sa.Boolean(), nullable=False),
        sa.Column("reference_language", sa.String(length=20), nullable=True),
        sa.Column("reference_solution", sa.Text(), nullable=True),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("problem_id", "version", name="uq_coding_versions_problem_version"),
        sa.CheckConstraint("version > 0", name="ck_coding_versions_version_positive"),
        sa.CheckConstraint("status IN ('DRAFT', 'PUBLISHED')", name="ck_coding_versions_status"),
        sa.CheckConstraint("difficulty IN ('EASY', 'MEDIUM', 'HARD')", name="ck_coding_versions_difficulty"),
        sa.CheckConstraint("time_limit_ms BETWEEN 100 AND 10000", name="ck_coding_versions_time_limit"),
        sa.CheckConstraint("memory_limit_mb BETWEEN 32 AND 1024", name="ck_coding_versions_memory_limit"),
        sa.CheckConstraint("default_points BETWEEN 1 AND 100", name="ck_coding_versions_points"),
        sa.CheckConstraint(
            "(status = 'PUBLISHED') = (published_at IS NOT NULL)", name="ck_coding_versions_published_at"
        ),
    )
    op.create_index("ix_coding_problem_versions_problem_id", "coding_problem_versions", ["problem_id"])
    op.create_index(
        "uq_coding_versions_one_draft",
        "coding_problem_versions",
        ["problem_id"],
        unique=True,
        postgresql_where=sa.text("status = 'DRAFT'"),
    )

    op.create_table(
        "coding_test_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "version_id",
            sa.Uuid(),
            sa.ForeignKey("coding_problem_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("visibility", sa.String(length=10), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("expected_output", sa.Text(), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("version_id", "position", name="uq_coding_test_cases_version_position"),
        sa.CheckConstraint("position >= 0", name="ck_coding_test_cases_position"),
        sa.CheckConstraint("weight BETWEEN 1 AND 100", name="ck_coding_test_cases_weight"),
        sa.CheckConstraint("visibility IN ('PUBLIC', 'HIDDEN')", name="ck_coding_test_cases_visibility"),
        sa.CheckConstraint("char_length(input) <= 65536", name="ck_coding_test_cases_input_size"),
        sa.CheckConstraint("char_length(expected_output) <= 65536", name="ck_coding_test_cases_output_size"),
    )
    op.create_index("ix_coding_test_cases_version_id", "coding_test_cases", ["version_id"])

    op.add_column(
        "questions",
        sa.Column(
            "coding_problem_version_id",
            sa.Uuid(),
            sa.ForeignKey("coding_problem_versions.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index("ix_questions_coding_problem_version_id", "questions", ["coding_problem_version_id"])
    op.create_check_constraint(
        "ck_questions_coding_version",
        "questions",
        "(type = 'CODING') = (coding_problem_version_id IS NOT NULL)",
    )

    for table in NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0019 + ACTIONS_C1))


def downgrade() -> None:
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE action LIKE 'CODING_%'")
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0019))

    # Coding questions cannot exist without the library they pin.
    op.execute("DELETE FROM questions WHERE type = 'CODING'")
    op.drop_constraint("ck_questions_coding_version", "questions", type_="check")
    op.drop_index("ix_questions_coding_problem_version_id", table_name="questions")
    op.drop_column("questions", "coding_problem_version_id")
    op.drop_table("coding_test_cases")
    op.drop_index("uq_coding_versions_one_draft", table_name="coding_problem_versions")
    op.drop_table("coding_problem_versions")
    op.drop_table("coding_problems")
    op.drop_constraint("ck_assessments_type", "assessments", type_="check")
    op.drop_column("assessments", "assessment_type")

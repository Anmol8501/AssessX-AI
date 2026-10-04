"""Coding assessments, stage C2: code executions (the job queue) and coding policies

* `code_executions` — one row per Run / Submit / Validate; also the queue the runner claims from
  (`FOR UPDATE SKIP LOCKED`, leased). Idempotency key unique per attempt. RLS enabled with no policies
  (new table only).
* `assessments.coding_allow_custom_input` (default false) and `coding_max_submissions` (default 20).

Revision ID: 0021
Revises: 0020
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column("coding_allow_custom_input", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "assessments", sa.Column("coding_max_submissions", sa.Integer(), nullable=False, server_default="20")
    )
    op.create_check_constraint(
        "ck_assessments_coding_max_submissions", "assessments", "coding_max_submissions BETWEEN 1 AND 1000"
    )

    op.create_table(
        "code_executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("verdict", sa.String(length=25), nullable=True),
        sa.Column(
            "attempt_id",
            sa.Uuid(),
            sa.ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("question_id", sa.Uuid(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=True),
        sa.Column(
            "problem_version_id",
            sa.Uuid(),
            sa.ForeignKey("coding_problem_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("language", sa.String(length=20), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("custom_input", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=True),
        sa.Column("passed", sa.Integer(), nullable=True),
        sa.Column("total", sa.Integer(), nullable=True),
        sa.Column("passed_weight", sa.Integer(), nullable=True),
        sa.Column("total_weight", sa.Integer(), nullable=True),
        sa.Column("runtime_ms", sa.Integer(), nullable=True),
        sa.Column("memory_kb", sa.Integer(), nullable=True),
        sa.Column("compile_output", sa.Text(), nullable=True),
        sa.Column("results", JSONB(), nullable=False),
        sa.Column("claimed_by", sa.String(length=64), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claim_count", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('RUN', 'SUBMIT', 'VALIDATE')", name="ck_code_executions_kind"),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')", name="ck_code_executions_status"
        ),
        sa.CheckConstraint("char_length(source) BETWEEN 1 AND 65536", name="ck_code_executions_source_size"),
        sa.CheckConstraint(
            "custom_input IS NULL OR char_length(custom_input) <= 65536", name="ck_code_executions_input_size"
        ),
        sa.CheckConstraint(
            "(kind = 'VALIDATE') = (attempt_id IS NULL AND question_id IS NULL)",
            name="ck_code_executions_scope",
        ),
        sa.CheckConstraint("claim_count >= 0", name="ck_code_executions_claims"),
    )
    op.create_index(
        "uq_code_executions_idempotency",
        "code_executions",
        ["attempt_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("attempt_id IS NOT NULL"),
    )
    op.create_index("ix_code_executions_queue", "code_executions", ["status", "created_at"])
    op.create_index(
        "ix_code_executions_attempt_question", "code_executions", ["attempt_id", "question_id", "created_at"]
    )
    op.create_index("ix_code_executions_problem_version_id", "code_executions", ["problem_version_id"])
    op.create_index("ix_code_executions_requested_by_id", "code_executions", ["requested_by_id"])
    op.execute("ALTER TABLE code_executions ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("code_executions")
    op.drop_constraint("ck_assessments_coding_max_submissions", "assessments", type_="check")
    op.drop_column("assessments", "coding_max_submissions")
    op.drop_column("assessments", "coding_allow_custom_input")

"""attempt_results

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-23

Phase 3C: the score of a finished attempt.

One row per attempt, enforced by a unique constraint rather than by the service alone, so a
second evaluation of the same attempt is impossible at the database level.

No backfill: attempts finalized before this migration are evaluated lazily the first time their
result is read, which keeps the migration free of business logic.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attempt_results",
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("maximum_score", sa.Integer(), nullable=False),
        # Exact decimal rather than float: a percentage decides pass/fail at the boundary and
        # must not drift.
        sa.Column("percentage", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("passing_marks", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("incorrect_count", sa.Integer(), nullable=False),
        sa.Column("unanswered_count", sa.Integer(), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attempt_id", name="uq_attempt_result_attempt"),
        sa.CheckConstraint("score >= 0", name="ck_results_score_non_negative"),
        sa.CheckConstraint("maximum_score >= 0", name="ck_results_maximum_non_negative"),
        sa.CheckConstraint("score <= maximum_score", name="ck_results_score_within_maximum"),
        sa.CheckConstraint("percentage >= 0 AND percentage <= 100", name="ck_results_percentage_range"),
        sa.CheckConstraint(
            "correct_count >= 0 AND incorrect_count >= 0 AND unanswered_count >= 0",
            name="ck_results_counts_non_negative",
        ),
    )
    op.create_index(
        op.f("ix_attempt_results_candidate_id"), "attempt_results", ["candidate_id"], unique=False
    )
    op.create_index(
        op.f("ix_attempt_results_assessment_id"), "attempt_results", ["assessment_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_attempt_results_assessment_id"), table_name="attempt_results")
    op.drop_index(op.f("ix_attempt_results_candidate_id"), table_name="attempt_results")
    op.drop_table("attempt_results")

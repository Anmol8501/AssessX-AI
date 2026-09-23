"""assessment settings and READY status

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-22

Phase 2B: exam settings on `assessments`, and a status check constraint that now admits READY.
Autogenerate does not detect CHECK constraints, so those are written by hand here.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assessments", sa.Column("max_attempts", sa.Integer(), server_default="1", nullable=False))
    op.add_column(
        "assessments", sa.Column("randomize_questions", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "assessments", sa.Column("randomize_options", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "assessments", sa.Column("show_results", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "assessments",
        sa.Column(
            "question_navigation",
            sa.Enum("FREE", "SEQUENTIAL", name="question_navigation", native_enum=False, length=20),
            server_default="FREE",
            nullable=False,
        ),
    )
    op.add_column("assessments", sa.Column("availability_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("assessments", sa.Column("availability_end", sa.DateTime(timezone=True), nullable=True))

    op.create_check_constraint("ck_assessments_max_attempts_positive", "assessments", "max_attempts > 0")
    op.create_check_constraint(
        "ck_assessments_availability_order",
        "assessments",
        "availability_start IS NULL OR availability_end IS NULL OR availability_end > availability_start",
    )
    # The status column had no database-level constraint; add one now that a second value exists.
    op.create_check_constraint("ck_assessments_status", "assessments", "status IN ('DRAFT', 'READY')")


def downgrade() -> None:
    op.drop_constraint("ck_assessments_status", "assessments", type_="check")
    op.drop_constraint("ck_assessments_availability_order", "assessments", type_="check")
    op.drop_constraint("ck_assessments_max_attempts_positive", "assessments", type_="check")
    # Anything already marked READY becomes a draft again: the column's only other value.
    op.execute("UPDATE assessments SET status = 'DRAFT' WHERE status = 'READY'")
    op.drop_column("assessments", "availability_end")
    op.drop_column("assessments", "availability_start")
    op.drop_column("assessments", "question_navigation")
    op.drop_column("assessments", "show_results")
    op.drop_column("assessments", "randomize_options")
    op.drop_column("assessments", "randomize_questions")
    op.drop_column("assessments", "max_attempts")

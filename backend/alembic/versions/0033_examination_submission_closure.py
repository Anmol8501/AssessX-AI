"""Examination submission and closure: snapshot, receipt, and exit authorization for Phase 3C

Revision ID: 0033
Revises: 0032
"""

import sqlalchemy as sa

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assessment_attempts", sa.Column("submission_id", sa.Uuid(), nullable=True))
    op.add_column("assessment_attempts", sa.Column("submission_type", sa.String(length=32), nullable=True))
    op.add_column("assessment_attempts", sa.Column("receipt_id", sa.String(length=64), nullable=True))
    op.add_column("assessment_attempts", sa.Column("snapshot_hash", sa.String(length=64), nullable=True))
    op.add_column("assessment_attempts", sa.Column("answer_snapshot", sa.JSON(), nullable=True))
    op.add_column(
        "assessment_attempts",
        sa.Column("exit_authorization_token_hash", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "assessment_attempts",
        sa.Column("closure_status", sa.String(length=32), server_default="ACTIVE", nullable=False),
    )
    op.add_column(
        "assessment_attempts", sa.Column("closure_completed_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.create_index(
        "ix_assessment_attempts_submission_id", "assessment_attempts", ["submission_id"], unique=True
    )
    op.create_index("ix_assessment_attempts_receipt_id", "assessment_attempts", ["receipt_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_assessment_attempts_receipt_id", table_name="assessment_attempts")
    op.drop_index("ix_assessment_attempts_submission_id", table_name="assessment_attempts")

    op.drop_column("assessment_attempts", "closure_completed_at")
    op.drop_column("assessment_attempts", "closure_status")
    op.drop_column("assessment_attempts", "exit_authorization_token_hash")
    op.drop_column("assessment_attempts", "answer_snapshot")
    op.drop_column("assessment_attempts", "snapshot_hash")
    op.drop_column("assessment_attempts", "receipt_id")
    op.drop_column("assessment_attempts", "submission_type")
    op.drop_column("assessment_attempts", "submission_id")

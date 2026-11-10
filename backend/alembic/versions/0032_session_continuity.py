"""Session continuity: answer revisions and attempt heartbeat tracking for Phase 3B

Revision ID: 0032
Revises: 0031
"""

import sqlalchemy as sa

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # AttemptAnswer: revision tracking and idempotency key
    op.add_column(
        "attempt_answers", sa.Column("client_revision", sa.Integer(), server_default="1", nullable=False)
    )
    op.add_column(
        "attempt_answers", sa.Column("server_revision", sa.Integer(), server_default="1", nullable=False)
    )
    op.add_column("attempt_answers", sa.Column("idempotency_key", sa.String(length=64), nullable=True))
    op.add_column("attempt_answers", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_attempt_answers_idempotency_key", "attempt_answers", ["idempotency_key"], unique=False
    )

    # AssessmentAttempt: heartbeat, dropout, and crash recovery tracking
    op.add_column(
        "assessment_attempts", sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "assessment_attempts", sa.Column("heartbeat_device_id", sa.String(length=128), nullable=True)
    )
    op.add_column(
        "assessment_attempts", sa.Column("heartbeat_network_quality", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "assessment_attempts",
        sa.Column("pending_sync_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "assessment_attempts",
        sa.Column("last_synced_revision", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "assessment_attempts", sa.Column("recovery_token_hash", sa.String(length=128), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("assessment_attempts", "recovery_token_hash")
    op.drop_column("assessment_attempts", "last_synced_revision")
    op.drop_column("assessment_attempts", "pending_sync_count")
    op.drop_column("assessment_attempts", "heartbeat_network_quality")
    op.drop_column("assessment_attempts", "heartbeat_device_id")
    op.drop_column("assessment_attempts", "last_heartbeat_at")

    op.drop_index("ix_attempt_answers_idempotency_key", table_name="attempt_answers")
    op.drop_column("attempt_answers", "synced_at")
    op.drop_column("attempt_answers", "idempotency_key")
    op.drop_column("attempt_answers", "server_revision")
    op.drop_column("attempt_answers", "client_revision")

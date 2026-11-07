"""Secondary camera proctoring: assessment settings and secondary_camera_sessions

Revision ID: 0030
Revises: 0029
"""

import sqlalchemy as sa

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add secondary camera columns to assessments
    op.add_column(
        "assessments",
        sa.Column(
            "secondary_camera_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "assessments",
        sa.Column(
            "secondary_camera_mandatory",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "assessments",
        sa.Column(
            "secondary_camera_orientation",
            sa.String(length=20),
            nullable=False,
            server_default="LANDSCAPE",
        ),
    )
    op.add_column(
        "assessments",
        sa.Column(
            "secondary_camera_grace_period_seconds",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
    )

    # 2. Create secondary_camera_sessions table
    op.create_table(
        "secondary_camera_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("pairing_token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("orientation", sa.String(length=20), nullable=False, server_default="LANDSCAPE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("streaming_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("device_info", sa.String(length=255), nullable=True),
        sa.Column("battery_level", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attempt_id", name="uq_secondary_camera_sessions_attempt_id"),
        sa.UniqueConstraint("pairing_token_hash", name="uq_secondary_camera_sessions_pairing_token_hash"),
    )
    op.create_index("ix_secondary_camera_sessions_status", "secondary_camera_sessions", ["status"])

    from app.core.db_security import secure_table

    for statement in secure_table("secondary_camera_sessions"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("secondary_camera_sessions")
    op.drop_column("assessments", "secondary_camera_grace_period_seconds")
    op.drop_column("assessments", "secondary_camera_orientation")
    op.drop_column("assessments", "secondary_camera_mandatory")
    op.drop_column("assessments", "secondary_camera_enabled")

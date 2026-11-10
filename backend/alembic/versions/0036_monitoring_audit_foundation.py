"""Phase 4C: monitoring access audit trail table.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-10

Creates monitoring_audit_events table for recording administrator live-monitoring views
and WebRTC stream authorization events.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "monitoring_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("administrator_id", sa.Uuid(), nullable=False),
        sa.Column("assessment_id", sa.Uuid(), nullable=True),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("proctoring_session_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["administrator_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["proctoring_session_id"], ["proctoring_sessions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitoring_audit_action", "monitoring_audit_events", ["action"])
    op.create_index(
        "ix_monitoring_audit_admin_time",
        "monitoring_audit_events",
        ["administrator_id", "created_at"],
    )
    op.create_index(
        "ix_monitoring_audit_attempt_time",
        "monitoring_audit_events",
        ["attempt_id", "created_at"],
    )

    from app.core.db_security import secure_table

    for statement in secure_table("monitoring_audit_events"):
        op.execute(statement)


def downgrade() -> None:
    from app.core.db_security import unsecure_table

    for statement in unsecure_table("monitoring_audit_events", keep_rls=False):
        op.execute(statement)

    op.drop_index("ix_monitoring_audit_attempt_time", table_name="monitoring_audit_events")
    op.drop_index("ix_monitoring_audit_admin_time", table_name="monitoring_audit_events")
    op.drop_index("ix_monitoring_audit_action", table_name="monitoring_audit_events")
    op.drop_table("monitoring_audit_events")

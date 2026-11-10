"""Remediation Stage 9: policy flags, token replay table, stream grants, event_type width.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-10

Aligns PostgreSQL schema with remediation fixes:
1. Adds `assessments.require_registered_device` (default false) so browser-mode
   and standard proctored workflows stay enabled without workstation provisioning.
2. Widens `proctoring_events.event_type` from VARCHAR(36) to VARCHAR(50) matching ORM.
3. Adds `consumed_activation_tokens` for single-use JTI replay prevention.
4. Adds `monitoring_stream_grants` for persisted stream grant expiration/revocation.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column(
            "require_registered_device",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.alter_column(
        "proctoring_events",
        "event_type",
        existing_type=sa.String(length=36),
        type_=sa.String(length=50),
        existing_nullable=False,
    )

    op.create_table(
        "consumed_activation_tokens",
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("device_identifier", sa.String(length=64), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("jti"),
    )
    op.create_index(
        "ix_consumed_activation_tokens_candidate_id",
        "consumed_activation_tokens",
        ["candidate_id"],
    )
    op.create_index(
        "ix_consumed_activation_tokens_assessment_id",
        "consumed_activation_tokens",
        ["assessment_id"],
    )
    op.create_index(
        "ix_consumed_activation_tokens_expires_at",
        "consumed_activation_tokens",
        ["expires_at"],
    )

    op.create_table(
        "monitoring_stream_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("administrator_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("proctoring_session_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["administrator_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proctoring_session_id"], ["proctoring_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monitoring_stream_grants_administrator_id",
        "monitoring_stream_grants",
        ["administrator_id"],
    )
    op.create_index(
        "ix_monitoring_stream_grants_attempt_id",
        "monitoring_stream_grants",
        ["attempt_id"],
    )
    op.create_index(
        "ix_monitoring_stream_grants_expires_at",
        "monitoring_stream_grants",
        ["expires_at"],
    )
    op.create_index(
        "ix_monitoring_stream_grants_admin_attempt",
        "monitoring_stream_grants",
        ["administrator_id", "attempt_id"],
    )

    from app.core.db_security import secure_table

    for statement in secure_table("consumed_activation_tokens"):
        op.execute(statement)
    for statement in secure_table("monitoring_stream_grants"):
        op.execute(statement)


def downgrade() -> None:
    from app.core.db_security import unsecure_table

    for statement in unsecure_table("monitoring_stream_grants", keep_rls=False):
        op.execute(statement)
    for statement in unsecure_table("consumed_activation_tokens", keep_rls=False):
        op.execute(statement)

    op.drop_index("ix_monitoring_stream_grants_admin_attempt", table_name="monitoring_stream_grants")
    op.drop_index("ix_monitoring_stream_grants_expires_at", table_name="monitoring_stream_grants")
    op.drop_index("ix_monitoring_stream_grants_attempt_id", table_name="monitoring_stream_grants")
    op.drop_index("ix_monitoring_stream_grants_administrator_id", table_name="monitoring_stream_grants")
    op.drop_table("monitoring_stream_grants")

    op.drop_index("ix_consumed_activation_tokens_expires_at", table_name="consumed_activation_tokens")
    op.drop_index("ix_consumed_activation_tokens_assessment_id", table_name="consumed_activation_tokens")
    op.drop_index("ix_consumed_activation_tokens_candidate_id", table_name="consumed_activation_tokens")
    op.drop_table("consumed_activation_tokens")

    op.alter_column(
        "proctoring_events",
        "event_type",
        existing_type=sa.String(length=50),
        type_=sa.String(length=36),
        existing_nullable=False,
    )

    op.drop_column("assessments", "require_registered_device")

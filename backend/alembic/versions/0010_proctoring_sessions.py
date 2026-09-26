"""proctoring_sessions, and assessments.proctoring_required

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-24

Phase 4A: the proctoring session that runs alongside a proctored exam attempt, and the single
assessment setting that decides whether new attempts are proctored.

Existing data is untouched: every assessment gets `proctoring_required = false`, so assessments
and attempts created before this migration keep behaving exactly as they did in Phase 3, and no
session rows are back-filled for attempts that were never proctored.

Autogenerate does not detect CHECK constraints, so those are written by hand here (as in 0004
and 0007).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEVICE_STATES = ("NOT_READY", "READY", "DENIED", "UNAVAILABLE")


def _device_state() -> sa.Enum:
    return sa.Enum(*DEVICE_STATES, name="device_state", native_enum=False, length=20)


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column("proctoring_required", sa.Boolean(), server_default="false", nullable=False),
    )

    op.create_table(
        "proctoring_sessions",
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "NOT_STARTED",
                "ACTIVE",
                "ENDED",
                name="proctoring_session_status",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("camera_state", _device_state(), nullable=False),
        sa.Column("microphone_state", _device_state(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("devices_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # One session per attempt. The unique constraint doubles as the lookup index.
        sa.UniqueConstraint("attempt_id"),
        sa.CheckConstraint(
            "status IN ('NOT_STARTED', 'ACTIVE', 'ENDED')", name="ck_proctoring_sessions_status"
        ),
        sa.CheckConstraint(
            "camera_state IN ('NOT_READY', 'READY', 'DENIED', 'UNAVAILABLE')",
            name="ck_proctoring_sessions_camera_state",
        ),
        sa.CheckConstraint(
            "microphone_state IN ('NOT_READY', 'READY', 'DENIED', 'UNAVAILABLE')",
            name="ck_proctoring_sessions_microphone_state",
        ),
        sa.CheckConstraint(
            "status = 'NOT_STARTED' OR status = 'ENDED' OR started_at IS NOT NULL",
            name="ck_proctoring_sessions_active_has_start",
        ),
        sa.CheckConstraint(
            "(status = 'ENDED') = (ended_at IS NOT NULL)",
            name="ck_proctoring_sessions_ended_iff_ended_at",
        ),
        sa.CheckConstraint(
            "status <> 'NOT_STARTED' OR started_at IS NULL",
            name="ck_proctoring_sessions_not_started_has_no_start",
        ),
        sa.CheckConstraint(
            "started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at",
            name="ck_proctoring_sessions_end_after_start",
        ),
    )
    op.create_index(op.f("ix_proctoring_sessions_status"), "proctoring_sessions", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_proctoring_sessions_status"), table_name="proctoring_sessions")
    op.drop_table("proctoring_sessions")
    op.drop_column("assessments", "proctoring_required")

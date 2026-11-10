"""Phase 4A: proctoring session foundation enhancements.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-09

Adds device selection, readiness audit, and hardware interruption tracking columns
to proctoring_sessions.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "proctoring_sessions",
        sa.Column("selected_camera_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "proctoring_sessions",
        sa.Column("selected_camera_label", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "proctoring_sessions",
        sa.Column("selected_microphone_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "proctoring_sessions",
        sa.Column("selected_microphone_label", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "proctoring_sessions",
        sa.Column("readiness_state", sa.String(length=64), server_default="NOT_CHECKED", nullable=True),
    )
    op.add_column(
        "proctoring_sessions",
        sa.Column("device_failure_reason", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "proctoring_sessions",
        sa.Column("interruption_count", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("proctoring_sessions", "interruption_count")
    op.drop_column("proctoring_sessions", "device_failure_reason")
    op.drop_column("proctoring_sessions", "readiness_state")
    op.drop_column("proctoring_sessions", "selected_microphone_label")
    op.drop_column("proctoring_sessions", "selected_microphone_id")
    op.drop_column("proctoring_sessions", "selected_camera_label")
    op.drop_column("proctoring_sessions", "selected_camera_id")

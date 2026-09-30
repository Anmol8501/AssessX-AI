"""proctoring_events

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-24

Phase 4B: the append-only log of what happened during a proctoring session — session lifecycle and
device changes recorded by the server, exam-environment observations reported by the desktop app.

A new table only; no existing table or row is touched. Existing sessions simply have no events.
Autogenerate does not detect CHECK constraints, so those are written by hand.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENT_TYPES = (
    "SESSION_STARTED",
    "SESSION_RESUMED",
    "SESSION_ENDED",
    "CAMERA_DISCONNECTED",
    "CAMERA_RECONNECTED",
    "MIC_DISCONNECTED",
    "MIC_RECONNECTED",
    "FULLSCREEN_ENTER",
    "FULLSCREEN_EXIT",
    "FULLSCREEN_RESTORED",
    "FOCUS_LOST",
    "FOCUS_REGAINED",
    "COPY_ATTEMPT",
    "CUT_ATTEMPT",
    "PASTE_ATTEMPT",
    "CLIPBOARD_ACCESS_ATTEMPT",
    "CONTEXT_MENU_ATTEMPT",
    "PRINT_ATTEMPT",
    "DEVTOOLS_ATTEMPT",
    "KEYBOARD_RESTRICTION_ATTEMPT",
    "SCREEN_CAPTURE_ATTEMPT",
    "MULTIPLE_MONITORS_DETECTED",
    "DISPLAY_CONFIGURATION_CHANGED",
    "REMOTE_SESSION_DETECTED",
    "ENFORCEMENT_STATUS",
)


def upgrade() -> None:
    op.create_table(
        "proctoring_events",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(*EVENT_TYPES, name="proctoring_event_type", native_enum=False, length=40),
            nullable=False,
        ),
        sa.Column(
            "category",
            sa.Enum(
                "SESSION",
                "DEVICE",
                "WINDOW",
                "INPUT",
                "DISPLAY",
                "SYSTEM",
                name="proctoring_event_category",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Enum("SERVER", "CLIENT", name="proctoring_event_source", native_enum=False, length=10),
            nullable=False,
        ),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("client_event_id", sa.Uuid(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("client_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["proctoring_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "client_event_id", name="uq_proctoring_event_client_id"),
        sa.CheckConstraint("source IN ('SERVER', 'CLIENT')", name="ck_proctoring_events_source"),
        sa.CheckConstraint(
            "category IN ('SESSION', 'DEVICE', 'WINDOW', 'INPUT', 'DISPLAY', 'SYSTEM')",
            name="ck_proctoring_events_category",
        ),
        sa.CheckConstraint(
            "event_type IN (" + ", ".join(f"'{t}'" for t in EVENT_TYPES) + ")",
            name="ck_proctoring_events_event_type",
        ),
    )
    op.create_index(
        "ix_proctoring_events_session_recorded",
        "proctoring_events",
        ["session_id", "recorded_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_proctoring_events_event_type"), "proctoring_events", ["event_type"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_proctoring_events_event_type"), table_name="proctoring_events")
    op.drop_index("ix_proctoring_events_session_recorded", table_name="proctoring_events")
    op.drop_table("proctoring_events")

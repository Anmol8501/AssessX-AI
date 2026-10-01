"""phase 7d live video interview

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-01

Phase 7D: live video interviews. `interviews.format` (AI — the existing text interview, default — or
LIVE); `interview_calls` (one live call: who opened it, when the candidate joined, when and by whom it
ended — at most one OPEN call per assignment); `interview_call_messages` (the text chat); and
`interview_call_notes` (the interviewer's private notes). Plus the call actions on `audit_logs`.

No media is stored anywhere: video, audio and screen sharing are peer-to-peer WebRTC; the server only
relays signaling. Existing interviews become format AI. RLS is enabled without policies on the new
tables, as in 0014–0017. Downgrade removes only what this migration added.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0017 = (
    "REVIEW_STARTED",
    "REVIEW_NOTE_ADDED",
    "REVIEW_EVIDENCE_MARKED",
    "REVIEW_COMPLETED",
    "REVIEW_REVISED",
    "INTERVIEW_CREATED",
    "INTERVIEW_UPDATED",
    "INTERVIEW_DELETED",
    "INTERVIEW_PUBLISHED",
    "INTERVIEW_UNPUBLISHED",
    "INTERVIEW_QUESTION_CREATED",
    "INTERVIEW_QUESTION_UPDATED",
    "INTERVIEW_QUESTION_DELETED",
    "INTERVIEW_QUESTIONS_REORDERED",
    "INTERVIEW_ASSIGNED",
    "INTERVIEW_UNASSIGNED",
    "INTERVIEW_SESSION_STARTED",
    "INTERVIEW_ANSWER_SUBMITTED",
    "INTERVIEW_SESSION_COMPLETED",
    "INTERVIEW_EVALUATION_REQUESTED",
    "INTERVIEW_EVALUATION_COMPLETED",
    "INTERVIEW_EVALUATION_FAILED",
    "INTERVIEW_EVALUATION_RETRIED",
    "INTERVIEW_ADAPTIVE_DECISION",
    "INTERVIEW_REVIEW_STARTED",
    "INTERVIEW_REVIEW_NOTE_ADDED",
    "INTERVIEW_REVIEW_ANSWER_MARKED",
    "INTERVIEW_REVIEW_COMPLETED",
    "INTERVIEW_REVIEW_REVISED",
)
ACTIONS_7D = (
    "INTERVIEW_CALL_OPENED",
    "INTERVIEW_CALL_JOINED",
    "INTERVIEW_CALL_ENDED",
    "INTERVIEW_CALL_NOTE_ADDED",
)
NEW_TABLES = ("interview_calls", "interview_call_messages", "interview_call_notes")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.add_column(
        "interviews",
        sa.Column(
            "format",
            sa.Enum("AI", "LIVE", name="interview_format", native_enum=False, length=20),
            server_default="AI",
            nullable=False,
        ),
    )
    op.create_check_constraint("ck_interviews_format", "interviews", _in("format", ("AI", "LIVE")))

    op.create_table(
        "interview_calls",
        sa.Column("interview_id", sa.Uuid(), nullable=False),
        sa.Column("assignment_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("OPEN", "ENDED", name="interview_call_status", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column("opened_by_id", sa.Uuid(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("candidate_joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_by_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["interview_id"], ["interviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignment_id"], ["interview_assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["opened_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["ended_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("status IN ('OPEN', 'ENDED')", name="ck_interview_calls_status"),
        sa.CheckConstraint(
            "(status = 'ENDED') = (ended_at IS NOT NULL AND ended_by_id IS NOT NULL)",
            name="ck_interview_calls_ended_iff",
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= opened_at", name="ck_interview_calls_end_after_open"
        ),
    )
    op.create_index(
        op.f("ix_interview_calls_candidate_id"), "interview_calls", ["candidate_id"], unique=False
    )
    op.create_index(
        "ix_interview_calls_interview_opened", "interview_calls", ["interview_id", "opened_at"], unique=False
    )
    op.create_index(
        "uq_interview_calls_one_open",
        "interview_calls",
        ["assignment_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )

    for table, limit, sender, at, check in (
        ("interview_call_messages", 2000, "sender_id", "sent_at", "ck_interview_call_messages_body"),
        ("interview_call_notes", 4000, "author_id", "created_at", "ck_interview_call_notes_body"),
    ):
        op.create_table(
            table,
            sa.Column("call_id", sa.Uuid(), nullable=False),
            sa.Column(sender, sa.Uuid(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column(at, sa.DateTime(timezone=True), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.ForeignKeyConstraint(["call_id"], ["interview_calls.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint([sender], ["users.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(f"char_length(body) BETWEEN 1 AND {limit}", name=check),
        )
    op.create_index(
        "ix_interview_call_messages_call_sent",
        "interview_call_messages",
        ["call_id", "sent_at"],
        unique=False,
    )
    op.create_index(
        "ix_interview_call_notes_call_created",
        "interview_call_notes",
        ["call_id", "created_at"],
        unique=False,
    )

    for table in NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0017 + ACTIONS_7D))


def downgrade() -> None:
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE action LIKE 'INTERVIEW_CALL_%'")
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0017))

    op.drop_index("ix_interview_call_notes_call_created", table_name="interview_call_notes")
    op.drop_table("interview_call_notes")
    op.drop_index("ix_interview_call_messages_call_sent", table_name="interview_call_messages")
    op.drop_table("interview_call_messages")
    op.drop_index("uq_interview_calls_one_open", table_name="interview_calls")
    op.drop_index("ix_interview_calls_interview_opened", table_name="interview_calls")
    op.drop_index(op.f("ix_interview_calls_candidate_id"), table_name="interview_calls")
    op.drop_table("interview_calls")
    op.drop_constraint("ck_interviews_format", "interviews", type_="check")
    op.drop_column("interviews", "format")

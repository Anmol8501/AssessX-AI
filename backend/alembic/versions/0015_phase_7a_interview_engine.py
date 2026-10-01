"""phase 7a interview engine

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-01

Phase 7A: interviews, their administrator-authored questions (with at most one follow-up each),
assignments, sessions and session items (the presented questions and the candidate's answers).

New tables only, plus two additive changes to `audit_logs`: the action CHECK gains the interview
actions, and two nullable id columns (no foreign keys, like `attempt_id`) record which interview and
session an action concerned. No existing row is changed.

Row-level security is enabled without policies (and without FORCE) on the five new tables, exactly as
migration 0014 did: the API's owning role is unaffected, and other roles (such as Supabase's Data API
roles) are denied. Existing tables are unchanged.

Downgrade drops the new tables. Because `audit_logs` is append-only, removing the interview audit rows
(needed to restore the narrower CHECK) briefly disables its trigger inside the downgrade transaction.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REVIEW_ACTIONS = (
    "REVIEW_STARTED",
    "REVIEW_NOTE_ADDED",
    "REVIEW_EVIDENCE_MARKED",
    "REVIEW_COMPLETED",
    "REVIEW_REVISED",
)
INTERVIEW_ACTIONS = (
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
)
DIFFICULTIES = ("EASY", "MEDIUM", "HARD")
NEW_TABLES = (
    "interviews",
    "interview_questions",
    "interview_assignments",
    "interview_sessions",
    "interview_session_items",
)


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _enum(name: str, *values: str, length: int = 20) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=length)


def upgrade() -> None:
    op.create_table(
        "interviews",
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column(
            "interview_type", _enum("interview_type", "TECHNICAL", "BEHAVIORAL", "MIXED"), nullable=False
        ),
        sa.Column("difficulty", _enum("interview_difficulty", *DIFFICULTIES), nullable=False),
        sa.Column("topics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column("follow_ups_enabled", sa.Boolean(), nullable=False),
        sa.Column("max_follow_ups", sa.Integer(), nullable=False),
        sa.Column("status", _enum("interview_status", "DRAFT", "PUBLISHED"), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            _in("interview_type", ("TECHNICAL", "BEHAVIORAL", "MIXED")), name="ck_interviews_type"
        ),
        sa.CheckConstraint(_in("difficulty", DIFFICULTIES), name="ck_interviews_difficulty"),
        sa.CheckConstraint(_in("status", ("DRAFT", "PUBLISHED")), name="ck_interviews_status"),
        sa.CheckConstraint("duration_minutes BETWEEN 5 AND 180", name="ck_interviews_duration"),
        sa.CheckConstraint("question_count BETWEEN 1 AND 30", name="ck_interviews_question_count"),
        sa.CheckConstraint(
            "max_follow_ups >= 0 AND max_follow_ups <= question_count", name="ck_interviews_max_follow_ups"
        ),
        sa.CheckConstraint("jsonb_typeof(topics) = 'array'", name="ck_interviews_topics_array"),
        sa.CheckConstraint(
            "(status = 'PUBLISHED') = (published_at IS NOT NULL)", name="ck_interviews_published_iff_at"
        ),
    )
    op.create_index(op.f("ix_interviews_status"), "interviews", ["status"], unique=False)
    op.create_index(op.f("ix_interviews_created_by_id"), "interviews", ["created_by_id"], unique=False)

    op.create_table(
        "interview_questions",
        sa.Column("interview_id", sa.Uuid(), nullable=False),
        sa.Column("kind", _enum("interview_question_kind", "PRIMARY", "FOLLOW_UP"), nullable=False),
        sa.Column("parent_question_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "question_type",
            _enum("interview_question_type", "TECHNICAL", "BEHAVIORAL", "CONCEPTUAL", "SCENARIO"),
            nullable=False,
        ),
        sa.Column("topic", sa.String(length=60), nullable=False),
        sa.Column("difficulty", _enum("interview_difficulty", *DIFFICULTIES), nullable=False),
        sa.Column("expected_concepts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("competency", sa.String(length=120), nullable=True),
        sa.Column("context", sa.Text(), nullable=True),
        sa.Column("time_limit_seconds", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["interview_id"], ["interviews.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "interview_id", name="uq_interview_questions_id_interview"),
        # A primary has at most one follow-up.
        sa.UniqueConstraint("parent_question_id", name="uq_interview_questions_one_follow_up"),
        # A follow-up's parent belongs to the same interview.
        sa.ForeignKeyConstraint(
            ["parent_question_id", "interview_id"],
            ["interview_questions.id", "interview_questions.interview_id"],
            ondelete="CASCADE",
            name="fk_interview_questions_parent_same_interview",
        ),
        sa.CheckConstraint(_in("kind", ("PRIMARY", "FOLLOW_UP")), name="ck_interview_questions_kind"),
        sa.CheckConstraint(
            _in("question_type", ("TECHNICAL", "BEHAVIORAL", "CONCEPTUAL", "SCENARIO")),
            name="ck_interview_questions_type",
        ),
        sa.CheckConstraint(_in("difficulty", DIFFICULTIES), name="ck_interview_questions_difficulty"),
        sa.CheckConstraint(
            "(kind = 'FOLLOW_UP') = (parent_question_id IS NOT NULL)",
            name="ck_interview_questions_follow_up_parent",
        ),
        sa.CheckConstraint("char_length(text) BETWEEN 1 AND 2000", name="ck_interview_questions_text_length"),
        sa.CheckConstraint("position >= 0", name="ck_interview_questions_position"),
        sa.CheckConstraint(
            "time_limit_seconds IS NULL OR time_limit_seconds BETWEEN 10 AND 3600",
            name="ck_interview_questions_time_limit",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(expected_concepts) = 'array'", name="ck_interview_questions_concepts_array"
        ),
    )
    op.create_index(
        "ix_interview_questions_interview_position",
        "interview_questions",
        ["interview_id", "position"],
        unique=False,
    )

    op.create_table(
        "interview_assignments",
        sa.Column("interview_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("assigned_by_id", sa.Uuid(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["interview_id"], ["interviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("interview_id", "candidate_id", name="uq_interview_assignment"),
    )
    op.create_index(
        op.f("ix_interview_assignments_candidate_id"), "interview_assignments", ["candidate_id"], unique=False
    )

    op.create_table(
        "interview_sessions",
        sa.Column("interview_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("assignment_id", sa.Uuid(), nullable=False),
        sa.Column("status", _enum("interview_session_status", "ACTIVE", "COMPLETED"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "completion_reason",
            _enum("interview_completion_reason", "ALL_ANSWERED", "TIME_EXPIRED", "ENDED_BY_CANDIDATE"),
            nullable=True,
        ),
        sa.Column("question_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("follow_ups_used", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["interview_id"], ["interviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignment_id"], ["interview_assignments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assignment_id"),
        # One session per candidate per interview: no restart.
        sa.UniqueConstraint("interview_id", "candidate_id", name="uq_interview_session_candidate"),
        sa.CheckConstraint(_in("status", ("ACTIVE", "COMPLETED")), name="ck_interview_sessions_status"),
        sa.CheckConstraint(
            "completion_reason IS NULL OR "
            + _in("completion_reason", ("ALL_ANSWERED", "TIME_EXPIRED", "ENDED_BY_CANDIDATE")),
            name="ck_interview_sessions_reason",
        ),
        sa.CheckConstraint(
            "(status = 'COMPLETED') = (completed_at IS NOT NULL AND completion_reason IS NOT NULL)",
            name="ck_interview_sessions_completed_iff",
        ),
        sa.CheckConstraint("expires_at > started_at", name="ck_interview_sessions_expiry_after_start"),
        sa.CheckConstraint("follow_ups_used >= 0", name="ck_interview_sessions_follow_ups"),
        sa.CheckConstraint("jsonb_typeof(question_plan) = 'array'", name="ck_interview_sessions_plan_array"),
    )
    op.create_index(
        op.f("ix_interview_sessions_candidate_id"), "interview_sessions", ["candidate_id"], unique=False
    )
    op.create_index(
        "ix_interview_sessions_interview_status",
        "interview_sessions",
        ["interview_id", "status"],
        unique=False,
    )

    op.create_table(
        "interview_session_items",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("kind", _enum("interview_question_kind", "PRIMARY", "FOLLOW_UP"), nullable=False),
        sa.Column("parent_item_id", sa.Uuid(), nullable=True),
        sa.Column("state", _enum("interview_item_state", "PRESENTED", "ANSWERED"), nullable=False),
        sa.Column("presented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["interview_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["interview_questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_item_id"], ["interview_session_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "sequence", name="uq_interview_items_sequence"),
        sa.UniqueConstraint("session_id", "question_id", name="uq_interview_items_question_once"),
        sa.CheckConstraint(_in("kind", ("PRIMARY", "FOLLOW_UP")), name="ck_interview_items_kind"),
        sa.CheckConstraint(_in("state", ("PRESENTED", "ANSWERED")), name="ck_interview_items_state"),
        sa.CheckConstraint("sequence >= 1", name="ck_interview_items_sequence"),
        sa.CheckConstraint(
            "(kind = 'FOLLOW_UP') = (parent_item_id IS NOT NULL)", name="ck_interview_items_follow_up_parent"
        ),
        sa.CheckConstraint(
            "(state = 'ANSWERED') = (answer_text IS NOT NULL AND answered_at IS NOT NULL)",
            name="ck_interview_items_answered_iff",
        ),
        sa.CheckConstraint(
            "answer_text IS NULL OR char_length(answer_text) BETWEEN 1 AND 10000",
            name="ck_interview_items_answer_length",
        ),
        sa.CheckConstraint(
            "answered_at IS NULL OR answered_at >= presented_at", name="ck_interview_items_answer_order"
        ),
    )
    # At most one question is presented at a time per session.
    op.create_index(
        "uq_interview_items_one_presented",
        "interview_session_items",
        ["session_id"],
        unique=True,
        postgresql_where=sa.text("state = 'PRESENTED'"),
    )

    # -- audit_logs: interview actions and ids (additive) ----------------------------------------
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_action", "audit_logs", _in("action", REVIEW_ACTIONS + INTERVIEW_ACTIONS)
    )
    op.add_column("audit_logs", sa.Column("interview_id", sa.Uuid(), nullable=True))
    op.add_column("audit_logs", sa.Column("interview_session_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ix_audit_logs_interview_session_occurred",
        "audit_logs",
        ["interview_session_id", "occurred_at"],
        unique=False,
    )

    for table in NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_audit_logs_interview_session_occurred", table_name="audit_logs")
    op.drop_column("audit_logs", "interview_session_id")
    op.drop_column("audit_logs", "interview_id")
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    # The narrower CHECK cannot be restored while interview rows exist; the append-only trigger is
    # lifted for this one statement, inside the downgrade's transaction.
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE action LIKE 'INTERVIEW_%'")
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", REVIEW_ACTIONS))

    op.drop_index("uq_interview_items_one_presented", table_name="interview_session_items")
    op.drop_table("interview_session_items")
    op.drop_index("ix_interview_sessions_interview_status", table_name="interview_sessions")
    op.drop_index(op.f("ix_interview_sessions_candidate_id"), table_name="interview_sessions")
    op.drop_table("interview_sessions")
    op.drop_index(op.f("ix_interview_assignments_candidate_id"), table_name="interview_assignments")
    op.drop_table("interview_assignments")
    op.drop_index("ix_interview_questions_interview_position", table_name="interview_questions")
    op.drop_table("interview_questions")
    op.drop_index(op.f("ix_interviews_created_by_id"), table_name="interviews")
    op.drop_index(op.f("ix_interviews_status"), table_name="interviews")
    op.drop_table("interviews")

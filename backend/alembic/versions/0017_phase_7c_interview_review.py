"""phase 7c interview review

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-01

Phase 7C: the human review of an interview session — `interview_reviews` (one per session),
`interview_review_notes` (immutable), `interview_review_decisions` (immutable revisions, each with the AI
report basis it was made on) and `interview_review_marks` (agree/disagree with one AI evaluation;
append-only). Plus the review actions on `audit_logs`.

New tables only; no existing table or row changes. RLS is enabled without policies on the new tables, as
in 0014–0016. Downgrade drops them and the new audit rows (lifting the append-only trigger for that one
statement, as 0015/0016 do).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0016 = (
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
)
ACTIONS_7C = (
    "INTERVIEW_REVIEW_STARTED",
    "INTERVIEW_REVIEW_NOTE_ADDED",
    "INTERVIEW_REVIEW_ANSWER_MARKED",
    "INTERVIEW_REVIEW_COMPLETED",
    "INTERVIEW_REVIEW_REVISED",
)
OUTCOMES = ("MEETS_EXPECTATIONS", "NEEDS_FURTHER_ASSESSMENT", "DOES_NOT_MEET_EXPECTATIONS", "INCONCLUSIVE")
STATES = ("NONE", "PENDING", "PARTIAL", "COMPLETE")
NEW_TABLES = (
    "interview_reviews",
    "interview_review_notes",
    "interview_review_decisions",
    "interview_review_marks",
)


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _outcome() -> sa.Enum:
    return sa.Enum(*OUTCOMES, name="interview_review_outcome", native_enum=False, length=40)


def upgrade() -> None:
    op.create_table(
        "interview_reviews",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("IN_REVIEW", "REVIEWED", name="interview_review_status", native_enum=False, length=40),
            nullable=False,
        ),
        sa.Column("outcome", _outcome(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("started_by_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_by_id", sa.Uuid(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["interview_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["started_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["completed_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
        sa.CheckConstraint(_in("status", ("IN_REVIEW", "REVIEWED")), name="ck_interview_reviews_status"),
        sa.CheckConstraint(
            "outcome IS NULL OR " + _in("outcome", OUTCOMES), name="ck_interview_reviews_outcome"
        ),
        sa.CheckConstraint("version >= 1", name="ck_interview_reviews_version"),
        sa.CheckConstraint(
            "(status = 'REVIEWED') = (outcome IS NOT NULL)", name="ck_interview_reviews_reviewed_iff_outcome"
        ),
        sa.CheckConstraint(
            "(status = 'REVIEWED') = (completed_by_id IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_interview_reviews_reviewed_iff_completed",
        ),
        sa.CheckConstraint(
            "completed_at IS NULL OR completed_at >= started_at",
            name="ck_interview_reviews_completed_after_start",
        ),
    )
    op.create_index(op.f("ix_interview_reviews_status"), "interview_reviews", ["status"], unique=False)

    op.create_table(
        "interview_review_notes",
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["interview_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("char_length(body) BETWEEN 1 AND 4000", name="ck_interview_review_notes_body"),
    )
    op.create_index(
        "ix_interview_review_notes_review_created",
        "interview_review_notes",
        ["review_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "interview_review_decisions",
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("outcome", _outcome(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("decided_by_id", sa.Uuid(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("report_policy_version", sa.String(length=20), nullable=False),
        sa.Column("ai_score", sa.Integer(), nullable=True),
        sa.Column("ai_score_partial", sa.Boolean(), nullable=False),
        sa.Column("evaluation_state", sa.String(length=20), nullable=False),
        sa.Column("evaluated_primaries", sa.Integer(), nullable=False),
        sa.Column("answered_primaries", sa.Integer(), nullable=False),
        sa.Column("planned_primaries", sa.Integer(), nullable=False),
        sa.Column("evaluator_versions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("rubric_versions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["interview_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("review_id", "revision", name="uq_interview_review_decisions_revision"),
        sa.CheckConstraint("revision >= 1", name="ck_interview_review_decisions_revision"),
        sa.CheckConstraint(_in("outcome", OUTCOMES), name="ck_interview_review_decisions_outcome"),
        sa.CheckConstraint(
            "char_length(rationale) BETWEEN 1 AND 4000", name="ck_interview_review_decisions_rationale"
        ),
        sa.CheckConstraint(
            "ai_score IS NULL OR ai_score BETWEEN 0 AND 100", name="ck_interview_review_decisions_score"
        ),
        sa.CheckConstraint(_in("evaluation_state", STATES), name="ck_interview_review_decisions_state"),
        sa.CheckConstraint(
            "evaluated_primaries >= 0 AND answered_primaries >= evaluated_primaries "
            "AND planned_primaries >= answered_primaries",
            name="ck_interview_review_decisions_counts",
        ),
    )
    op.create_index(
        op.f("ix_interview_review_decisions_review_id"),
        "interview_review_decisions",
        ["review_id"],
        unique=False,
    )

    op.create_table(
        "interview_review_marks",
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("evaluation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "mark",
            sa.Enum("AGREE", "DISAGREE", name="interview_answer_mark", native_enum=False, length=40),
            nullable=False,
        ),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["interview_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["interview_session_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evaluation_id"], ["interview_evaluations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("mark IN ('AGREE', 'DISAGREE')", name="ck_interview_review_marks_mark"),
    )
    op.create_index(
        "ix_interview_review_marks_review_item",
        "interview_review_marks",
        ["review_id", "item_id", "created_at"],
        unique=False,
    )

    for table in NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0016 + ACTIONS_7C))


def downgrade() -> None:
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE action LIKE 'INTERVIEW_REVIEW_%'")
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0016))

    op.drop_index("ix_interview_review_marks_review_item", table_name="interview_review_marks")
    op.drop_table("interview_review_marks")
    op.drop_index(op.f("ix_interview_review_decisions_review_id"), table_name="interview_review_decisions")
    op.drop_table("interview_review_decisions")
    op.drop_index("ix_interview_review_notes_review_created", table_name="interview_review_notes")
    op.drop_table("interview_review_notes")
    op.drop_index(op.f("ix_interview_reviews_status"), table_name="interview_reviews")
    op.drop_table("interview_reviews")

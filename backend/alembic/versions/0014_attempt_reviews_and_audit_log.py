"""attempt reviews and audit log

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-01

Phase 6C: the human review of a proctored attempt and an append-only audit log.

* `attempt_reviews` — one per attempt, its current status and outcome (`version` for concurrency).
* `review_notes` — human-authored, immutable notes.
* `review_decisions` — every recorded outcome as an immutable revision, with the 6A/6B basis.
* `review_marks` — confirm/dismiss marks on Phase 6B evidence items (append-only).
* `audit_logs` — who did what, when. A trigger rejects UPDATE and DELETE; no foreign key to the
  attempt, so the record survives the attempt being deleted.

New tables only: no existing table or row is touched. Row-level security is enabled on the new
tables with **no policies** and without FORCE. The API and Alembic connect as the same role, which
owns these tables and so is not subject to RLS; the policy-less RLS only denies other roles — such as
Supabase's `anon`/`authenticated` Data API roles — any access to review notes and the audit log.
Existing tables are deliberately unchanged.

Downgrade drops only these tables (and their review data) and the trigger function.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OUTCOMES = ("NO_ACTION", "CLEARED", "FLAGGED", "INVALIDATED")
ACTIONS = (
    "REVIEW_STARTED",
    "REVIEW_NOTE_ADDED",
    "REVIEW_EVIDENCE_MARKED",
    "REVIEW_COMPLETED",
    "REVIEW_REVISED",
)
LEVELS = "('NORMAL', 'LOW', 'MEDIUM', 'HIGH')"
NEW_TABLES = ("attempt_reviews", "review_notes", "review_decisions", "review_marks", "audit_logs")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _outcome(name: str = "review_outcome") -> sa.Enum:
    return sa.Enum(*OUTCOMES, name=name, native_enum=False, length=20)


def upgrade() -> None:
    op.create_table(
        "attempt_reviews",
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("IN_REVIEW", "REVIEWED", name="review_status", native_enum=False, length=20),
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
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["started_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["completed_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        # One review per attempt. Also what makes two simultaneous "Start review" clicks safe.
        sa.UniqueConstraint("attempt_id"),
        sa.CheckConstraint("status IN ('IN_REVIEW', 'REVIEWED')", name="ck_attempt_reviews_status"),
        sa.CheckConstraint(
            "outcome IS NULL OR " + _in("outcome", OUTCOMES), name="ck_attempt_reviews_outcome"
        ),
        sa.CheckConstraint("version >= 1", name="ck_attempt_reviews_version_positive"),
        sa.CheckConstraint(
            "(status = 'REVIEWED') = (outcome IS NOT NULL)", name="ck_attempt_reviews_reviewed_iff_outcome"
        ),
        sa.CheckConstraint(
            "(status = 'REVIEWED') = (completed_by_id IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_attempt_reviews_reviewed_iff_completed",
        ),
        sa.CheckConstraint(
            "completed_at IS NULL OR completed_at >= started_at",
            name="ck_attempt_reviews_completed_after_start",
        ),
    )
    op.create_index(op.f("ix_attempt_reviews_status"), "attempt_reviews", ["status"], unique=False)

    op.create_table(
        "review_notes",
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["attempt_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("char_length(body) BETWEEN 1 AND 4000", name="ck_review_notes_body_length"),
    )
    op.create_index(
        "ix_review_notes_review_created", "review_notes", ["review_id", "created_at"], unique=False
    )

    op.create_table(
        "review_decisions",
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("outcome", _outcome(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("decided_by_id", sa.Uuid(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("policy_version", sa.Text(), nullable=False),
        sa.Column("evidence_version", sa.Text(), nullable=False),
        sa.Column("risk_as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("risk_level", sa.Text(), nullable=False),
        sa.Column("peak_score", sa.Integer(), nullable=False),
        sa.Column("peak_level", sa.Text(), nullable=False),
        sa.Column("signal_count", sa.Integer(), nullable=False),
        sa.Column("evidence_count", sa.Integer(), nullable=False),
        sa.Column("episode_count", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["attempt_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("review_id", "revision", name="uq_review_decisions_revision"),
        sa.CheckConstraint("revision >= 1", name="ck_review_decisions_revision_positive"),
        sa.CheckConstraint(_in("outcome", OUTCOMES), name="ck_review_decisions_outcome"),
        sa.CheckConstraint(
            "char_length(rationale) BETWEEN 1 AND 4000", name="ck_review_decisions_rationale_length"
        ),
        sa.CheckConstraint("risk_score BETWEEN 0 AND 100", name="ck_review_decisions_risk_score"),
        sa.CheckConstraint("peak_score BETWEEN 0 AND 100", name="ck_review_decisions_peak_score"),
        sa.CheckConstraint(f"risk_level IN {LEVELS}", name="ck_review_decisions_risk_level"),
        sa.CheckConstraint(f"peak_level IN {LEVELS}", name="ck_review_decisions_peak_level"),
        sa.CheckConstraint(
            "signal_count >= 0 AND evidence_count >= 0 AND episode_count >= 0",
            name="ck_review_decisions_counts",
        ),
    )
    op.create_index(op.f("ix_review_decisions_review_id"), "review_decisions", ["review_id"], unique=False)

    op.create_table(
        "review_marks",
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_event_id", sa.Uuid(), nullable=False),
        sa.Column(
            "mark",
            sa.Enum("CONFIRMED", "DISMISSED", name="evidence_mark", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["attempt_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_event_id"], ["proctoring_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("mark IN ('CONFIRMED', 'DISMISSED')", name="ck_review_marks_mark"),
    )
    op.create_index(
        "ix_review_marks_review_evidence",
        "review_marks",
        ["review_id", "evidence_event_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "audit_logs",
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column(
            "action", sa.Enum(*ACTIONS, name="audit_action", native_enum=False, length=40), nullable=False
        ),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("assessment_id", sa.Uuid(), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(_in("action", ACTIONS), name="ck_audit_logs_action"),
    )
    op.create_index(
        "ix_audit_logs_attempt_occurred", "audit_logs", ["attempt_id", "occurred_at"], unique=False
    )
    op.create_index("ix_audit_logs_actor_occurred", "audit_logs", ["actor_id", "occurred_at"], unique=False)

    # Append-only at the database: no UPDATE or DELETE of an audit row, from any application path.
    op.execute(
        """
        CREATE FUNCTION audit_logs_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()"
    )

    # Policy-less RLS on the new tables only (see the module docstring). Not FORCE: the owning role
    # used by the API is unaffected.
    for table in NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    op.drop_index("ix_audit_logs_actor_occurred", table_name="audit_logs")
    op.drop_index("ix_audit_logs_attempt_occurred", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_review_marks_review_evidence", table_name="review_marks")
    op.drop_table("review_marks")
    op.drop_index(op.f("ix_review_decisions_review_id"), table_name="review_decisions")
    op.drop_table("review_decisions")
    op.drop_index("ix_review_notes_review_created", table_name="review_notes")
    op.drop_table("review_notes")
    op.drop_index(op.f("ix_attempt_reviews_status"), table_name="attempt_reviews")
    op.drop_table("attempt_reviews")

"""phase 7b answer evaluation and adaptive interview

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-01

Phase 7B:

* `interview_evaluations` — the AI evaluation of one answer (an assessment signal, never a decision):
  validated dimension scores, a server-computed overall score, findings, provenance (provider, model,
  evaluator / rubric / prompt versions) and lifecycle (PENDING → COMPLETED / FAILED; UNAVAILABLE when no
  evaluator is configured). One row per (answer, evaluator version, rubric version).
* Adaptive difficulty: `interviews.adaptive_difficulty` (off by default), `min_difficulty` and
  `starting_difficulty` (min ≤ starting ≤ the existing `difficulty`, now the maximum);
  `interview_sessions.current_difficulty` and `difficulty_changes`; `interview_session_items.selected_by`.
* `audit_logs` gains the evaluation and adaptive-decision actions.

Existing rows are back-filled so 7A interviews behave exactly as before: not adaptive, starting at
their difficulty, sessions at their interview's difficulty, every existing item selected by PLAN.
RLS is enabled without policies on the new table only, as in 0014/0015.

Downgrade removes the new table and columns and the new audit rows (lifting the append-only trigger
for that one statement, as 0015 does).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0015 = (
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
)
ACTIONS_7B = (
    "INTERVIEW_EVALUATION_REQUESTED",
    "INTERVIEW_EVALUATION_COMPLETED",
    "INTERVIEW_EVALUATION_FAILED",
    "INTERVIEW_EVALUATION_RETRIED",
    "INTERVIEW_ADAPTIVE_DECISION",
)
DIFFICULTIES = ("EASY", "MEDIUM", "HARD")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _rank(column: str) -> str:
    return f"(CASE {column} WHEN 'EASY' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END)"


def _difficulty() -> sa.Enum:
    return sa.Enum(*DIFFICULTIES, name="interview_difficulty", native_enum=False, length=20)


def upgrade() -> None:
    # -- adaptive difficulty configuration -----------------------------------------------------
    op.add_column(
        "interviews", sa.Column("adaptive_difficulty", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "interviews", sa.Column("min_difficulty", _difficulty(), server_default="EASY", nullable=False)
    )
    op.add_column("interviews", sa.Column("starting_difficulty", _difficulty(), nullable=True))
    op.execute("UPDATE interviews SET starting_difficulty = difficulty")
    op.alter_column("interviews", "starting_difficulty", nullable=False)
    op.create_check_constraint(
        "ck_interviews_min_difficulty", "interviews", _in("min_difficulty", DIFFICULTIES)
    )
    op.create_check_constraint(
        "ck_interviews_starting_difficulty", "interviews", _in("starting_difficulty", DIFFICULTIES)
    )
    op.create_check_constraint(
        "ck_interviews_difficulty_bounds",
        "interviews",
        f"{_rank('min_difficulty')} <= {_rank('starting_difficulty')} "
        f"AND {_rank('starting_difficulty')} <= {_rank('difficulty')}",
    )

    op.add_column("interview_sessions", sa.Column("current_difficulty", _difficulty(), nullable=True))
    op.execute(
        "UPDATE interview_sessions SET current_difficulty = interviews.difficulty "
        "FROM interviews WHERE interviews.id = interview_sessions.interview_id"
    )
    op.alter_column("interview_sessions", "current_difficulty", nullable=False)
    op.add_column(
        "interview_sessions",
        sa.Column("difficulty_changes", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_check_constraint(
        "ck_interview_sessions_difficulty", "interview_sessions", _in("current_difficulty", DIFFICULTIES)
    )
    op.create_check_constraint(
        "ck_interview_sessions_difficulty_changes", "interview_sessions", "difficulty_changes >= 0"
    )

    op.add_column(
        "interview_session_items",
        sa.Column(
            "selected_by",
            sa.Enum(
                "PLAN",
                "ADAPTIVE",
                "FALLBACK",
                name="interview_item_selected_by",
                native_enum=False,
                length=20,
            ),
            server_default="PLAN",
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_interview_items_selected_by",
        "interview_session_items",
        _in("selected_by", ("PLAN", "ADAPTIVE", "FALLBACK")),
    )

    # -- evaluations -----------------------------------------------------------------------------
    statuses = ("PENDING", "COMPLETED", "FAILED", "UNAVAILABLE")
    failures = (
        "TIMEOUT",
        "RATE_LIMITED",
        "PROVIDER_ERROR",
        "INVALID_OUTPUT",
        "INPUT_TOO_LONG",
        "NOT_CONFIGURED",
    )
    op.create_table(
        "interview_evaluations",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*statuses, name="interview_evaluation_status", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column(
            "failure_reason",
            sa.Enum(*failures, name="interview_evaluation_failure", native_enum=False, length=20),
            nullable=True,
        ),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("evaluator_version", sa.String(length=40), nullable=False),
        sa.Column("rubric_id", sa.String(length=40), nullable=False),
        sa.Column("rubric_version", sa.String(length=40), nullable=False),
        sa.Column("prompt_version", sa.String(length=40), nullable=False),
        sa.Column("dimension_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("overall_score", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=3, scale=2), nullable=True),
        sa.Column("present_concepts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("missing_concepts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("incorrect_points", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("strengths", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("evidence_quotes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("flags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["interview_session_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["interview_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["interview_questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "item_id", "evaluator_version", "rubric_version", name="uq_interview_evaluation_version"
        ),
        sa.CheckConstraint(_in("status", statuses), name="ck_interview_evaluations_status"),
        sa.CheckConstraint(
            "failure_reason IS NULL OR " + _in("failure_reason", failures),
            name="ck_interview_evaluations_failure",
        ),
        sa.CheckConstraint(
            "(status = 'COMPLETED') = (overall_score IS NOT NULL AND confidence IS NOT NULL "
            "AND dimension_scores IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_interview_evaluations_completed_iff_scored",
        ),
        sa.CheckConstraint(
            "(status IN ('FAILED', 'UNAVAILABLE')) = (failure_reason IS NOT NULL)",
            name="ck_interview_evaluations_failed_iff_reason",
        ),
        sa.CheckConstraint(
            "overall_score IS NULL OR overall_score BETWEEN 0 AND 100",
            name="ck_interview_evaluations_overall",
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1", name="ck_interview_evaluations_confidence"
        ),
        sa.CheckConstraint("attempts BETWEEN 0 AND 3", name="ck_interview_evaluations_attempts"),
        sa.CheckConstraint(
            "feedback IS NULL OR char_length(feedback) <= 600",
            name="ck_interview_evaluations_feedback_length",
        ),
    )
    op.create_index(
        op.f("ix_interview_evaluations_item_id"), "interview_evaluations", ["item_id"], unique=False
    )
    op.create_index(
        op.f("ix_interview_evaluations_session_id"), "interview_evaluations", ["session_id"], unique=False
    )
    op.execute("ALTER TABLE interview_evaluations ENABLE ROW LEVEL SECURITY")

    # -- audit actions ------------------------------------------------------------------------------
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0015 + ACTIONS_7B))


def downgrade() -> None:
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute(
        "DELETE FROM audit_logs "
        "WHERE action LIKE 'INTERVIEW_EVALUATION_%' OR action = 'INTERVIEW_ADAPTIVE_DECISION'"
    )
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0015))

    op.drop_index(op.f("ix_interview_evaluations_session_id"), table_name="interview_evaluations")
    op.drop_index(op.f("ix_interview_evaluations_item_id"), table_name="interview_evaluations")
    op.drop_table("interview_evaluations")

    op.drop_constraint("ck_interview_items_selected_by", "interview_session_items", type_="check")
    op.drop_column("interview_session_items", "selected_by")
    op.drop_constraint("ck_interview_sessions_difficulty_changes", "interview_sessions", type_="check")
    op.drop_constraint("ck_interview_sessions_difficulty", "interview_sessions", type_="check")
    op.drop_column("interview_sessions", "difficulty_changes")
    op.drop_column("interview_sessions", "current_difficulty")
    op.drop_constraint("ck_interviews_difficulty_bounds", "interviews", type_="check")
    op.drop_constraint("ck_interviews_starting_difficulty", "interviews", type_="check")
    op.drop_constraint("ck_interviews_min_difficulty", "interviews", type_="check")
    op.drop_column("interviews", "starting_difficulty")
    op.drop_column("interviews", "min_difficulty")
    op.drop_column("interviews", "adaptive_difficulty")

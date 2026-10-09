"""Security hardening (Phase 8A + 8B): throttling, reset codes, exam ownership, audit, RLS, runtime role

8A:
* `rate_limit_hits` — sliding-window counters for sign-in throttling and challenge issuance (HMAC keys).
* `password_reset_codes` — one-time, short-lived codes an administrator issues (HMAC only, single use).
* `assessment_attempts.auth_session_id`, `.bound_seen_at` — the sign-in session an exam in progress
  belongs to (one exam, one sign-in at a time; takeover after the owner has been silent).
* `audit_logs` — new actions (sign-ins, sessions, passwords, accounts, exam and question changes,
  assignments, exam access); `actor_id` may be empty only for a failed or throttled sign-in.

8B (see app/core/db_security.py and docs/security/DATABASE-ROLES.md):
* Row level security on **every** application table — including the 13 older tables migrations 0001–0013
  created without it — with one policy, for the least-privilege role `assessx_runtime` only. Not forced:
  the owning role (migrations, and the API until it moves to the runtime role) is unaffected.
* `assessx_runtime` (NOLOGIN, created if missing): SELECT/INSERT/UPDATE/DELETE on the application tables,
  SELECT/INSERT only on the append-only `audit_logs`; owns nothing.
* Every privilege of Supabase's Data API roles `anon` and `authenticated` on the public schema is revoked
  (only where those roles exist; local PostgreSQL has none).

The downgrade removes the runtime policy and grants and the new columns, tables and audit rows, and turns
RLS off again on the 13 older tables only. It does not drop the role (roles are cluster-wide and may be in
use by another database) and cannot restore grants the Data API roles may have had.

Revision ID: 0026
Revises: 0025
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.core.db_security import ensure_runtime_role, revoke_supabase_api_roles, secure_table, unsecure_table

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0025 = (
    "ATTEMPT_MESSAGE_SENT",
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
    "INTERVIEW_CALL_OPENED",
    "INTERVIEW_CALL_JOINED",
    "INTERVIEW_CALL_ENDED",
    "INTERVIEW_CALL_NOTE_ADDED",
    "ATTEMPT_HELD",
    "ATTEMPT_RELEASED",
    "ATTEMPT_ENDED_BY_ADMIN",
    "CODING_PROBLEM_CREATED",
    "CODING_PROBLEM_DELETED",
    "CODING_VERSION_CREATED",
    "CODING_VERSION_PUBLISHED",
)
NEW_ACTIONS = (
    "SIGN_IN_SUCCEEDED",
    "SIGN_IN_FAILED",
    "SIGN_IN_THROTTLED",
    "SIGNED_OUT",
    "SESSIONS_REVOKED",
    "PASSWORD_CHANGED",
    "PASSWORD_RESET_ISSUED",
    "PASSWORD_RESET_COMPLETED",
    "ACCOUNT_DEACTIVATED",
    "ACCOUNT_REACTIVATED",
    "CANDIDATE_CREATED",
    "ASSESSMENT_CREATED",
    "ASSESSMENT_UPDATED",
    "ASSESSMENT_DELETED",
    "ASSESSMENT_MARKED_READY",
    "ASSESSMENT_REVERTED_TO_DRAFT",
    "ASSESSMENT_PUBLISHED",
    "ASSESSMENT_UNPUBLISHED",
    "QUESTION_CREATED",
    "QUESTION_UPDATED",
    "QUESTION_DELETED",
    "CANDIDATE_ASSIGNED",
    "CANDIDATE_UNASSIGNED",
    "ATTEMPT_ACCESS_BLOCKED",
    "ATTEMPT_SESSION_TAKEN_OVER",
)
TABLES = (
    "assessment_assignments",
    "assessment_attempts",
    "assessments",
    "attempt_answer_options",
    "attempt_answers",
    "attempt_messages",
    "attempt_results",
    "attempt_reviews",
    "audit_logs",
    "auth_sessions",
    "code_executions",
    "coding_drafts",
    "coding_problem_versions",
    "coding_problems",
    "coding_test_cases",
    "interview_assignments",
    "interview_call_messages",
    "interview_call_notes",
    "interview_calls",
    "interview_evaluations",
    "interview_questions",
    "interview_review_decisions",
    "interview_review_marks",
    "interview_review_notes",
    "interview_reviews",
    "interview_session_items",
    "interview_sessions",
    "interviews",
    "login_challenges",
    "password_reset_codes",
    "proctoring_events",
    "proctoring_sessions",
    "question_options",
    "questions",
    "rate_limit_hits",
    "review_decisions",
    "review_marks",
    "review_notes",
    "users",
)
LEGACY_TABLES = (
    "users",
    "auth_sessions",
    "login_challenges",
    "assessments",
    "questions",
    "question_options",
    "assessment_assignments",
    "assessment_attempts",
    "attempt_answers",
    "attempt_answer_options",
    "attempt_results",
    "proctoring_sessions",
    "proctoring_events",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    # Built only from the constant tuples above — no external input.
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.create_table(
        "rate_limit_hits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bucket", sa.String(32), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("hit_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rate_limit_hits_bucket_key_at", "rate_limit_hits", ["bucket", "key", "hit_at"])
    op.create_index("ix_rate_limit_hits_hit_at", "rate_limit_hits", ["hit_at"])

    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_password_reset_codes_user_id", "password_reset_codes", ["user_id"])

    op.add_column(
        "assessment_attempts",
        sa.Column(
            "auth_session_id",
            sa.Uuid(),
            sa.ForeignKey("auth_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "assessment_attempts", sa.Column("bound_seen_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0025 + NEW_ACTIONS)
    )
    op.alter_column("audit_logs", "actor_id", nullable=True)
    op.create_check_constraint(
        "ck_audit_logs_actor_required",
        "audit_logs",
        "actor_id IS NOT NULL OR action IN ('SIGN_IN_FAILED', 'SIGN_IN_THROTTLED')",
    )

    op.execute(ensure_runtime_role())
    for table in TABLES:
        for statement in secure_table(table):
            op.execute(statement)
    op.execute(revoke_supabase_api_roles())


def downgrade() -> None:
    for table in TABLES:
        if table in ("rate_limit_hits", "password_reset_codes"):
            continue
        for statement in unsecure_table(table, keep_rls=table not in LEGACY_TABLES):
            op.execute(statement)

    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE " + _in("action", NEW_ACTIONS))  # noqa: S608 — constants only
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.drop_constraint("ck_audit_logs_actor_required", "audit_logs", type_="check")
    op.alter_column("audit_logs", "actor_id", nullable=False)
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0025))

    op.drop_column("assessment_attempts", "bound_seen_at")
    op.drop_column("assessment_attempts", "auth_session_id")
    op.drop_index("ix_password_reset_codes_user_id", table_name="password_reset_codes")
    op.drop_table("password_reset_codes")
    op.drop_index("ix_rate_limit_hits_hit_at", table_name="rate_limit_hits")
    op.drop_index("ix_rate_limit_hits_bucket_key_at", table_name="rate_limit_hits")
    op.drop_table("rate_limit_hits")

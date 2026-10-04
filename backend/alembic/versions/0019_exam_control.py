"""Exam control: tab-switch count, holding (freezing) an attempt, and ending it as an administrator

Adds to `assessment_attempts`:
* `tab_switch_count` — counted by the server; the third counted switch puts the attempt on hold;
* `held_at`, `hold_reason` (TAB_SWITCH_LIMIT | ADMIN), `held_by_id`, `hold_note` — set while held;
* `ended_by_id` — the administrator who ended the exam for the candidate, if one did.

Existing attempts get a count of 0 and are not on hold. Widens the audit-action CHECK with
ATTEMPT_HELD, ATTEMPT_RELEASED and ATTEMPT_ENDED_BY_ADMIN. The downgrade removes those audit rows
first (the append-only trigger disabled only for that statement) and drops the columns.

Revision ID: 0019
Revises: 0018
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0018 = (
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
)
ACTIONS_CONTROL = ("ATTEMPT_HELD", "ATTEMPT_RELEASED", "ATTEMPT_ENDED_BY_ADMIN")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.add_column(
        "assessment_attempts",
        sa.Column("tab_switch_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("assessment_attempts", sa.Column("held_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("assessment_attempts", sa.Column("hold_reason", sa.String(length=20), nullable=True))
    op.add_column(
        "assessment_attempts",
        sa.Column("held_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("assessment_attempts", sa.Column("hold_note", sa.String(length=500), nullable=True))
    op.add_column(
        "assessment_attempts",
        sa.Column("ended_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_check_constraint("ck_attempts_tab_switch_count", "assessment_attempts", "tab_switch_count >= 0")
    op.create_check_constraint(
        "ck_attempts_hold_reason",
        "assessment_attempts",
        "hold_reason IS NULL OR " + _in("hold_reason", ("TAB_SWITCH_LIMIT", "ADMIN")),
    )
    op.create_check_constraint(
        "ck_attempts_hold_consistent", "assessment_attempts", "(held_at IS NULL) = (hold_reason IS NULL)"
    )

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0018 + ACTIONS_CONTROL)
    )


def downgrade() -> None:
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute(
        "DELETE FROM audit_logs"
        " WHERE action IN ('ATTEMPT_HELD', 'ATTEMPT_RELEASED', 'ATTEMPT_ENDED_BY_ADMIN')"
    )
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0018))

    for name in ("ck_attempts_hold_consistent", "ck_attempts_hold_reason", "ck_attempts_tab_switch_count"):
        op.drop_constraint(name, "assessment_attempts", type_="check")
    for column in ("ended_by_id", "hold_note", "held_by_id", "hold_reason", "held_at", "tab_switch_count"):
        op.drop_column("assessment_attempts", column)

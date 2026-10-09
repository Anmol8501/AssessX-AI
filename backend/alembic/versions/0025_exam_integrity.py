"""Exam integrity: proctor messages, closing attempts, framing, and where focus went

* `attempt_messages` — short messages a proctor sends a candidate during a live exam, shown on the exam
  screen until acknowledged (body 1–300 characters; `acknowledged_at` after `sent_at`). Policy-less,
  non-forced row level security like every table since 0014: the API's owning role is unaffected.
* `proctoring_events.event_type` gains EXAM_CLOSE_ATTEMPT (the candidate tried to close AssessX during
  the exam; refused) and UPPER_BODY_NOT_VISIBLE (an AI episode: head and chest not fully in view).
* `audit_logs.action` gains ATTEMPT_MESSAGE_SENT.

The `left_to` focus field needs no schema change (event metadata). The downgrade deletes the new rows
first (the audit trigger disabled only for that statement), then restores the previous constraints.

Revision ID: 0025
Revises: 0024
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENTS_0024 = (
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
    "DEVICE_CHECK_STARTED",
    "PROHIBITED_APP_DETECTED",
    "APP_CLOSE_REQUESTED",
    "APP_CLOSED",
    "APP_CLOSE_FAILED",
    "DEVICE_CHECK_PASSED",
    "DEVICE_CHECK_FAILED",
    "FACE_NOT_DETECTED",
    "MULTIPLE_FACES_DETECTED",
    "HEAD_ORIENTATION_CHANGED",
    "GAZE_AWAY",
    "CAMERA_TOO_DARK",
    "FACE_TOO_FAR",
    "FACE_TOO_CLOSE",
    "PHONE_DETECTED",
    "BOOK_DETECTED",
    "LAPTOP_DETECTED",
    "HANDHELD_DEVICE_DETECTED",
    "AI_STATUS",
    "CODING_QUESTION_OPENED",
    "CODE_PASTED",
    "CODE_RUN_REQUESTED",
    "CODE_SUBMITTED",
    "CODE_LANGUAGE_CHANGED",
)
NEW_EVENTS = ("EXAM_CLOSE_ATTEMPT", "UPPER_BODY_NOT_VISIBLE")
ACTIONS_0024 = (
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
NEW_ACTIONS = ("ATTEMPT_MESSAGE_SENT",)


def _in(column: str, values: tuple[str, ...]) -> str:
    # Built only from the constant tuples above — no external input.
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.create_table(
        "attempt_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "attempt_id",
            sa.Uuid(),
            sa.ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sender_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("char_length(body) BETWEEN 1 AND 300", name="ck_attempt_messages_body_length"),
        sa.CheckConstraint(
            "acknowledged_at IS NULL OR acknowledged_at >= sent_at", name="ck_attempt_messages_ack_after_send"
        ),
    )
    op.create_index("ix_attempt_messages_attempt_id", "attempt_messages", ["attempt_id"])
    op.execute("ALTER TABLE attempt_messages ENABLE ROW LEVEL SECURITY")

    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", EVENTS_0024 + NEW_EVENTS)
    )
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0024 + NEW_ACTIONS)
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM proctoring_events WHERE event_type IN ('EXAM_CLOSE_ATTEMPT', 'UPPER_BODY_NOT_VISIBLE')"
    )
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", EVENTS_0024)
    )

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE action = 'ATTEMPT_MESSAGE_SENT'")
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0024))

    op.drop_index("ix_attempt_messages_attempt_id", table_name="attempt_messages")
    op.drop_table("attempt_messages")

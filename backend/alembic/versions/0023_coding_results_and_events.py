"""Coding assessments, stage C4: result sections, coding activity events, the editor paste policy

* `attempt_results`: `partial_count` (default 0) and the section totals `mcq_score`, `mcq_maximum`,
  `coding_score`, `coding_maximum` (nullable; older results keep them empty).
* `proctoring_events`: five coding activity types (CODING_QUESTION_OPENED, CODE_PASTED,
  CODE_RUN_REQUESTED, CODE_SUBMITTED, CODE_LANGUAGE_CHANGED) and the CODING category. The downgrade
  deletes those rows first.
* `assessments.coding_allow_paste` (default false): whether pasting into the code editor is allowed.

Revision ID: 0023
Revises: 0022
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
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
    "AI_STATUS",
)
CODING_TYPES = (
    "CODING_QUESTION_OPENED",
    "CODE_PASTED",
    "CODE_RUN_REQUESTED",
    "CODE_SUBMITTED",
    "CODE_LANGUAGE_CHANGED",
)
CATEGORIES = ("SESSION", "DEVICE", "WINDOW", "INPUT", "DISPLAY", "SYSTEM", "AI_OBSERVATION", "AI_HEALTH")


def _in(column: str, values: tuple[str, ...]) -> str:
    # Built only from the constant tuples above — no external input.
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.add_column(
        "attempt_results", sa.Column("partial_count", sa.Integer(), nullable=False, server_default="0")
    )
    for column in ("mcq_score", "mcq_maximum", "coding_score", "coding_maximum"):
        op.add_column("attempt_results", sa.Column(column, sa.Integer(), nullable=True))
    op.create_check_constraint("ck_results_partial_non_negative", "attempt_results", "partial_count >= 0")

    op.add_column(
        "assessments", sa.Column("coding_allow_paste", sa.Boolean(), nullable=False, server_default="false")
    )

    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", EVENT_TYPES + CODING_TYPES)
    )
    op.drop_constraint("ck_proctoring_events_category", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_category", "proctoring_events", _in("category", (*CATEGORIES, "CODING"))
    )


def downgrade() -> None:
    op.execute("DELETE FROM proctoring_events WHERE category = 'CODING'")
    op.drop_constraint("ck_proctoring_events_category", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_category", "proctoring_events", _in("category", CATEGORIES)
    )
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", EVENT_TYPES)
    )
    op.drop_column("assessments", "coding_allow_paste")
    op.drop_constraint("ck_results_partial_non_negative", "attempt_results", type_="check")
    for column in ("coding_maximum", "coding_score", "mcq_maximum", "mcq_score", "partial_count"):
        op.drop_column("attempt_results", column)

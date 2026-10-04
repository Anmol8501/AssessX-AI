"""Object detection events: a phone, a book, a laptop or tablet, a handheld device in view

* `proctoring_events.event_type` gains PHONE_DETECTED, BOOK_DETECTED, LAPTOP_DETECTED and
  HANDHELD_DEVICE_DETECTED: AI observation episodes (started / resolved rows, category
  AI_OBSERVATION) from the on-device object detector, carrying only the class, the model's
  confidence, the model and the box's share of the frame. The downgrade deletes those rows first.

Revision ID: 0024
Revises: 0023
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BEFORE = (
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
    "CODING_QUESTION_OPENED",
    "CODE_PASTED",
    "CODE_RUN_REQUESTED",
    "CODE_SUBMITTED",
    "CODE_LANGUAGE_CHANGED",
)
OBJECT_TYPES = ("PHONE_DETECTED", "BOOK_DETECTED", "LAPTOP_DETECTED", "HANDHELD_DEVICE_DETECTED")


def _in(column: str, values: tuple[str, ...]) -> str:
    # Built only from the constant tuples above — no external input.
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", BEFORE + OBJECT_TYPES)
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM proctoring_events WHERE event_type IN "
        "('PHONE_DETECTED', 'BOOK_DETECTED', 'LAPTOP_DETECTED', 'HANDHELD_DEVICE_DETECTED')"
    )
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", BEFORE)
    )

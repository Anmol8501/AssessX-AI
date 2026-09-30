"""AI proctoring event types and categories

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-30

Phase 5C: widens the `proctoring_events` check constraints so the existing, append-only event store
can hold the on-device AI's factual observations (FACE_NOT_DETECTED, …) and its health (AI_STATUS),
under two new categories kept apart from each other (AI_OBSERVATION, AI_HEALTH). No new table, no
column changes, no row changes: an AI episode is recorded as ordinary rows (a `started` and a
`resolved` event), exactly like the existing FOCUS_LOST / FOCUS_REGAINED pair.

Downgrade deletes only rows of the new types, then restores the Phase 4B.5 constraints.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PHASE_4 = (
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
)
AI = (
    "FACE_NOT_DETECTED",
    "MULTIPLE_FACES_DETECTED",
    "HEAD_ORIENTATION_CHANGED",
    "GAZE_AWAY",
    "CAMERA_TOO_DARK",
    "FACE_TOO_FAR",
    "FACE_TOO_CLOSE",
    "AI_STATUS",
)
CATEGORIES_4 = ("SESSION", "DEVICE", "WINDOW", "INPUT", "DISPLAY", "SYSTEM")
CATEGORIES_AI = ("AI_OBSERVATION", "AI_HEALTH")


def _in(column: str, values: tuple[str, ...]) -> str:
    # Built only from the constant tuples above — no external input.
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", PHASE_4 + AI)
    )
    op.drop_constraint("ck_proctoring_events_category", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_category", "proctoring_events", _in("category", CATEGORIES_4 + CATEGORIES_AI)
    )


def downgrade() -> None:
    op.execute("DELETE FROM proctoring_events WHERE " + _in("event_type", AI))  # noqa: S608
    op.drop_constraint("ck_proctoring_events_category", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_category", "proctoring_events", _in("category", CATEGORIES_4)
    )
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _in("event_type", PHASE_4)
    )

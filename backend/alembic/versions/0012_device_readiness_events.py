"""device readiness event types

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-25

Phase 4B.5: widens the `proctoring_events.event_type` check constraint with the device-readiness
events (open-application check before a proctored exam). No table or row changes; downgrade
refuses nothing and restores the Phase 4B list after deleting only rows of the new types.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PHASE_4B = (
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
)
READINESS = (
    "DEVICE_CHECK_STARTED",
    "PROHIBITED_APP_DETECTED",
    "APP_CLOSE_REQUESTED",
    "APP_CLOSED",
    "APP_CLOSE_FAILED",
    "DEVICE_CHECK_PASSED",
    "DEVICE_CHECK_FAILED",
)


def _check(types: tuple[str, ...]) -> str:
    return "event_type IN (" + ", ".join(f"'{t}'" for t in types) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint(
        "ck_proctoring_events_event_type", "proctoring_events", _check(PHASE_4B + READINESS)
    )


def downgrade() -> None:
    # Built only from the constant tuple above — no external input.
    op.execute("DELETE FROM proctoring_events WHERE " + _check(READINESS))  # noqa: S608
    op.drop_constraint("ck_proctoring_events_event_type", "proctoring_events", type_="check")
    op.create_check_constraint("ck_proctoring_events_event_type", "proctoring_events", _check(PHASE_4B))

"""Phase 4B: proctoring environment enforcement & recovery event classification.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-09

Updates proctoring_events category check constraint to include RECOVERY events.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop existing category check constraint and replace with one including RECOVERY
    with op.batch_alter_table("proctoring_events") as batch_op:
        batch_op.drop_constraint("ck_proctoring_events_category", type_="check")
        batch_op.create_check_constraint(
            "ck_proctoring_events_category",
            "category IN ('SESSION', 'DEVICE', 'WINDOW', 'INPUT', 'DISPLAY', 'SYSTEM', "
            "'AI_OBSERVATION', 'AI_HEALTH', 'CODING', 'RECOVERY')",
        )


def downgrade() -> None:
    with op.batch_alter_table("proctoring_events") as batch_op:
        batch_op.drop_constraint("ck_proctoring_events_category", type_="check")
        batch_op.create_check_constraint(
            "ck_proctoring_events_category",
            "category IN ('SESSION', 'DEVICE', 'WINDOW', 'INPUT', 'DISPLAY', 'SYSTEM', "
            "'AI_OBSERVATION', 'AI_HEALTH', 'CODING')",
        )

"""drop attempt_answers.marked_for_review

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-23

Mark-for-review was removed from the product: candidates answer and move on, and the flag has no
bearing on evaluation. The column goes with it rather than lingering as a field nothing writes.

`server_default` is restored on downgrade so existing rows get `false` rather than a NOT NULL
violation.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("attempt_answers", "marked_for_review")


def downgrade() -> None:
    op.add_column(
        "attempt_answers",
        sa.Column("marked_for_review", sa.Boolean(), server_default="false", nullable=False),
    )

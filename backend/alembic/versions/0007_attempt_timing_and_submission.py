"""attempt expiry, submission timestamps and the terminal statuses

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-23

Phase 3B: the server-side clock and the end of an attempt.

`expires_at` is added nullable, backfilled from each attempt's own `started_at` plus its
assessment's `duration_minutes`, and only then made NOT NULL — so an existing open attempt keeps
the deadline it always implicitly had rather than being handed a fresh one.

Still absent, because they belong to Phase 3C: any score, percentage, pass/fail or result table.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assessment_attempts", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "assessment_attempts", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "assessment_attempts", sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True)
    )

    # Backfill: the deadline each existing attempt already had by definition.
    op.execute(
        """
        UPDATE assessment_attempts AS a
        SET expires_at = a.started_at + make_interval(mins => s.duration_minutes)
        FROM assessments AS s
        WHERE s.id = a.assessment_id AND a.expires_at IS NULL
        """
    )
    op.alter_column("assessment_attempts", "expires_at", nullable=False)

    # 0006 left the status column without a CHECK: its `sa.Enum(..., native_enum=False)` does not
    # create one (SQLAlchemy 2.0 defaults `create_constraint=False`), which is why there is nothing
    # to drop here. Adding it now matches `ck_assessments_status` and means the database, not only
    # the application, rejects a status outside the enum. Autogenerate does not see CHECK
    # constraints, so this lives in the migration only — as it does for assessments.
    op.create_check_constraint(
        "ck_attempts_status",
        "assessment_attempts",
        "status IN ('IN_PROGRESS', 'SUBMITTED', 'TIME_EXPIRED')",
    )


def downgrade() -> None:
    # A finished attempt cannot be represented by the 0006 schema, whose only status was
    # IN_PROGRESS. Collapsing the terminal states back is lossy, but the alternative — leaving
    # values the old enum does not know about — is worse. The constraint goes entirely, since
    # 0006 did not have one.
    op.execute("UPDATE assessment_attempts SET status = 'IN_PROGRESS' WHERE status <> 'IN_PROGRESS'")
    op.drop_constraint("ck_attempts_status", "assessment_attempts", type_="check")

    op.drop_column("assessment_attempts", "finalized_at")
    op.drop_column("assessment_attempts", "submitted_at")
    op.drop_column("assessment_attempts", "expires_at")

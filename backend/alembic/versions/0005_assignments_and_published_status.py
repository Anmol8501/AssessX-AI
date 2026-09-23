"""assessment_assignments and PUBLISHED status

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-22

Phase 2C: the assessment/candidate assignment table, `published_at`, and a status check constraint
that now admits PUBLISHED. No attempt/answer/result tables — those belong to Phase 3.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assessment_assignments",
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("assigned_by_id", sa.Uuid(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            sa.Enum("ASSIGNED", name="assignment_status", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assessment_id", "candidate_id", name="uq_assignment_assessment_candidate"),
    )
    op.create_index(
        op.f("ix_assessment_assignments_assessment_id"),
        "assessment_assignments",
        ["assessment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assessment_assignments_candidate_id"),
        "assessment_assignments",
        ["candidate_id"],
        unique=False,
    )
    op.add_column("assessments", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))

    # Widen the status constraint (autogenerate does not detect CHECK constraints).
    op.drop_constraint("ck_assessments_status", "assessments", type_="check")
    op.create_check_constraint(
        "ck_assessments_status", "assessments", "status IN ('DRAFT', 'READY', 'PUBLISHED')"
    )


def downgrade() -> None:
    # Anything published becomes ready again: the closest value the old constraint allows.
    op.execute("UPDATE assessments SET status = 'READY' WHERE status = 'PUBLISHED'")
    op.drop_constraint("ck_assessments_status", "assessments", type_="check")
    op.create_check_constraint("ck_assessments_status", "assessments", "status IN ('DRAFT', 'READY')")

    op.drop_column("assessments", "published_at")
    op.drop_index(op.f("ix_assessment_assignments_candidate_id"), table_name="assessment_assignments")
    op.drop_index(op.f("ix_assessment_assignments_assessment_id"), table_name="assessment_assignments")
    op.drop_table("assessment_assignments")

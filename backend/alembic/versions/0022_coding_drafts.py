"""Coding assessments, stage C3: coding drafts (the candidate's autosaved working code)

One row per (attempt, question), with a revision counter for safe concurrent saves. RLS enabled with no
policies (new table only).

Revision ID: 0022
Revises: 0021
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "coding_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "attempt_id",
            sa.Uuid(),
            sa.ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id", sa.Uuid(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("language", sa.String(length=20), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("attempt_id", "question_id", name="uq_coding_drafts_attempt_question"),
        sa.CheckConstraint("char_length(source) <= 65536", name="ck_coding_drafts_source_size"),
        sa.CheckConstraint("revision > 0", name="ck_coding_drafts_revision"),
    )
    op.create_index("ix_coding_drafts_attempt_id", "coding_drafts", ["attempt_id"])
    op.execute("ALTER TABLE coding_drafts ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("coding_drafts")

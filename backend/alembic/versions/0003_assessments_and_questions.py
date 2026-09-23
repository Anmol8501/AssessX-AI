"""assessments, questions and question_options

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-22

Phase 2A authoring tables. No attempt/answer/proctoring tables — those belong to later phases.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assessments",
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("total_marks", sa.Integer(), nullable=False),
        sa.Column("passing_marks", sa.Integer(), nullable=False),
        sa.Column(
            "status", sa.Enum("DRAFT", name="assessment_status", native_enum=False, length=20), nullable=False
        ),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("duration_minutes > 0", name="ck_assessments_duration_positive"),
        sa.CheckConstraint("passing_marks <= total_marks", name="ck_assessments_passing_within_total"),
        sa.CheckConstraint("passing_marks >= 0", name="ck_assessments_passing_marks_non_negative"),
        sa.CheckConstraint("total_marks > 0", name="ck_assessments_total_marks_positive"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assessments_created_by_id"), "assessments", ["created_by_id"], unique=False)
    op.create_index(op.f("ix_assessments_status"), "assessments", ["status"], unique=False)
    op.create_table(
        "questions",
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "MCQ", "MULTIPLE_SELECT", "TRUE_FALSE", name="question_type", native_enum=False, length=30
            ),
            nullable=False,
        ),
        sa.Column("marks", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("marks > 0", name="ck_questions_marks_positive"),
        sa.CheckConstraint("position >= 0", name="ck_questions_position_non_negative"),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_questions_assessment_id"), "questions", ["assessment_id"], unique=False)
    op.create_table(
        "question_options",
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_question_options_position_non_negative"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("question_id", "position", name="uq_question_options_question_position"),
    )
    op.create_index(
        op.f("ix_question_options_question_id"), "question_options", ["question_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_question_options_question_id"), table_name="question_options")
    op.drop_table("question_options")
    op.drop_index(op.f("ix_questions_assessment_id"), table_name="questions")
    op.drop_table("questions")
    op.drop_index(op.f("ix_assessments_status"), table_name="assessments")
    op.drop_index(op.f("ix_assessments_created_by_id"), table_name="assessments")
    op.drop_table("assessments")

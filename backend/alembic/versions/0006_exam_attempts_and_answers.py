"""assessment_attempts, attempt_answers and attempt_answer_options

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23

Phase 3A: a candidate's sitting of an assessment and the answers recorded during it.

Deliberately absent, because they belong to Phase 3B/3C: any terminal attempt status, a deadline
or expiry column, a submission timestamp, and every result/score table.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assessment_attempts",
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("assignment_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("IN_PROGRESS", name="attempt_status", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignment_id"], ["assessment_assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "assessment_id", "candidate_id", "attempt_number", name="uq_attempt_assessment_candidate_number"
        ),
        sa.CheckConstraint("attempt_number > 0", name="ck_attempts_number_positive"),
    )
    op.create_index(
        op.f("ix_assessment_attempts_assessment_id"), "assessment_attempts", ["assessment_id"], unique=False
    )
    op.create_index(
        op.f("ix_assessment_attempts_candidate_id"), "assessment_attempts", ["candidate_id"], unique=False
    )
    op.create_index(
        op.f("ix_assessment_attempts_assignment_id"), "assessment_attempts", ["assignment_id"], unique=False
    )
    op.create_index(op.f("ix_assessment_attempts_status"), "assessment_attempts", ["status"], unique=False)
    # One open attempt per candidate per assessment. Partial, so Phase 3B can add finished
    # attempts alongside the open one without dropping this guarantee.
    op.create_index(
        "uq_attempt_one_active_per_candidate",
        "assessment_attempts",
        ["assessment_id", "candidate_id"],
        unique=True,
        postgresql_where=sa.text("status = 'IN_PROGRESS'"),
    )

    op.create_table(
        "attempt_answers",
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("marked_for_review", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attempt_id", "question_id", name="uq_attempt_answer_attempt_question"),
    )
    op.create_index(op.f("ix_attempt_answers_attempt_id"), "attempt_answers", ["attempt_id"], unique=False)
    op.create_index(op.f("ix_attempt_answers_question_id"), "attempt_answers", ["question_id"], unique=False)

    op.create_table(
        "attempt_answer_options",
        sa.Column("answer_id", sa.Uuid(), nullable=False),
        sa.Column("option_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["answer_id"], ["attempt_answers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["option_id"], ["question_options.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("answer_id", "option_id", name="uq_attempt_answer_option"),
    )
    op.create_index(
        op.f("ix_attempt_answer_options_answer_id"), "attempt_answer_options", ["answer_id"], unique=False
    )
    op.create_index(
        op.f("ix_attempt_answer_options_option_id"), "attempt_answer_options", ["option_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_attempt_answer_options_option_id"), table_name="attempt_answer_options")
    op.drop_index(op.f("ix_attempt_answer_options_answer_id"), table_name="attempt_answer_options")
    op.drop_table("attempt_answer_options")

    op.drop_index(op.f("ix_attempt_answers_question_id"), table_name="attempt_answers")
    op.drop_index(op.f("ix_attempt_answers_attempt_id"), table_name="attempt_answers")
    op.drop_table("attempt_answers")

    op.drop_index("uq_attempt_one_active_per_candidate", table_name="assessment_attempts")
    op.drop_index(op.f("ix_assessment_attempts_status"), table_name="assessment_attempts")
    op.drop_index(op.f("ix_assessment_attempts_assignment_id"), table_name="assessment_attempts")
    op.drop_index(op.f("ix_assessment_attempts_candidate_id"), table_name="assessment_attempts")
    op.drop_index(op.f("ix_assessment_attempts_assessment_id"), table_name="assessment_attempts")
    op.drop_table("assessment_attempts")

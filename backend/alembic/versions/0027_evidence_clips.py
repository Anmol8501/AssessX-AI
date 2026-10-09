"""Evidence clips (PRD FR-017): short camera clips around qualifying factual events, for human review

* `evidence_clips` — one row per clip: the attempt, candidate, assessment and proctoring session it belongs
  to (all derived by the server), the event that triggered it, the camera it came from, its status
  (CREATING → READY / FAILED → EXPIRED / DELETED), the capture window, the storage object (an
  unpredictable server-generated key), its size, content type and SHA-256, and its retention dates.
* `evidence_clip_events` — the events a clip covers (an event belongs to at most one clip).
* `proctoring_sessions.evidence_recorder` — whether the candidate's app said, on activation, that it can
  record clips; the server asks only such sessions for clips.
* `audit_logs` — evidence actions (created, ready, failed, viewed, verified, integrity failure, deleted,
  expired); the system's own FAILED (missed upload deadline) and EXPIRED (retention) rows have no actor.

Both new tables get row level security and the least-privilege runtime policy (Phase 8B), like every
table. The video itself is never in the database: it lives in private object storage.

The downgrade drops both tables and removes the evidence audit rows. It does not touch stored video
objects (a migration never reaches into object storage): delete them from the private bucket by hand if
they must go too (docs/EVIDENCE-CLIPS.md).

Revision ID: 0027
Revises: 0026
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.core.db_security import secure_table

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Every action allowed after 0026 (frozen here: a migration must not change with the model).
ACTIONS_0026 = (
    "ATTEMPT_MESSAGE_SENT",
    "REVIEW_STARTED",
    "REVIEW_NOTE_ADDED",
    "REVIEW_EVIDENCE_MARKED",
    "REVIEW_COMPLETED",
    "REVIEW_REVISED",
    "INTERVIEW_CREATED",
    "INTERVIEW_UPDATED",
    "INTERVIEW_DELETED",
    "INTERVIEW_PUBLISHED",
    "INTERVIEW_UNPUBLISHED",
    "INTERVIEW_QUESTION_CREATED",
    "INTERVIEW_QUESTION_UPDATED",
    "INTERVIEW_QUESTION_DELETED",
    "INTERVIEW_QUESTIONS_REORDERED",
    "INTERVIEW_ASSIGNED",
    "INTERVIEW_UNASSIGNED",
    "INTERVIEW_SESSION_STARTED",
    "INTERVIEW_ANSWER_SUBMITTED",
    "INTERVIEW_SESSION_COMPLETED",
    "INTERVIEW_EVALUATION_REQUESTED",
    "INTERVIEW_EVALUATION_COMPLETED",
    "INTERVIEW_EVALUATION_FAILED",
    "INTERVIEW_EVALUATION_RETRIED",
    "INTERVIEW_ADAPTIVE_DECISION",
    "INTERVIEW_REVIEW_STARTED",
    "INTERVIEW_REVIEW_NOTE_ADDED",
    "INTERVIEW_REVIEW_ANSWER_MARKED",
    "INTERVIEW_REVIEW_COMPLETED",
    "INTERVIEW_REVIEW_REVISED",
    "INTERVIEW_CALL_OPENED",
    "INTERVIEW_CALL_JOINED",
    "INTERVIEW_CALL_ENDED",
    "INTERVIEW_CALL_NOTE_ADDED",
    "ATTEMPT_HELD",
    "ATTEMPT_RELEASED",
    "ATTEMPT_ENDED_BY_ADMIN",
    "CODING_PROBLEM_CREATED",
    "CODING_PROBLEM_DELETED",
    "CODING_VERSION_CREATED",
    "CODING_VERSION_PUBLISHED",
    "SIGN_IN_SUCCEEDED",
    "SIGN_IN_FAILED",
    "SIGN_IN_THROTTLED",
    "SIGNED_OUT",
    "SESSIONS_REVOKED",
    "PASSWORD_CHANGED",
    "PASSWORD_RESET_ISSUED",
    "PASSWORD_RESET_COMPLETED",
    "ACCOUNT_DEACTIVATED",
    "ACCOUNT_REACTIVATED",
    "CANDIDATE_CREATED",
    "ASSESSMENT_CREATED",
    "ASSESSMENT_UPDATED",
    "ASSESSMENT_DELETED",
    "ASSESSMENT_MARKED_READY",
    "ASSESSMENT_REVERTED_TO_DRAFT",
    "ASSESSMENT_PUBLISHED",
    "ASSESSMENT_UNPUBLISHED",
    "QUESTION_CREATED",
    "QUESTION_UPDATED",
    "QUESTION_DELETED",
    "CANDIDATE_ASSIGNED",
    "CANDIDATE_UNASSIGNED",
    "ATTEMPT_ACCESS_BLOCKED",
    "ATTEMPT_SESSION_TAKEN_OVER",
)
NEW_ACTIONS = (
    "EVIDENCE_CLIP_CREATED",
    "EVIDENCE_CLIP_READY",
    "EVIDENCE_CLIP_FAILED",
    "EVIDENCE_CLIP_VIEWED",
    "EVIDENCE_CLIP_VERIFIED",
    "EVIDENCE_CLIP_INTEGRITY_FAILED",
    "EVIDENCE_CLIP_DELETED",
    "EVIDENCE_CLIP_EXPIRED",
)
SYSTEM_ACTIONS_0026 = ("SIGN_IN_FAILED", "SIGN_IN_THROTTLED")
SYSTEM_ACTIONS = (*SYSTEM_ACTIONS_0026, "EVIDENCE_CLIP_FAILED", "EVIDENCE_CLIP_EXPIRED")
INDEXES = (
    ("ix_evidence_clips_attempt_id", ["attempt_id"]),
    ("ix_evidence_clips_candidate_id", ["candidate_id"]),
    ("ix_evidence_clips_assessment_id", ["assessment_id"]),
    ("ix_evidence_clips_session_created", ["proctoring_session_id", "created_at"]),
    ("ix_evidence_clips_status_deadline", ["status", "upload_deadline"]),
    ("ix_evidence_clips_status_retain", ["status", "retain_until"]),
)


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.add_column(
        "proctoring_sessions",
        sa.Column("evidence_recorder", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "evidence_clips",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "attempt_id",
            sa.Uuid(),
            sa.ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "proctoring_session_id",
            sa.Uuid(),
            sa.ForeignKey("proctoring_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "assessment_id", sa.Uuid(), sa.ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "trigger_event_id",
            sa.Uuid(),
            sa.ForeignKey("proctoring_events.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("pre_seconds", sa.Integer(), nullable=False),
        sa.Column("post_seconds", sa.Integer(), nullable=False),
        sa.Column("upload_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("upload_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("storage_key", sa.String(128), nullable=True, unique=True),
        sa.Column("content_type", sa.String(40), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("hash_algorithm", sa.String(16), nullable=False, server_default="sha256"),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.String(32), nullable=True),
        sa.Column("retain_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deletion_reason", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('CREATING', 'READY', 'FAILED', 'EXPIRED', 'DELETED')", name="ck_evidence_clips_status"
        ),
        sa.CheckConstraint(
            "source_type IN ('PRIMARY_CAMERA', 'SECONDARY_CAMERA')", name="ck_evidence_clips_source_type"
        ),
        sa.CheckConstraint("window_ends_at > window_starts_at", name="ck_evidence_clips_window"),
        sa.CheckConstraint(
            "status <> 'READY' OR (storage_key IS NOT NULL AND sha256 IS NOT NULL AND byte_size > 0 "
            "AND content_type IS NOT NULL AND retain_until IS NOT NULL)",
            name="ck_evidence_clips_ready_complete",
        ),
        sa.CheckConstraint("sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'", name="ck_evidence_clips_sha256"),
        sa.CheckConstraint("byte_size IS NULL OR byte_size > 0", name="ck_evidence_clips_byte_size"),
        sa.CheckConstraint(
            "duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 600000)",
            name="ck_evidence_clips_duration",
        ),
        sa.CheckConstraint("upload_attempts >= 0", name="ck_evidence_clips_upload_attempts"),
    )
    for name, columns in INDEXES:
        op.create_index(name, "evidence_clips", columns)

    op.create_table(
        "evidence_clip_events",
        sa.Column(
            "clip_id", sa.Uuid(), sa.ForeignKey("evidence_clips.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("proctoring_events.id", ondelete="CASCADE"),
            primary_key=True,
            unique=True,
        ),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0026 + NEW_ACTIONS)
    )
    op.drop_constraint("ck_audit_logs_actor_required", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_actor_required",
        "audit_logs",
        "actor_id IS NOT NULL OR " + _in("action", SYSTEM_ACTIONS),
    )

    for table in ("evidence_clips", "evidence_clip_events"):
        for statement in secure_table(table):
            op.execute(statement)


def downgrade() -> None:
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE " + _in("action", NEW_ACTIONS))  # noqa: S608 — constants only
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.drop_constraint("ck_audit_logs_actor_required", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_actor_required",
        "audit_logs",
        "actor_id IS NOT NULL OR " + _in("action", SYSTEM_ACTIONS_0026),
    )
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", ACTIONS_0026))

    op.drop_table("evidence_clip_events")
    for name, _columns in INDEXES:
        op.drop_index(name, table_name="evidence_clips")
    op.drop_table("evidence_clips")
    op.execute("ALTER TABLE proctoring_sessions DROP COLUMN IF EXISTS evidence_recorder")

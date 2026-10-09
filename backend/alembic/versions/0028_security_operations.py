"""Security operations (Phase 8 final): monitoring, admin MFA, tamper-evident audit, paging indexes

* `security_events`, `security_alerts`, `maintenance_heartbeats` — security monitoring and alerting
  (CX-02/03/13), separate from the business audit log. RLS + the runtime policy like every table.
* `users.mfa_*`, `auth_sessions.mfa_verified_at` — admin TOTP (CX-07).
* `audit_logs.request_id`, `.client_ip` — who/where for every audited action (CX-03).
* `audit_logs.seq`, `.prev_hash`, `.entry_hash` + trigger `audit_logs_chain` — a SHA-256 hash chain set by
  the DATABASE on insert (the application never supplies it), so a changed, removed or inserted row breaks
  the chain (CX-11). Existing rows are chained once here, in (occurred_at, id) order. The append-only
  trigger stays; it is disabled only for that one-time backfill, inside this migration's transaction.
* New audit actions (MFA, audit viewer, alerts, retention); RETENTION_PURGED / AUDIT_CHAIN_VERIFIED may be
  the system's own (no actor).
* Indexes for the bounded, paged lists (CX-04).

Downgrade removes all of it (the chain columns and trigger included). Nothing here deletes existing data.

Revision ID: 0028
Revises: 0027
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.core.db_security import RUNTIME_ROLE, secure_table

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS_0027_NEW = (
    "EVIDENCE_CLIP_CREATED",
    "EVIDENCE_CLIP_READY",
    "EVIDENCE_CLIP_FAILED",
    "EVIDENCE_CLIP_VIEWED",
    "EVIDENCE_CLIP_VERIFIED",
    "EVIDENCE_CLIP_INTEGRITY_FAILED",
    "EVIDENCE_CLIP_DELETED",
    "EVIDENCE_CLIP_EXPIRED",
)
NEW_ACTIONS = (
    "MFA_ENABLED",
    "MFA_RECOVERY_USED",
    "MFA_RESET",
    "AUDIT_LOG_VIEWED",
    "AUDIT_CHAIN_VERIFIED",
    "SECURITY_EVENTS_VIEWED",
    "SECURITY_ALERT_ACKNOWLEDGED",
    "RETENTION_PURGED",
)
SYSTEM_ACTIONS_0027 = ("SIGN_IN_FAILED", "SIGN_IN_THROTTLED", "EVIDENCE_CLIP_FAILED", "EVIDENCE_CLIP_EXPIRED")
SYSTEM_ACTIONS = (*SYSTEM_ACTIONS_0027, "RETENTION_PURGED", "AUDIT_CHAIN_VERIFIED")
NEW_TABLES = ("security_events", "security_alerts", "maintenance_heartbeats")
PAGING_INDEXES = (
    ("ix_assessments_created_id", "assessments", ["created_at", "id"]),
    ("ix_assignments_candidate_assigned", "assessment_assignments", ["candidate_id", "assigned_at"]),
    ("ix_attempts_candidate_started", "assessment_attempts", ["candidate_id", "started_at"]),
    ("ix_users_role_created", "users", ["role", "created_at"]),
)

#: The canonical text each row is hashed over: fixed field order, explicit separators, UTC timestamps
#: with microseconds, and `jsonb::text` (which PostgreSQL renders deterministically).
CANONICAL_FN = """
CREATE OR REPLACE FUNCTION audit_canonical(
    p_id uuid, p_actor uuid, p_action text, p_attempt uuid, p_assessment uuid, p_interview uuid,
    p_isession uuid, p_occurred timestamptz, p_details jsonb, p_request text, p_client text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT concat_ws('|',
        p_id::text, coalesce(p_actor::text, ''), p_action, coalesce(p_attempt::text, ''),
        coalesce(p_assessment::text, ''), coalesce(p_interview::text, ''), coalesce(p_isession::text, ''),
        to_char(p_occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        coalesce(p_details::text, '{}'), coalesce(p_request, ''), coalesce(p_client, ''))
$$;
"""

CHAIN_FN = """
CREATE OR REPLACE FUNCTION audit_logs_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    previous text;
BEGIN
    -- One writer at a time extends the chain; released at commit.
    PERFORM pg_advisory_xact_lock(727201);
    SELECT entry_hash INTO previous FROM audit_logs WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1;
    NEW.seq := nextval('audit_logs_seq_seq');
    NEW.prev_hash := coalesce(previous, repeat('0', 64));
    NEW.entry_hash := encode(sha256(convert_to(NEW.prev_hash || '|' || audit_canonical(
        NEW.id, NEW.actor_id, NEW.action, NEW.attempt_id, NEW.assessment_id, NEW.interview_id,
        NEW.interview_session_id, NEW.occurred_at, NEW.details, NEW.request_id, NEW.client_ip),
        'UTF8')), 'hex');
    RETURN NEW;
END
$$;
"""

BACKFILL = """
DO $$
DECLARE
    r record;
    previous text := repeat('0', 64);
    n bigint := 0;
BEGIN
    FOR r IN SELECT * FROM audit_logs ORDER BY occurred_at, id LOOP
        n := n + 1;
        UPDATE audit_logs SET
            seq = n,
            prev_hash = previous,
            entry_hash = encode(sha256(convert_to(previous || '|' || audit_canonical(
                r.id, r.actor_id, r.action, r.attempt_id, r.assessment_id, r.interview_id,
                r.interview_session_id, r.occurred_at, r.details, r.request_id, r.client_ip), 'UTF8')), 'hex')
        WHERE id = r.id
        RETURNING entry_hash INTO previous;
    END LOOP;
    PERFORM setval('audit_logs_seq_seq', greatest(n, 1), n > 0);
END
$$;
"""


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _current_actions() -> tuple[str, ...]:
    """The action list as of 0027 — read from that migration so it is not copied a third time."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).with_name("0027_evidence_clips.py")
    spec = importlib.util.spec_from_file_location("m0027", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return tuple(module.ACTIONS_0026) + ACTIONS_0027_NEW


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("client_ip", sa.String(45), nullable=True),
        sa.Column("target_type", sa.String(40), nullable=True),
        sa.Column("target_id", sa.String(64), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.CheckConstraint(
            "severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')", name="ck_security_events_severity"
        ),
    )
    op.create_index("ix_security_events_type_occurred", "security_events", ["event_type", "occurred_at"])
    op.create_index("ix_security_events_occurred", "security_events", ["occurred_at"])
    op.create_index("ix_security_events_actor_occurred", "security_events", ["actor_id", "occurred_at"])
    op.create_index("ix_security_events_client_occurred", "security_events", ["client_ip", "occurred_at"])

    op.create_table(
        "security_alerts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rule", sa.String(64), nullable=False),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("group_key", sa.String(80), nullable=False),
        sa.Column("event_count", sa.Integer(), nullable=False),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("delivery", sa.String(20), nullable=False, server_default="logged"),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "acknowledged_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.CheckConstraint(
            "severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')", name="ck_security_alerts_severity"
        ),
    )
    op.create_index(
        "ix_security_alerts_rule_group_created", "security_alerts", ["rule", "group_key", "created_at"]
    )
    op.create_index("ix_security_alerts_created", "security_alerts", ["created_at"])

    op.create_table(
        "maintenance_heartbeats",
        sa.Column("name", sa.String(40), primary_key=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(20), nullable=False),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )

    op.add_column("users", sa.Column("mfa_secret_enc", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("mfa_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("mfa_last_step", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("mfa_recovery_hashes", postgresql.JSONB(), nullable=True))
    op.add_column("auth_sessions", sa.Column("mfa_verified_at", sa.DateTime(timezone=True), nullable=True))

    # -- audit: who/where, and the hash chain ------------------------------------------------------------
    op.add_column("audit_logs", sa.Column("request_id", sa.String(64), nullable=True))
    op.add_column("audit_logs", sa.Column("client_ip", sa.String(45), nullable=True))
    op.add_column("audit_logs", sa.Column("seq", sa.BigInteger(), nullable=True))
    op.add_column("audit_logs", sa.Column("prev_hash", sa.String(64), nullable=True))
    op.add_column("audit_logs", sa.Column("entry_hash", sa.String(64), nullable=True))
    op.execute("CREATE SEQUENCE audit_logs_seq_seq")
    op.execute(CANONICAL_FN)
    op.execute(CHAIN_FN)
    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute(BACKFILL)
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    op.create_index("ux_audit_logs_seq", "audit_logs", ["seq"], unique=True)
    op.execute(
        "CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_chain()"
    )
    grant = f"GRANT USAGE, SELECT ON SEQUENCE audit_logs_seq_seq TO {RUNTIME_ROLE}"
    exists = f"SELECT 1 FROM pg_roles WHERE rolname = '{RUNTIME_ROLE}'"  # noqa: S608 — a module constant
    op.execute(f"DO $$ BEGIN IF EXISTS ({exists}) THEN {grant}; END IF; END $$")

    actions = _current_actions()
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", actions + NEW_ACTIONS))
    op.drop_constraint("ck_audit_logs_actor_required", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_actor_required",
        "audit_logs",
        "actor_id IS NOT NULL OR " + _in("action", SYSTEM_ACTIONS),
    )

    for name, table, columns in PAGING_INDEXES:
        op.create_index(name, table, columns)

    for table in NEW_TABLES:
        for statement in secure_table(table):
            op.execute(statement)


def downgrade() -> None:
    for name, table, _columns in PAGING_INDEXES:
        op.drop_index(name, table_name=table)

    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute("DELETE FROM audit_logs WHERE " + _in("action", NEW_ACTIONS))  # noqa: S608 — constants only
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    actions = _current_actions()
    op.drop_constraint("ck_audit_logs_actor_required", "audit_logs", type_="check")
    op.create_check_constraint(
        "ck_audit_logs_actor_required",
        "audit_logs",
        "actor_id IS NOT NULL OR " + _in("action", SYSTEM_ACTIONS_0027),
    )
    op.drop_constraint("ck_audit_logs_action", "audit_logs", type_="check")
    op.create_check_constraint("ck_audit_logs_action", "audit_logs", _in("action", actions))

    op.execute("DROP TRIGGER IF EXISTS audit_logs_chain ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_chain()")
    op.drop_index("ux_audit_logs_seq", table_name="audit_logs")
    for column in ("entry_hash", "prev_hash", "seq", "client_ip", "request_id"):
        op.drop_column("audit_logs", column)
    op.execute("DROP SEQUENCE IF EXISTS audit_logs_seq_seq")
    op.execute(
        "DROP FUNCTION IF EXISTS audit_canonical("
        "uuid, uuid, text, uuid, uuid, uuid, uuid, timestamptz, jsonb, text, text)"
    )

    op.drop_column("auth_sessions", "mfa_verified_at")
    for column in ("mfa_recovery_hashes", "mfa_last_step", "mfa_enabled_at", "mfa_secret_enc"):
        op.drop_column("users", column)
    op.drop_table("maintenance_heartbeats")
    op.drop_index("ix_security_alerts_created", table_name="security_alerts")
    op.drop_index("ix_security_alerts_rule_group_created", table_name="security_alerts")
    op.drop_table("security_alerts")
    for index in (
        "ix_security_events_client_occurred",
        "ix_security_events_actor_occurred",
        "ix_security_events_occurred",
        "ix_security_events_type_occurred",
    ):
        op.drop_index(index, table_name="security_events")
    op.drop_table("security_events")

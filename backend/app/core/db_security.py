"""Database privileges and row level security (Phase 8B, BX-01 / BX-05).

The intended architecture is **app → FastAPI → PostgreSQL**. Nothing else — no browser, no candidate,
no Supabase Data API — should read or write AssessX tables. Two layers make that hold:

* **A least-privilege runtime role.** `assessx_runtime` (NOLOGIN) holds exactly what the API needs:
  SELECT/INSERT/UPDATE/DELETE on the application tables, and only SELECT/INSERT on the append-only
  `audit_logs`. It owns nothing, so it cannot ALTER or DROP a table, disable the audit trigger, or
  create objects. Production connects as a LOGIN user that is a member of it (see
  docs/security/DATABASE-ROLES.md); migrations keep using the owner role.
* **Row level security on every table, with an explicit policy for the runtime role only.** The policy
  admits `assessx_runtime` to every row (authorization is the API's job); any other non-owner role —
  Supabase's `anon` and `authenticated` among them — has no policy and sees nothing, even if a
  permission were granted by mistake. RLS is *not* forced, so the owning role (migrations, the
  pre-8B runtime) is unaffected.

Every new table must call `secure_table` in its migration; `tests/test_security_hardening.py` fails otherwise.
"""

RUNTIME_ROLE = "assessx_runtime"
POLICY_NAME = "assessx_runtime_access"
#: Tables the runtime may only read and append to.
APPEND_ONLY = frozenset({"audit_logs"})


_ENSURE_RUNTIME_ROLE = """
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assessx_runtime') THEN
        CREATE ROLE assessx_runtime NOLOGIN;
    END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO assessx_runtime;
"""
assert "'" + RUNTIME_ROLE + "'" in _ENSURE_RUNTIME_ROLE


def ensure_runtime_role() -> str:
    """Creates the runtime role if it does not exist. Roles are cluster-wide, so never dropped here."""
    return _ENSURE_RUNTIME_ROLE


def secure_table(table: str) -> list[str]:
    """RLS on, the runtime policy, and the runtime's table privileges for one table."""
    privileges = "SELECT, INSERT" if table in APPEND_ONLY else "SELECT, INSERT, UPDATE, DELETE"
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"DROP POLICY IF EXISTS {POLICY_NAME} ON {table}",
        f"CREATE POLICY {POLICY_NAME} ON {table} FOR ALL TO {RUNTIME_ROLE} USING (true) WITH CHECK (true)",
        f"GRANT {privileges} ON {table} TO {RUNTIME_ROLE}",
    ]


def unsecure_table(table: str, *, keep_rls: bool) -> list[str]:
    statements = [
        f"DROP POLICY IF EXISTS {POLICY_NAME} ON {table}",
        f"REVOKE ALL ON {table} FROM {RUNTIME_ROLE}",
    ]
    if not keep_rls:
        statements.append(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    return statements


def revoke_supabase_api_roles() -> str:
    """Removes every privilege Supabase's Data API roles hold on the public schema, now and for objects
    the migrating role creates later. A no-op where those roles do not exist (local PostgreSQL)."""
    return """
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role
            );
        END IF;
    END LOOP;
END
$$;
"""

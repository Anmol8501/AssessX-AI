# Database roles, row level security and the production connection (Phase 8B — BX-01, BX-05, BX-09, BX-15)

The intended architecture is **desktop app → FastAPI → PostgreSQL**. Nothing else (no browser, no
candidate, no Supabase Data API) should read or write AssessX tables. This document explains what the
repository now enforces, what an operator must still do by hand in Supabase and Render, and how to check
it, using read-only queries only.

> Nothing in this document needs a secret to be pasted into the repository, a chat or a ticket. Every
> password below is generated and stored by the operator, in the Supabase dashboard and as a Render
> secret environment variable.

## 1. What migration `0026_security_hardening` does

Code: `backend/app/core/db_security.py`, migration `backend/alembic/versions/0026_security_hardening.py`.

| Step | Effect | Reversible |
|---|---|---|
| `CREATE ROLE assessx_runtime NOLOGIN` (if missing) | A privilege bundle. It cannot sign in itself and owns nothing | role is never dropped (roles are cluster-wide) |
| `GRANT USAGE ON SCHEMA public` | lets members see the schema | — |
| For each of the 39 application tables (41 with the evidence-clip tables of migration 0027): `ENABLE ROW LEVEL SECURITY` | rows are hidden from every non-owner role that has no policy | downgrade keeps RLS on tables that had it before |
| `CREATE POLICY assessx_runtime_access … TO assessx_runtime USING (true) WITH CHECK (true)` | the runtime role sees every row. Authorization stays in the API | dropped on downgrade |
| `GRANT SELECT, INSERT, UPDATE, DELETE` (only `SELECT, INSERT` on `audit_logs`) | least privilege: no DDL, no TRUNCATE, no audit-history rewrite | revoked on downgrade |
| Revoke everything from `anon` and `authenticated` (tables, sequences, functions and default privileges), only where those roles exist | Supabase's Data API roles get nothing, now and for future tables | not re-granted on downgrade (deliberately) |

RLS is **enabled, not forced**. The owning role (the one that runs migrations; `postgres` on Supabase)
bypasses it, so the API keeps working unchanged whether it connects as the owner (today) or as the
runtime user (after §3).

Every new table must call `secure_table(...)` in its migration.
`tests/test_security_hardening.py::test_every_table_has_rls_and_the_runtime_policy` fails otherwise.

### Verified locally

* Migration up → down → up on the development database.
* pytest: every table has RLS, the policy and the grants. Under `SET LOCAL ROLE assessx_runtime` the
  role can do the API's DML but cannot `UPDATE` or `DELETE` audit rows. A role with a grant but no policy
  sees 0 rows.
* End-to-end (Phase 8B remediation run): the API was started with `DATABASE_URL` pointing at a LOGIN
  user that is only a member of `assessx_runtime`. All 23 checks passed:
  * signing in, sessions, admin and candidate routes, a WebSocket ticket and the monitoring socket all
    worked;
  * as that user, `UPDATE`/`DELETE audit_logs`, `DROP`/`ALTER`/`CREATE TABLE` and disabling RLS were all
    refused.

## 2. BX-01: check production (read-only; run in the Supabase SQL editor)

The repository cannot see the production database. Run these **read-only** queries after the 0026
migration has been deployed, and keep the output with the release record.

```sql
-- a) RLS on every AssessX table (expect rowsecurity = true for all 41 after migration 0027)
select tablename, tableowner, rowsecurity
from pg_tables where schemaname = 'public' order by 1;

-- b) The runtime policy exists on every table (expect 41 after migration 0027)
select count(*) from pg_policies
where schemaname = 'public' and policyname = 'assessx_runtime_access';

-- c) The Data API roles hold nothing on AssessX tables (expect 0 rows)
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- d) Role attributes (assessx_runtime: no login, no superuser, no bypassrls)
select rolname, rolcanlogin, rolsuper, rolbypassrls
from pg_roles where rolname in ('assessx_runtime', 'anon', 'authenticated', 'postgres')
order by 1;

-- e) AX-03: demo or seed accounts that must not exist in production (expect 0 active rows)
select email, role, is_active from users where email ilike '%@assessx.local';
```

Also in the dashboard: **Project Settings → Data API**. If AssessX does not use the Data API (it does
not), remove `public` from **Exposed schemas**, or turn the Data API off. Even without this, (a) to (c)
mean the API roles see nothing.

## 3. BX-05: run the API as a least-privilege user (manual, operator only)

Today production connects as the owner (`postgres.<project-ref>`). That works, but a bug in the API
would then run with the power to drop tables and rewrite the audit trail. The fix is to give the API
its own LOGIN user, a member of `assessx_runtime`, and keep the owner for migrations only.

**Do this in a maintenance window, after 0026 is deployed and §2 is verified.** It is fully reversible:
pointing `DATABASE_URL` back at the owner restores today's behaviour.

1. **Create the login user** (Supabase SQL editor, as `postgres`). Generate the password locally and
   paste it straight into the SQL editor. Never commit it or send it in chat.
   ```sql
   create role assessx_api login password '<generated, 32+ random characters>' in role assessx_runtime;
   grant connect on database postgres to assessx_api;
   ```
2. **Render → Environment** (both are *secret* values):
   * `ALEMBIC_DATABASE_URL`: the current owner Session-pooler URL (what `DATABASE_URL` holds today).
   * `DATABASE_URL`: the same pooler URL with user `assessx_api.<project-ref>` and the new password.
     Supavisor addresses a custom role as `<role>.<project-ref>`. Confirm the connection in step 4.
3. **Render → Start Command**: migrations use the owner; the API process does not even receive the
   owner URL.
   ```
   alembic upgrade head && env -u ALEMBIC_DATABASE_URL uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log --ws-max-size 262144
   ```
4. Deploy, then check `GET /api/v1/health` (`"database":"ok"`), sign in as an admin and as a candidate,
   and open the live monitoring page. If anything fails, set `DATABASE_URL` back to the owner URL and
   redeploy. Nothing else needs to be undone.
5. Run once to confirm: `select usename, count(*) from pg_stat_activity where datname = current_database() group by 1;`.
   The API's connections should show as `assessx_api`.

## 4. BX-09: verify the database server's certificate

`?sslmode=require` encrypts the connection but does not check whom it talks to. `verify-full` also
checks the certificate chain and host name.

1. Supabase dashboard → **Project Settings → Database → SSL Configuration → Download certificate**.
2. Render → **Secret Files**: add it as `supabase-ca.crt`. Render mounts it at
   `/etc/secrets/supabase-ca.crt`.
3. Change both URLs' query to `?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt`.
4. Deploy and check `/api/v1/health`. If it reports the database down, revert the query to
   `?sslmode=require` and recheck the certificate file.

## 5. Other production settings introduced in Phase 8A/8B

| Variable | Value on Render | Why |
|---|---|---|
| `CLIENT_IP_HEADER` | `cf-connecting-ip` (verify first) | **BX-15.** Sign-in throttling needs the real client address. The API never reads `X-Forwarded-For` itself. But while it is unset, it uses the connection address, and uvicorn rewrites that from the *leftmost* `X-Forwarded-For` value because `FORWARDED_ALLOW_IPS=*`. A client can forge that value, so it can dodge the per-client limits. The per-account limits still hold. Render's edge is Cloudflare, which sets `CF-Connecting-IP`, but that was **not verified from the repository**. After setting it: sign in once with a correct security check and a wrong password, then check that the `client` field of the newest `SIGN_IN_FAILED` audit row is your public IP. If it is empty or a private address, unset the variable again. Per-client defaults (150 failures per 15 min, 400 security checks per 10 min) are sized for a whole exam hall behind one NAT address |
| `WS_ALLOW_LEGACY_TOKEN` | `true` until every desktop app is ≥ 0.1.4, then `false` | Desktop 0.1.4 opens WebSockets with one-time tickets. Older apps still send the session token in the URL. Turning this off removes that path |
| `MAX_REQUEST_BYTES` | default 2 MiB | request bodies larger than this get 413 before the app reads them |
| `LOGIN_*`, `CHALLENGE_*`, `PASSWORD_RESET_TTL_MINUTES`, `EXAM_TAKEOVER_AFTER_SECONDS` | defaults | see `backend/app/core/config.py` |

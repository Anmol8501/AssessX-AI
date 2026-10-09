# Disaster recovery

## Targets

| Objective | Target | How |
|---|---|---|
| **RPO** (data you can lose) | about 24 h; **run an extra backup before and after exam sessions** for about 1 h around exams | daily scheduled backup at 02:17 UTC, plus a manual run (Actions → Backup → Run workflow) |
| **RTO** (time to be back) | about 2 h | a new Supabase project, a restore (seconds to minutes at current size), configuration, redeploy, checks |

## Backup architecture

```
GitHub Actions "Backup" (daily; monthly with a restore drill)
  └─ pg_dump --format=custom --schema=public   (read-only on the database)
  └─ GnuPG AES-256 encryption with BACKUP_PASSPHRASE   → the plaintext dump is deleted on the runner
  └─ .sha256 checksum
  └─ workflow artifact, kept 30 days                   → off the database provider (in GitHub)
  └─ heartbeat → API /internal/maintenance/backup-heartbeat
                    └─ no success in 26 h → backup_missing → HIGH alert
```

* **Code:** `infrastructure/backup/` (standard library, PostgreSQL 17 client tools, GnuPG) and
  `.github/workflows/backup.yml`.
* **Encrypted at rest:** artifacts are encrypted before upload. Even so, prefer a **private** repository:
  artifacts of a public repository can be downloaded by any GitHub user, who would then need the
  passphrase.
* **Retention:** 30 days in GitHub. For longer retention, download a monthly backup to an encrypted
  offline disk.
* **Never in Git:** backups, dumps and passphrases are ignored by `.gitignore`.

## Restore procedure (database lost or corrupted)

1. **Contain.** If the cause is a compromise, follow `INCIDENT-RESPONSE.md` first: rotate credentials
   before restoring, so the attacker doesn't simply return.
2. **Create a new Supabase project.** Its database is empty.
3. **Get the newest good backup.** GitHub → Actions → Backup → a successful run → artifact. Unzip it to
   get the `.dump.gpg` and `.sha256` files.
4. **Restore** on a trusted machine:
   ```powershell
   $env:RESTORE_DATABASE_URL = '<new project URL>'
   $env:BACKUP_PASSPHRASE    = '<from the password manager>'
   python infrastructure\backup\restore.py assessx-<time>.dump.gpg --target-is-a-new-production-database
   ```
   The restore checks the hash, refuses a non-empty target, and runs in one transaction. It creates the
   `assessx_runtime` role if missing; roles, RLS policies, grants, the audit triggers and the audit hash
   chain all come back with the schema.
5. **Re-create the least-privilege login user** (`docs/security/DATABASE-ROLES.md` §3).
6. **Point Render at the new project:** `DATABASE_URL` and `ALEMBIC_DATABASE_URL`. Deploy.
7. **Verify:**
   * `GET /api/v1/health` returns `database: ok`;
   * sign in as an admin (with MFA);
   * **Security → Audit trail → Verify audit chain** passes;
   * the read-only checks in `DATABASE-ROLES.md` §2 pass.
8. **Update the backup secret** `BACKUP_DATABASE_URL`, then run the Backup workflow once by hand.

**Evidence clip videos** live in the storage bucket, not the database. If the bucket survives, clips stay
viewable. If it doesn't, their records show the video as unavailable, which is the same as expiry.

## Verification: what must be tested, and when

| Check | Frequency | How |
|---|---|---|
| A backup ran | daily | automatic: the heartbeat, plus a `backup_missing` alert after 26 h |
| A backup restores | monthly | automatic: the Backup workflow's drill on the 1st restores into a throwaway database and compares row counts with the source |
| Full disaster rehearsal | twice a year | restore into a **scratch** Supabase project, point a test API at it, sign in, verify the audit chain. Never restore into production |
| Passphrase still available | each rehearsal | decrypt with the copy in the password manager |

## Failure response

* **A backup run failed:** a HIGH alert, plus GitHub's failed-workflow email. Open the run log and fix
  the cause (credentials, network, disk). Re-run by hand.
* **No backup for 26 h:** a `backup_missing` alert. Check the workflow is enabled and its secrets are
  set.
* **The restore drill fails:** treat backups as unusable until it's fixed. Take a manual backup and test
  it locally (`BACKUP-AND-RESTORE.md`, "Restore drill").

## Credential rotation after a compromise

Rotate in this order, then redeploy:
1. **Supabase database password**, which changes `DATABASE_URL`, `ALEMBIC_DATABASE_URL` and
   `BACKUP_DATABASE_URL`.
2. **`SUPABASE_SERVICE_ROLE_KEY`** (rotate the JWT secret or API keys in Supabase).
3. **`SECRET_KEY`.** This signs everyone out and invalidates admin MFA enrolments; admins re-enrol, and
   the CLI's `reset-admin-mfa` is there if needed.
4. **`MAINTENANCE_TOKEN`, `RUNNER_TOKEN`, `LLM_API_KEY` and `ALERT_WEBHOOK_URL`.**
5. **`BACKUP_PASSPHRASE`.** New backups use the new one. Keep the old one until all old backups have
   expired.
6. **The update-signing key**, only if it is suspected compromised. Follow the rollover procedure in
   `docs/security/REPOSITORY-AND-RELEASE-SECURITY.md`.

# Backup and restore (Phase 8B — BX-04)

AssessX keeps everything that matters in PostgreSQL: accounts, assessments, answers, results, proctoring
events, evidence metadata and the audit trail. Supabase Free has **no downloadable or point-in-time
backups**, so the operator must take them. Scripts: `infrastructure/backup/` (Python standard library,
plus the PostgreSQL 17 client tools *or* Docker, plus GnuPG, which ships with Git for Windows).

## What a backup is

* `pg_dump --format=custom --schema=public --no-owner`: every AssessX table, its data, RLS policies,
  grants, the audit trigger and `alembic_version`. Supabase's own schemas (`auth`, `storage`, …) are not
  included; AssessX does not use them.
* Encrypted immediately with GnuPG (AES-256, symmetric). The unencrypted dump is written briefly to the
  backup directory and is always deleted, even on failure.
* A `.sha256` file next to each backup. Restore refuses a file that doesn't match.
* Retention: the newest `BACKUP_KEEP` (default 14) are kept, older ones deleted.

## Taking a backup

PowerShell, on a trusted machine (e.g. the release machine):

```powershell
$env:BACKUP_DATABASE_URL = '<Supabase session-pooler URL, owner or a read-capable user>'  # never commit
$env:BACKUP_PASSPHRASE   = '<from your password manager, 16+ characters>'
$env:BACKUP_DIR          = 'D:\assessx-backups'   # optional; default ~/assessx-backups
python infrastructure\backup\backup.py
Remove-Item Env:BACKUP_DATABASE_URL, Env:BACKUP_PASSPHRASE
```

* It only reads from the database.
* Neither the URL's password nor the passphrase is printed or passed on a command line.
* Keep a copy **off the machine** (an encrypted cloud drive or an external disk). The file is already
  encrypted.
* Store the passphrase in a password manager, **not** next to the backups. Without it, a backup cannot be
  restored.
* Schedule: before every release or migration, and daily while exams are running (Windows Task
  Scheduler; set the two variables in the task's environment, not in a script file).

## Restoring

`restore.py` restores **only into an empty database**. It refuses:

* a target whose `public` schema already has tables;
* a target whose name doesn't contain `restore` or `drill`, unless `--target-is-a-new-production-database`
  is given;
* a backup that doesn't match its `.sha256`;
* a wrong passphrase.

The restore runs in **one transaction**, so a failure leaves the target empty.

```powershell
$env:RESTORE_DATABASE_URL = '<URL of the EMPTY target database>'
$env:BACKUP_PASSPHRASE    = '<passphrase>'
python infrastructure\backup\restore.py D:\assessx-backups\assessx-20261006T060228Z.dump.gpg
```

To compare row counts with a live source (read-only), set its URL in another variable and add
`--compare-with-env THAT_VARIABLE`.

### Disaster recovery (production lost)

1. Create a new Supabase project. Its database is empty.
2. Run `restore.py` against it with `--target-is-a-new-production-database`. This also creates the
   `assessx_runtime` role if it is missing.
3. Re-create the least-privilege login user (`DATABASE-ROLES.md` §3). Roles are not part of the dump.
4. Point Render's `DATABASE_URL` (and `ALEMBIC_DATABASE_URL`) at the new project, deploy, and check
   `/api/v1/health`.
5. Run the read-only checks in `DATABASE-ROLES.md` §2.
6. Everyone signs in again only if `SECRET_KEY` changed. Sessions are in the restored database.

## Restore drill (do this before relying on backups)

Never against production. The drill restores into a scratch database on the local Docker cluster.

```bash
docker exec assessx-postgres psql -U assessx -d postgres -c "CREATE DATABASE assessx_restore_drill"
BACKUP_DATABASE_URL=<local dev URL> BACKUP_PASSPHRASE=<test passphrase> python infrastructure/backup/backup.py
RESTORE_DATABASE_URL=<local URL>/assessx_restore_drill SRC_URL=<local dev URL> BACKUP_PASSPHRASE=<same> \
  python infrastructure/backup/restore.py <newest .dump.gpg> --compare-with-env SRC_URL
docker exec assessx-postgres psql -U assessx -d postgres -c "DROP DATABASE assessx_restore_drill"
```

**Last drill: 2026-10-06 (Phase 8B remediation), local development database.**

* Three encrypted backups were taken and retention kept the newest two. The files start with an OpenPGP
  packet, not the plaintext `PGDMP` header, and no unencrypted file was left behind.
* The restore produced 40 tables and 34,864 rows, and row counts matched the source for all 40 tables,
  in 12.6 s.
* The restored copy had RLS on 39 of 39 tables, 39 runtime policies, grants on 39 tables, the
  append-only audit trigger, and migration `0026`.
* Refused as designed: a production-named target, a non-empty target, a wrong passphrase, and a
  tampered checksum.

A drill against a copy of *production* data has **not** been done. Do one after the first production
backup, into a scratch database (never into the production project).

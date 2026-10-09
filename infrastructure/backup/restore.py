"""Restore an encrypted AssessX backup into an EMPTY database (Phase 8B, BX-04).

    RESTORE_DATABASE_URL=...  BACKUP_PASSPHRASE=...  python infrastructure/backup/restore.py <file.dump.gpg>

Safety rules. The script refuses to run unless all of these hold:

* the backup's `.sha256` file matches, when it is present;
* the target database's `public` schema has no tables, so it never overwrites a live database;
* the target database name contains `restore` or `drill`, unless `--target-is-a-new-production-database`
  is given. Use that flag only when rebuilding production into a brand-new, empty project.

Afterwards it prints the row count of every table so the result can be compared with the source
(`--compare-with-env BACKUP_DATABASE_URL` does the comparison itself, read-only).
Runbook: docs/security/BACKUP-AND-RESTORE.md.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pgtools import Conn, gpg, require_env, run_tool, tool_path  # noqa: E402

COUNT_SQL = r"""
select format('select %L || ''|'' || count(*) from public.%I;', tablename, tablename)
from pg_tables where schemaname = 'public' order by tablename
\gexec
"""


def _psql(conn: Conn, statement: str) -> list[str]:
    """Runs SQL through psql (on stdin) and returns the non-empty output lines."""
    with tempfile.TemporaryFile() as stdin:
        stdin.write(statement.encode())
        stdin.seek(0)
        done = run_tool(
            "psql",
            conn,
            ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"],
            stdin=stdin,
            stdout=subprocess.PIPE,
        )
    if done.returncode != 0:
        sys.exit(f"psql failed against {conn.describe()}")
    return [line for line in done.stdout.decode().splitlines() if line.strip()]


def row_counts(conn: Conn) -> dict[str, int]:
    counts = {}
    for line in _psql(conn, COUNT_SQL):
        table, _, count = line.rpartition("|")
        counts[table] = int(count)
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("backup", type=Path)
    parser.add_argument("--target-is-a-new-production-database", action="store_true")
    parser.add_argument(
        "--compare-with-env",
        metavar="ENV_NAME",
        help="env var holding the source URL to compare row counts with",
    )
    options = parser.parse_args()

    target = Conn.from_url(require_env("RESTORE_DATABASE_URL"))
    passphrase = require_env("BACKUP_PASSPHRASE")
    backup: Path = options.backup
    if not backup.is_file():
        sys.exit(f"No such backup: {backup}")

    checksum_file = backup.with_name(backup.name + ".sha256")
    if checksum_file.is_file():
        expected = checksum_file.read_text().split()[0]
        actual = hashlib.sha256(backup.read_bytes()).hexdigest()
        if expected != actual:
            sys.exit(
                "The backup does not match its .sha256 file. It is corrupt or was altered. Not restoring."
            )
        print("Checksum OK")

    name = target.dbname.lower()
    if not ("restore" in name or "drill" in name) and not options.target_is_a_new_production_database:
        sys.exit(
            f"Refusing to restore into '{target.dbname}': use a database whose name contains 'restore' or "
            "'drill', or pass --target-is-a-new-production-database for a brand-new empty project."
        )
    existing = _psql(target, "select count(*) from pg_tables where schemaname = 'public';")
    if existing and int(existing[0]) > 0:
        sys.exit(f"Refusing to restore: {target.describe()} already has {existing[0]} tables in public.")

    # The runtime role the schema's grants and policies refer to (cluster-wide; created if missing).
    _psql(
        target,
        "do $$ begin if not exists (select 1 from pg_roles where rolname = 'assessx_runtime') "
        "then create role assessx_runtime nologin; end if; end $$;",
    )

    with tempfile.TemporaryDirectory(prefix="assessx-restore-") as work:
        plain = Path(work) / "backup.dump"
        decrypted = subprocess.run(  # noqa: S603 — fixed argument list, no shell
            [
                gpg(),
                "--batch",
                "--yes",
                "--quiet",
                "--pinentry-mode",
                "loopback",
                "--passphrase-fd",
                "0",
                "--decrypt",
                "--output",
                str(plain),
                str(backup),
            ],
            input=passphrase.encode(),
            check=False,
        )
        if decrypted.returncode != 0:
            sys.exit("Decryption failed: wrong BACKUP_PASSPHRASE, or the file is not an AssessX backup.")
        # Every database already has a `public` schema, so the dump's CREATE SCHEMA public (and its
        # comment) is left out through a table-of-contents list; everything else is restored.
        listing = run_tool(
            "pg_restore",
            target,
            ["-l", tool_path("pg_restore", str(plain), work)],
            mount=work,
            connect=False,
            stdout=subprocess.PIPE,
        )
        if listing.returncode != 0:
            sys.exit("Could not read the backup's table of contents.")
        entries = [
            line
            for line in listing.stdout.decode().splitlines()
            if " SCHEMA - public " not in line and " COMMENT - SCHEMA public " not in line
        ]
        toc = Path(work) / "toc.list"
        toc.write_text("\n".join(entries) + "\n")
        print(f"Restoring into {target.describe()} ...")
        restored = run_tool(
            "pg_restore",
            target,
            [
                "--no-owner",
                "--exit-on-error",
                "--single-transaction",
                "-L",
                tool_path("pg_restore", str(toc), work),
                tool_path("pg_restore", str(plain), work),
            ],
            mount=work,
        )
        if restored.returncode != 0:
            print("pg_restore failed; the single transaction was rolled back.", file=sys.stderr)
            return 1

    counts = row_counts(target)
    print(f"Restored {len(counts)} tables, {sum(counts.values()):,} rows.")
    if options.compare_with_env:
        source = Conn.from_url(require_env(options.compare_with_env))
        expected = row_counts(source)
        diff = {
            t: (expected.get(t), counts.get(t))
            for t in set(expected) | set(counts)
            if expected.get(t) != counts.get(t)
        }
        if diff:
            print("Row counts differ from the source (source, restored):")
            for table, pair in sorted(diff.items()):
                print(f"  {table}: {pair}")
            return 1
        print(f"Row counts match the source for all {len(counts)} tables.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

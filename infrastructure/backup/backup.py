"""Encrypted logical backup of the AssessX database (Phase 8B, BX-04).

    BACKUP_DATABASE_URL=...  BACKUP_PASSPHRASE=...  python infrastructure/backup/backup.py

* Dumps the `public` schema (every AssessX table, alembic_version included) with `pg_dump
  --format=custom`. It is read-only against the database.
* Encrypts the dump with GnuPG (AES-256, symmetric) before it is kept, and writes a `.sha256` file next
  to it. The unencrypted dump exists only briefly in the backup directory and is always deleted.
* Keeps the newest BACKUP_KEEP backups (default 14) in BACKUP_DIR (default ~/assessx-backups) and
  deletes older ones.

The URL and passphrase come only from the environment. Neither is printed. Store the passphrase
somewhere other than the backups (a password manager); without it a backup cannot be restored.
Runbook: docs/security/BACKUP-AND-RESTORE.md.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pgtools import Conn, gpg, require_env, run_tool  # noqa: E402

PREFIX = "assessx-"
SUFFIX = ".dump.gpg"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    conn = Conn.from_url(require_env("BACKUP_DATABASE_URL"))
    passphrase = require_env("BACKUP_PASSPHRASE")
    if len(passphrase) < 16:
        sys.exit("BACKUP_PASSPHRASE must be at least 16 characters.")
    directory = Path(os.environ.get("BACKUP_DIR") or Path.home() / "assessx-backups")
    keep = int(os.environ.get("BACKUP_KEEP", "14"))
    directory.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    plain = directory / f"{PREFIX}{stamp}.dump.partial"
    final = directory / f"{PREFIX}{stamp}{SUFFIX}"
    print(f"Backing up {conn.describe()} -> {final}")
    try:
        with plain.open("wb") as out:
            dumped = run_tool(
                "pg_dump", conn, ["--format=custom", "--schema=public", "--no-owner"], stdout=out
            )
        if dumped.returncode != 0 or plain.stat().st_size == 0:
            print("pg_dump failed; no backup was written.", file=sys.stderr)
            return 1
        encrypted = subprocess.run(  # noqa: S603 — fixed argument list, no shell
            [
                gpg(),
                "--batch",
                "--yes",
                "--quiet",
                "--pinentry-mode",
                "loopback",
                "--passphrase-fd",
                "0",
                "--symmetric",
                "--cipher-algo",
                "AES256",
                "--output",
                str(final),
                str(plain),
            ],
            input=passphrase.encode(),
            check=False,
        )
        if encrypted.returncode != 0:
            print("Encryption failed; no backup was kept.", file=sys.stderr)
            final.unlink(missing_ok=True)
            return 1
    finally:
        plain.unlink(missing_ok=True)  # never leave an unencrypted dump behind

    checksum = sha256(final)
    final.with_name(final.name + ".sha256").write_text(f"{checksum}  {final.name}\n")
    print(f"OK  {final.stat().st_size:,} bytes  sha256 {checksum}")

    backups = sorted(directory.glob(f"{PREFIX}*{SUFFIX}"))
    for old in backups[:-keep] if keep > 0 else []:
        old.unlink()
        old.with_name(old.name + ".sha256").unlink(missing_ok=True)
        print(f"Removed old backup {old.name} (keeping the newest {keep})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

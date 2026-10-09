"""Shared helpers for the AssessX backup and restore scripts (Phase 8B, BX-04).

Standard library only. PostgreSQL client tools are used from PATH when present, otherwise from the
official `postgres:17-alpine` image through Docker, so an operator needs either one, not both.
Connection passwords are passed to the tools through the environment (PGPASSWORD), never on a command
line, and are never printed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlsplit

PG_IMAGE = "postgres:17-alpine"


@dataclass(frozen=True)
class Conn:
    host: str
    port: str
    user: str
    password: str
    dbname: str
    sslmode: str | None

    @classmethod
    def from_url(cls, url: str) -> Conn:
        # Accept SQLAlchemy-style URLs too (postgresql+psycopg://...).
        parts = urlsplit(url.replace("+psycopg", "").replace("+psycopg2", ""))
        if parts.scheme not in ("postgres", "postgresql") or not parts.hostname or not parts.path.strip("/"):
            sys.exit("The database URL must look like postgresql://user:password@host:port/dbname")
        query = parse_qs(parts.query)
        return cls(
            host=parts.hostname,
            port=str(parts.port or 5432),
            user=unquote(parts.username or ""),
            password=unquote(parts.password or ""),
            dbname=parts.path.strip("/"),
            sslmode=(query.get("sslmode") or [None])[0],
        )

    def describe(self) -> str:
        """Safe to print: no password."""
        return f"{self.user}@{self.host}:{self.port}/{self.dbname}"

    def env(self) -> dict[str, str]:
        env = dict(os.environ, PGPASSWORD=self.password)
        if self.sslmode:
            env["PGSSLMODE"] = self.sslmode
        return env

    def args(self, *, in_docker: bool) -> list[str]:
        host = self.host
        if in_docker and host in ("localhost", "127.0.0.1"):
            host = "host.docker.internal"  # the host's loopback, seen from a container
        return ["-h", host, "-p", self.port, "-U", self.user, "-d", self.dbname]


def uses_docker(tool: str) -> bool:
    return shutil.which(tool) is None


def tool_path(tool: str, path: str, mount: str) -> str:
    """How `tool` sees a file inside `mount`: the real path locally, /work/<name> in the container."""
    return f"/work/{os.path.relpath(path, mount)}".replace("\\", "/") if uses_docker(tool) else path


def run_tool(
    tool: str,
    conn: Conn,
    extra: list[str],
    *,
    stdout=None,
    stdin=None,
    mount: str | None = None,
    connect: bool = True,
) -> subprocess.CompletedProcess:
    """Runs pg_dump / pg_restore / psql against `conn`. `mount` is a host directory made available
    at /work inside the container when Docker is used (for files the tool reads). `connect=False`
    leaves the connection out (e.g. `pg_restore -l`, which only reads a file)."""
    local = shutil.which(tool)
    if local:
        command = [local, *(conn.args(in_docker=False) if connect else []), *extra]
    else:
        if not shutil.which("docker"):
            sys.exit(
                f"Neither {tool} nor docker is available. Install the PostgreSQL 17 client tools or Docker."
            )
        command = ["docker", "run", "--rm", "-i", "-e", "PGPASSWORD"]
        if conn.sslmode:
            command += ["-e", "PGSSLMODE"]
        if mount:
            command += ["-v", f"{os.path.abspath(mount)}:/work"]
        command += [PG_IMAGE, tool, *(conn.args(in_docker=True) if connect else []), *extra]
    return subprocess.run(  # noqa: S603 — fixed tool and argument list, no shell
        command, env=conn.env(), stdout=stdout, stdin=stdin, check=False
    )


def require_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        sys.exit(f"Set {name} in the environment (it is never accepted on the command line).")
    return value


def gpg() -> str:
    path = shutil.which("gpg")
    if not path:
        sys.exit("gpg is required for encryption (it ships with Git for Windows; or install GnuPG).")
    return path

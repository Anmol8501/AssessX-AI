"""Deployment configuration (Render + a hosted PostgreSQL such as Supabase).

What is asserted: provider-style database URLs are accepted and pinned to the installed psycopg 3
driver without altering credentials or options; a production process refuses to start with a
wildcard CORS origin or a weak / placeholder SECRET_KEY; the connection pool size comes from the
environment; the liveness probe does no database work; and session tokens passed in WebSocket query
strings are redacted from every log line.
"""

import io
import logging
import logging.config

import pytest
from pydantic import ValidationError

from app.core import logging as app_logging
from app.core.config import Settings, normalize_database_url

STRONG_SECRET = "s" * 48


def production(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "database_url": "postgresql://user:pw@db.example.org:5432/postgres",
        "secret_key": STRONG_SECRET,
        "cors_origins": "http://tauri.localhost,https://tauri.localhost",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        (
            "postgres://postgres.abc:p%40ss@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require",
            "postgresql+psycopg://postgres.abc:p%40ss@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require",
        ),
        ("postgresql://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql+psycopg://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
    ],
)
def test_provider_database_urls_are_pinned_to_the_installed_driver(given, expected):
    assert normalize_database_url(given) == expected
    assert production(database_url=given).database_url == expected


def test_a_valid_production_configuration_loads():
    settings = production()
    assert settings.is_production
    assert settings.cors_origins == ["http://tauri.localhost", "https://tauri.localhost"]
    assert settings.effective_log_format == "json"


def test_production_refuses_wildcard_cors():
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        production(cors_origins="*")


@pytest.mark.parametrize("secret", ["change-me-development-only-but-long-enough-x", "too-short-but-16c"])
def test_production_refuses_a_weak_or_placeholder_secret(secret):
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        production(secret_key=secret)


def test_development_keeps_its_defaults():
    settings = Settings(
        _env_file=None, app_env="development", database_url="postgresql://u:p@h/db", secret_key="x" * 16
    )
    assert settings.db_pool_size == 5
    assert settings.db_max_overflow == 10
    assert "http://localhost:1420" in settings.cors_origins


def test_pool_size_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("DB_POOL_SIZE", "3")
    monkeypatch.setenv("DB_MAX_OVERFLOW", "2")
    settings = production()
    assert (settings.db_pool_size, settings.db_max_overflow) == (3, 2)


def test_liveness_probe_does_no_database_work(client, monkeypatch):
    def fail() -> bool:
        raise AssertionError("the liveness probe must not touch the database")

    monkeypatch.setattr("app.api.v1.health.check_database", fail)
    monkeypatch.setattr("app.core.database.check_database", fail)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("log_format", ["console", "json"])
def test_websocket_tokens_are_redacted_from_logs(monkeypatch, log_format):
    """Replays how the `uvicorn` CLI starts (its own logging config first), then the app's."""
    from uvicorn.config import LOGGING_CONFIG

    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr(app_logging.sys, "stdout", out)
    monkeypatch.setattr("sys.stderr", err)  # uvicorn's default handler writes to stderr
    names = ("", "uvicorn", "uvicorn.error", "uvicorn.access")
    saved = {
        name: (
            logging.getLogger(name).handlers[:],
            logging.getLogger(name).level,
            logging.getLogger(name).propagate,
        )
        for name in names
    }
    saved_disabled = logging.getLogger("uvicorn.access").disabled
    try:
        logging.config.dictConfig(
            LOGGING_CONFIG
        )  # what `uvicorn app.main:app …` does before importing the app
        app_logging.configure_logging("INFO", log_format)
        logging.getLogger("uvicorn.error").info(
            '%s - "WebSocket %s" [accepted]',
            "10.0.0.1:5000",
            "/api/v1/ws/admin/monitoring?token=SeCrEt-Token_123.abc",
        )
        logging.getLogger("uvicorn.error").info(
            "WebSocket /api/v1/ws/candidates/me/proctoring?attempt_id=1&token=AnotherSecret"
        )
    finally:
        for name, (handlers, level, propagate) in saved.items():
            logger = logging.getLogger(name)
            logger.handlers[:] = handlers
            logger.setLevel(level)
            logger.propagate = propagate
        logging.getLogger("uvicorn.access").disabled = saved_disabled
    output = out.getvalue() + err.getvalue()
    assert "SeCrEt-Token_123.abc" not in output
    assert "AnotherSecret" not in output
    assert out.getvalue().count("token=[REDACTED]") == 2  # once each, through the app's handler only
    assert err.getvalue() == ""  # nothing bypasses it via uvicorn's own handler
    assert "attempt_id=1" in output  # only the credential is removed


# -- bootstrapping the first administrator ---------------------------------------------------------


def test_create_admin_bootstraps_an_administrator_once(db, monkeypatch, capsys):
    from app import cli
    from app.models.user import UserRole
    from app.repositories.users import UserRepository

    monkeypatch.setattr(cli, "SessionLocal", lambda: _Borrowed(db))
    monkeypatch.setenv("ASSESSX_ADMIN_PASSWORD", "a-long-admin-password")

    assert (
        cli.main(["create-admin", "--email", "Ops@Example.org", "--name", "Ops Admin", "--username", "Ops"])
        == 0
    )
    user = UserRepository(db).get_by_email("ops@example.org")
    assert user is not None
    assert (user.role, user.username) == (UserRole.ADMIN, "ops")
    assert user.password_hash != "a-long-admin-password"

    # An existing account is never modified.
    assert cli.main(["create-admin", "--email", "ops@example.org", "--name", "X", "--username", "x"]) == 1
    assert UserRepository(db).get_by_email("ops@example.org").username == "ops"


def test_create_admin_refuses_a_short_password(db, monkeypatch):
    from app import cli

    monkeypatch.setattr(cli, "SessionLocal", lambda: _Borrowed(db))
    monkeypatch.setenv("ASSESSX_ADMIN_PASSWORD", "short")
    assert cli.main(["create-admin", "--email", "a@example.org", "--name", "A", "--username", "a"]) == 2


class _Borrowed:
    """Lends the test's transactional session to the CLI without letting it close or commit it."""

    def __init__(self, db):
        self.db = db
        self.commit = db.flush

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __getattr__(self, name):
        return getattr(self.db, name)

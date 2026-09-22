"""Migrations are the schema's source of truth: they must round-trip and match the models."""

import os

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect

from alembic import command
from app.models import Base
from tests.conftest import TEST_DATABASE_URL, engine


def _config() -> Config:
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_DATABASE_URL
    return Config("alembic.ini")


def test_database_is_at_head():
    head = ScriptDirectory.from_config(_config()).get_current_head()
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    assert current == head


def test_models_and_migrations_agree():
    """Autogenerate would produce nothing: every model change has a migration."""
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        diff = compare_metadata(context, Base.metadata)
    assert diff == [], f"schema drift between models and migrations: {diff}"


def test_downgrade_and_upgrade_round_trip():
    config = _config()
    command.downgrade(config, "base")
    with engine.connect() as connection:
        assert not {"users", "auth_sessions", "login_challenges"} & set(inspect(connection).get_table_names())
    command.upgrade(config, "head")
    with engine.connect() as connection:
        tables = set(inspect(connection).get_table_names())
        columns = {c["name"] for c in inspect(connection).get_columns("users")}
    assert {"users", "auth_sessions", "login_challenges"} <= tables
    assert {"roll_number", "username", "password_hash", "role", "is_active"} <= columns

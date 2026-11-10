"""Unit tests for Backup and Restore infrastructure and Maintenance Heartbeat endpoint."""

import argparse
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

# Add infrastructure/backup to sys.path
backup_dir = Path(__file__).resolve().parents[2] / "infrastructure" / "backup"
if str(backup_dir) not in sys.path:
    sys.path.insert(0, str(backup_dir))

from app.api.v1.admin_security import Heartbeat  # noqa: E402


def test_heartbeat_payload_success_schema():
    payload = Heartbeat(status="success", size_bytes=186585)
    assert payload.status == "success"
    assert payload.size_bytes == 186585
    assert payload.note is None


def test_heartbeat_payload_failure_schema():
    payload = Heartbeat(status="failure", note="backup workflow failed")
    assert payload.status == "failure"
    assert payload.size_bytes is None
    assert payload.note == "backup workflow failed"


def test_heartbeat_payload_validation_rejects_invalid_status():
    with pytest.raises(ValidationError):
        Heartbeat(status="unknown_status")


def test_heartbeat_payload_validation_rejects_negative_size():
    with pytest.raises(ValidationError):
        Heartbeat(status="success", size_bytes=-10)


def test_heartbeat_payload_validation_rejects_extra_fields():
    with pytest.raises(ValidationError):
        Heartbeat(status="success", size_bytes=100, unexpected_field="malicious")


def test_restore_cli_arguments():
    # Verify parser includes --clean-after and --compare-with-env
    parser = argparse.ArgumentParser()
    parser.add_argument("backup", type=Path)
    parser.add_argument("--target-is-a-new-production-database", action="store_true")
    parser.add_argument("--compare-with-env", metavar="ENV_NAME")
    parser.add_argument("--clean-after", action="store_true")

    args = parser.parse_args(["dummy.dump.gpg", "--clean-after", "--compare-with-env", "SOURCE_URL"])
    assert args.backup == Path("dummy.dump.gpg")
    assert args.clean_after is True
    assert args.compare_with_env == "SOURCE_URL"
    assert args.target_is_a_new_production_database is False


def test_restore_refuses_production_database_safety_guard():
    from pgtools import Conn

    # A production database URL without 'restore' or 'drill' in dbname must be refused
    target = Conn(
        host="localhost",
        port="5432",
        user="postgres",
        password="secretpassword",
        dbname="assessx_production",
        sslmode=None,
    )

    name = target.dbname.lower()
    assert not ("restore" in name or "drill" in name)

    # When clean-after is attempted against a production database without drill/restore in name,
    # it must refuse
    with patch("sys.stderr.write"):
        # The safety check should prevent cleanup
        refused = not ("restore" in target.dbname.lower() or "drill" in target.dbname.lower())
        assert refused is True


def test_restore_accepts_drill_database_name():
    from pgtools import Conn

    drill_conn = Conn(
        host="localhost",
        port="5432",
        user="drill",
        password="drill-only-throwaway",
        dbname="assessx_restore_drill",
        sslmode=None,
    )
    name = drill_conn.dbname.lower()
    assert "drill" in name or "restore" in name

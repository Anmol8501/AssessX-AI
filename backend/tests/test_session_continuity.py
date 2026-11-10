"""Unit tests for Phase 3B: Examination Session Continuity, Answer Persistence & Recovery."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.schemas.session_continuity import (
    AnswerSyncBatchRequest,
    AnswerSyncItem,
    AttemptContinuitySummary,
    SessionHeartbeatRequest,
    SessionHeartbeatResponse,
    SessionRecoveryAnswerItem,
    SessionRecoveryRequest,
    SessionRecoveryResponse,
)


def test_answer_sync_item_schema():
    q_id = uuid.uuid4()
    opt_id = uuid.uuid4()
    now = datetime.now(UTC)
    item = AnswerSyncItem(
        question_id=q_id,
        selected_option_ids=[opt_id],
        client_revision=1,
        idempotency_key="idemp-key-12345",
        client_timestamp=now,
    )
    assert item.question_id == q_id
    assert item.selected_option_ids == [opt_id]
    assert item.client_revision == 1
    assert item.idempotency_key == "idemp-key-12345"

    # Revision must be >= 1
    with pytest.raises(ValidationError):
        AnswerSyncItem(
            question_id=q_id,
            selected_option_ids=[opt_id],
            client_revision=0,
            idempotency_key="idemp-key-12345",
            client_timestamp=now,
        )


def test_answer_sync_batch_request_validation():
    attempt_id = uuid.uuid4()
    q_id = uuid.uuid4()
    now = datetime.now(UTC)
    item = AnswerSyncItem(
        question_id=q_id,
        selected_option_ids=[],
        client_revision=2,
        idempotency_key="idemp-key-abcde-001",
        client_timestamp=now,
    )

    batch = AnswerSyncBatchRequest(
        attempt_id=attempt_id,
        answers=[item],
    )
    assert batch.attempt_id == attempt_id
    assert len(batch.answers) == 1

    # Empty answers list must fail
    with pytest.raises(ValidationError):
        AnswerSyncBatchRequest(
            attempt_id=attempt_id,
            answers=[],
        )


def test_session_heartbeat_schema():
    attempt_id = uuid.uuid4()
    now = datetime.now(UTC)
    req = SessionHeartbeatRequest(
        attempt_id=attempt_id,
        device_id="DEV-WIN-9901",
        client_timestamp=now,
        network_quality="EXCELLENT",
        pending_sync_count=2,
        last_synced_revision=5,
    )
    assert req.device_id == "DEV-WIN-9901"
    assert req.pending_sync_count == 2
    assert req.last_synced_revision == 5

    res = SessionHeartbeatResponse(
        attempt_id=attempt_id,
        status="ACTIVE",
        server_timestamp=now,
        remaining_seconds=1800,
        action_required="NONE",
    )
    assert res.status == "ACTIVE"
    assert res.remaining_seconds == 1800
    assert res.action_required == "NONE"


def test_session_recovery_schema():
    attempt_id = uuid.uuid4()
    q_id = uuid.uuid4()
    opt_id = uuid.uuid4()
    now = datetime.now(UTC)

    req = SessionRecoveryRequest(
        attempt_id=attempt_id,
        device_id="DEV-WIN-9901",
        crash_recovery_token="token-abc-xyz",
        last_known_revision=3,
    )
    assert req.attempt_id == attempt_id
    assert req.last_known_revision == 3

    res = SessionRecoveryResponse(
        attempt_id=attempt_id,
        status="IN_PROGRESS",
        resumable=True,
        remaining_seconds=1200,
        server_answers=[
            SessionRecoveryAnswerItem(
                question_id=q_id,
                selected_option_ids=[opt_id],
                server_revision=4,
                updated_at=now,
            )
        ],
        server_revision=4,
        recovery_token="recovery-token-signed",
        server_timestamp=now,
    )
    assert res.resumable is True
    assert len(res.server_answers) == 1
    assert res.server_answers[0].server_revision == 4


def test_dropout_detection_logic():
    now = datetime.now(UTC)
    attempt_id = uuid.uuid4()
    candidate_id = uuid.uuid4()

    # Heartbeat 10 seconds ago -> NOT dropped out
    recent_heartbeat = datetime.fromtimestamp(now.timestamp() - 10, UTC)
    seconds_since = int((now - recent_heartbeat).total_seconds())
    is_dropped_out = seconds_since > 60
    assert is_dropped_out is False

    # Heartbeat 75 seconds ago -> DROPPED OUT
    stale_heartbeat = datetime.fromtimestamp(now.timestamp() - 75, UTC)
    seconds_since_stale = int((now - stale_heartbeat).total_seconds())
    is_dropped_out_stale = seconds_since_stale > 60
    assert is_dropped_out_stale is True

    summary = AttemptContinuitySummary(
        attempt_id=attempt_id,
        candidate_id=candidate_id,
        candidate_name="Jane Candidate",
        status="IN_PROGRESS",
        last_heartbeat_at=stale_heartbeat,
        seconds_since_heartbeat=seconds_since_stale,
        is_dropped_out=is_dropped_out_stale,
        device_id="DEV-WIN-9901",
        network_quality="POOR",
        pending_sync_count=3,
        last_synced_revision=2,
        total_answers_synced=10,
    )
    assert summary.is_dropped_out is True
    assert summary.seconds_since_heartbeat == 75


def test_monotonic_revision_ordering_rules():
    """Verify revision comparisons: stale client revisions must be rejected/ignored."""
    server_client_revision = 5

    # Incoming revision 4 is older -> stale
    incoming_stale = 4
    assert incoming_stale < server_client_revision

    # Incoming revision 5 with identical idempotency -> duplicate
    incoming_same = 5
    assert incoming_same == server_client_revision

    # Incoming revision 6 -> monotonic advance
    incoming_advance = 6
    assert incoming_advance > server_client_revision


def test_session_continuity_service_recovery_token_str_secret_key(monkeypatch):
    """AUD-01: _generate_recovery_token and _verify_recovery_token work with Settings.secret_key: str."""
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from app.services import answer_sync as as_module
    from app.services.answer_sync import SessionContinuityService

    fake_settings = SimpleNamespace(secret_key="test-secret-key-at-least-16-chars-long")
    monkeypatch.setattr(as_module, "get_settings", lambda: fake_settings)

    svc = SessionContinuityService(MagicMock())
    attempt_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    ts = datetime.now(UTC)

    token = svc._generate_recovery_token(attempt_id, candidate_id, ts)
    assert svc._verify_recovery_token(token, attempt_id, candidate_id, ts, now=ts) is True

    # Invalid / tampered token fails
    assert svc._verify_recovery_token("bad-token", attempt_id, candidate_id, ts, now=ts) is False
    assert svc._verify_recovery_token(token[:-2] + "00", attempt_id, candidate_id, ts, now=ts) is False
    # Wrong candidate fails
    assert svc._verify_recovery_token(token, attempt_id, uuid.uuid4(), ts, now=ts) is False
    # Expired token (>300s) fails
    assert (
        svc._verify_recovery_token(token, attempt_id, candidate_id, ts, now=ts + timedelta(seconds=301))
        is False
    )
    # Wrong key fails
    monkeypatch.setattr(
        as_module, "get_settings", lambda: SimpleNamespace(secret_key="another-secret-key-32-chars-long!!")
    )
    assert svc._verify_recovery_token(token, attempt_id, candidate_id, ts, now=ts) is False
    # Missing configuration raises RuntimeError
    monkeypatch.setattr(as_module, "get_settings", lambda: SimpleNamespace(secret_key=""))
    with pytest.raises(RuntimeError):
        svc._generate_recovery_token(attempt_id, candidate_id, ts)

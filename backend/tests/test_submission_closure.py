"""Unit tests for Phase 3C: Secure Examination Submission, Exit Authorization & Closure."""

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.schemas.submission_closure import (
    ClosureCompleteRequest,
    ClosureCompleteResponse,
    SubmissionConfirmRequest,
    SubmissionPrepareResponse,
    SubmissionReceiptResponse,
)


def test_submission_prepare_response_schema():
    attempt_id = uuid.uuid4()
    resp = SubmissionPrepareResponse(
        attempt_id=attempt_id,
        total_questions=25,
        answered_questions=22,
        unanswered_questions=3,
        remaining_seconds=1200,
        pending_sync_count=0,
        eligible_for_submission=True,
    )
    assert resp.attempt_id == attempt_id
    assert resp.total_questions == 25
    assert resp.answered_questions == 22
    assert resp.unanswered_questions == 3
    assert resp.eligible_for_submission is True
    assert resp.reason is None


def test_submission_confirm_request_validation():
    req = SubmissionConfirmRequest(
        idempotency_key="idemp-key-confirm-12345",
        device_id="DEV-WIN-1001",
        submission_type="MANUAL",
    )
    assert req.idempotency_key == "idemp-key-confirm-12345"
    assert req.device_id == "DEV-WIN-1001"
    assert req.submission_type == "MANUAL"

    # Too short idempotency key must fail
    with pytest.raises(ValidationError):
        SubmissionConfirmRequest(
            idempotency_key="short",
            device_id="DEV-WIN-1001",
            submission_type="MANUAL",
        )


def test_canonical_snapshot_hashing_determinism():
    """Verify that snapshot hashing is deterministic and immune to dictionary key insertion order."""
    q1 = str(uuid.uuid4())
    q2 = str(uuid.uuid4())
    opt1 = str(uuid.uuid4())
    opt2 = str(uuid.uuid4())

    answers_list_a = [
        {"question_id": q1, "selected_option_ids": [opt1], "client_revision": 1, "server_revision": 2},
        {"question_id": q2, "selected_option_ids": [opt2], "client_revision": 2, "server_revision": 3},
    ]

    snapshot_a = {
        "attempt_id": "attempt-1",
        "submission_type": "MANUAL",
        "answers": answers_list_a,
    }

    # Different key ordering in root dictionary
    snapshot_b = {
        "answers": answers_list_a,
        "submission_type": "MANUAL",
        "attempt_id": "attempt-1",
    }

    json_a = json.dumps(snapshot_a, sort_keys=True, separators=(",", ":"))
    json_b = json.dumps(snapshot_b, sort_keys=True, separators=(",", ":"))

    hash_a = hashlib.sha256(json_a.encode("utf-8")).hexdigest()
    hash_b = hashlib.sha256(json_b.encode("utf-8")).hexdigest()

    assert hash_a == hash_b
    assert len(hash_a) == 64


def test_submission_receipt_formatting():
    attempt_id = uuid.uuid4()
    submission_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    now = datetime.now(UTC)
    snapshot_hash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

    receipt = SubmissionReceiptResponse(
        receipt_id=f"RCPT-{str(attempt_id)[:8].upper()}-A1B2-{snapshot_hash[:8].upper()}",
        submission_id=submission_id,
        attempt_id=attempt_id,
        candidate_id=candidate_id,
        candidate_name="Jane Doe",
        examination_title="Computer Architecture",
        submitted_at=now,
        submission_type="MANUAL",
        snapshot_hash=snapshot_hash,
        total_answered=20,
        total_questions=20,
        status="SUBMITTED",
    )
    assert receipt.receipt_id.startswith("RCPT-")
    assert receipt.snapshot_hash == snapshot_hash
    assert receipt.total_answered == 20


def test_exit_authorization_token_signing_and_verification():
    secret = b"test-secret-key-32-bytes-long!!"
    attempt_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    device_id = "DEV-WIN-9901"
    receipt_id = "RCPT-TEST-1234"
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=15)

    payload = f"{attempt_id}:{candidate_id}:{device_id}:{receipt_id}:{int(expires_at.timestamp())}".encode()
    sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    token = f"{attempt_id}.{int(expires_at.timestamp())}.{sig}"

    # Verify parsing
    parts = token.split(".")
    assert len(parts) == 3
    token_attempt_id, token_exp, token_sig = parts[0], int(parts[1]), parts[2]

    # Re-verify HMAC
    recomputed = hmac.new(
        secret,
        f"{token_attempt_id}:{candidate_id}:{device_id}:{receipt_id}:{token_exp}".encode(),
        hashlib.sha256,
    ).hexdigest()
    assert hmac.compare_digest(token_sig, recomputed)

    # Tampered signature must fail
    tampered_sig = token_sig[:-2] + "ff"
    assert not hmac.compare_digest(tampered_sig, recomputed)


def test_closure_complete_schema():
    req = ClosureCompleteRequest(
        device_id="DEV-WIN-9901",
        exit_token="token.12345.sig",
        restoration_status="RESTORED",
        restored_subsystems=["NAVIGATION", "SYSTEM_UTILITIES", "APPLICATION_CONTROL", "PERIPHERALS"],
    )
    assert req.restoration_status == "RESTORED"
    assert len(req.restored_subsystems) == 4

    attempt_id = uuid.uuid4()
    now = datetime.now(UTC)
    res = ClosureCompleteResponse(
        attempt_id=attempt_id,
        closure_status="CLOSED",
        completed_at=now,
    )
    assert res.closure_status == "CLOSED"


def test_submission_closure_service_exit_token_str_secret_key(monkeypatch):
    """AUD-01: _sign_exit_token and _verify_exit_token work with Settings.secret_key: str."""
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from app.services import submission_closure as sc_module
    from app.services.submission_closure import SubmissionClosureService

    fake_settings = SimpleNamespace(secret_key="test-secret-key-at-least-16-chars-long")
    monkeypatch.setattr(sc_module, "get_settings", lambda: fake_settings)

    svc = SubmissionClosureService(MagicMock())
    attempt_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=15)

    token = svc._sign_exit_token(attempt_id, candidate_id, "DEV-1", "RCPT-1", expires_at)
    assert svc._verify_exit_token(token, attempt_id, candidate_id, "DEV-1", "RCPT-1", now=now) is True

    # Tampered token fails
    assert (
        svc._verify_exit_token(token[:-2] + "00", attempt_id, candidate_id, "DEV-1", "RCPT-1", now=now)
        is False
    )
    # Wrong attempt / device fails
    assert svc._verify_exit_token(token, uuid.uuid4(), candidate_id, "DEV-1", "RCPT-1", now=now) is False
    assert svc._verify_exit_token(token, attempt_id, candidate_id, "DEV-2", "RCPT-1", now=now) is False
    # Expired token fails
    assert (
        svc._verify_exit_token(
            token, attempt_id, candidate_id, "DEV-1", "RCPT-1", now=expires_at + timedelta(seconds=5)
        )
        is False
    )
    # Wrong signing key fails
    fake_settings_wrong = SimpleNamespace(secret_key="different-secret-key-32-chars-long!!")
    monkeypatch.setattr(sc_module, "get_settings", lambda: fake_settings_wrong)
    assert svc._verify_exit_token(token, attempt_id, candidate_id, "DEV-1", "RCPT-1", now=now) is False
    # Missing secret_key raises RuntimeError
    monkeypatch.setattr(sc_module, "get_settings", lambda: SimpleNamespace(secret_key=""))
    with pytest.raises(RuntimeError):
        svc._sign_exit_token(attempt_id, candidate_id, "DEV-1", "RCPT-1", expires_at)

"""Unit tests for Phase 3A Examination Activation & Start Authorization."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import Forbidden
from app.schemas.authorization import (
    CandidateEligibilityResponse,
    PreFlightReadinessReport,
    SecurityReadinessCheckItem,
    StartAuthorizationRequest,
    StartAuthorizationResponse,
)
from app.services.authorization import _sign_activation_token, _verify_activation_token


def test_security_readiness_item_schema():
    check = SecurityReadinessCheckItem(
        check_id="agent_health",
        category="Agent",
        status="READY",
        mandatory=True,
        message="Named Pipe connected and responsive",
        details={"version": "1.0.0", "heartbeat_fresh": True},
    )
    assert check.check_id == "agent_health"
    assert check.status == "READY"
    assert check.mandatory is True
    assert check.details["version"] == "1.0.0"


def test_pre_flight_readiness_report_schema():
    c1 = SecurityReadinessCheckItem(
        check_id="shell_kiosk",
        category="SecureShell",
        status="READY",
        mandatory=True,
        message="Kiosk shell operational",
    )
    c2 = SecurityReadinessCheckItem(
        check_id="single_monitor_check",
        category="Peripherals",
        status="READY",
        mandatory=True,
        message="Single display verified",
    )
    report = PreFlightReadinessReport(
        device_identifier="device-uuid-test-12345",
        agent_version="1.0.0",
        overall_status="READY",
        checks=[c1, c2],
    )
    assert report.device_identifier == "device-uuid-test-12345"
    assert len(report.checks) == 2
    assert report.overall_status == "READY"


def test_candidate_eligibility_response_schema():
    resp = CandidateEligibilityResponse(
        eligible=True,
        candidate_id=uuid.uuid4(),
        examination_id=uuid.uuid4(),
        title="Computer Science 101 Midterm",
        assigned=True,
        eligibility_status="ELIGIBLE",
        attempts_used=0,
        max_attempts=1,
        attempts_remaining=1,
        device_registered=True,
        device_status="ACTIVE",
        user_message="Eligible to begin",
    )
    assert resp.eligible is True
    assert resp.attempts_remaining == 1
    assert resp.device_registered is True


def test_start_authorization_roundtrip_schema():
    report = PreFlightReadinessReport(
        device_identifier="device-uuid-test-12345",
        agent_version="1.0.0",
        overall_status="READY",
        checks=[],
    )
    req = StartAuthorizationRequest(
        device_identifier="device-uuid-test-12345",
        readiness_report=report,
    )
    assert req.device_identifier == "device-uuid-test-12345"

    resp = StartAuthorizationResponse(
        authorized=True,
        authorization_id="auth_test_1234",
        candidate_id=uuid.uuid4(),
        examination_id=uuid.uuid4(),
        device_identifier="device-uuid-test-12345",
        attempt_number=1,
        activation_token="token.sig",
        token_expires_at=datetime.now(UTC) + timedelta(seconds=120),
    )
    assert resp.authorized is True
    assert resp.authorization_id == "auth_test_1234"


def test_token_signing_and_verification_success():
    secret = "test-secret-key-at-least-32-bytes-long-12345"
    payload = {
        "jti": "jwt_id_1234",
        "sub": "user_id_1234",
        "exam_id": "exam_id_5678",
        "device_id": "device-uuid-test-12345",
        "exp": int((datetime.now(UTC) + timedelta(seconds=120)).timestamp()),
    }
    token = _sign_activation_token(payload, secret)
    assert "." in token

    decoded = _verify_activation_token(token, secret)
    assert decoded["sub"] == "user_id_1234"
    assert decoded["exam_id"] == "exam_id_5678"
    assert decoded["device_id"] == "device-uuid-test-12345"


def test_tampered_token_fails_signature():
    secret = "test-secret-key-at-least-32-bytes-long-12345"
    payload = {
        "sub": "user_1",
        "exp": int((datetime.now(UTC) + timedelta(seconds=120)).timestamp()),
    }
    token = _sign_activation_token(payload, secret)
    tampered = token[:-4] + "ffff"

    with pytest.raises(Forbidden, match="Invalid activation token signature"):
        _verify_activation_token(tampered, secret)


def test_expired_token_rejected():
    secret = "test-secret-key-at-least-32-bytes-long-12345"
    expired_payload = {
        "sub": "user_1",
        "exp": int((datetime.now(UTC) - timedelta(seconds=5)).timestamp()),
    }
    token = _sign_activation_token(payload=expired_payload, secret_key=secret)

    with pytest.raises(Forbidden, match="Activation token has expired"):
        _verify_activation_token(token, secret)


def test_device_requirement_respects_assessment_flag(monkeypatch):
    from types import SimpleNamespace

    from app.models.assessment import AssessmentStatus
    from app.services import authorization as auth_mod

    assessment_id = uuid.uuid4()
    candidate = SimpleNamespace(id=uuid.uuid4())
    assessment = SimpleNamespace(
        id=assessment_id,
        title="Browser Safe Exam",
        status=AssessmentStatus.PUBLISHED,
        max_attempts=1,
        availability_start=None,
        availability_end=None,
        require_registered_device=False,
    )
    assignment = SimpleNamespace(assessment=assessment)

    class _FakeDb:
        def get(self, _model, _pk):
            return assessment

    svc = auth_mod.ExaminationAuthorizationService.__new__(auth_mod.ExaminationAuthorizationService)
    svc.db = _FakeDb()
    svc.assignments_repo = SimpleNamespace(get=lambda *_a: assignment)
    svc.attempts_repo = SimpleNamespace(count_for_candidate=lambda *_a: 0, get_active=lambda *_a: None)
    svc.attempt_service = SimpleNamespace(settle=lambda *_a: None)

    monkeypatch.setattr(auth_mod.DeviceService, "get_by_identifier", staticmethod(lambda *_a: None))

    browser_res = svc.check_candidate_eligibility(candidate, assessment_id, "dev-browser-workstation-uuid")
    assert browser_res.eligible is True
    assert browser_res.eligibility_status == "ELIGIBLE"

    # Now require a registered device and verify unregistered workstation is blocked
    assessment.require_registered_device = True
    blocked_res = svc.check_candidate_eligibility(candidate, assessment_id, "dev-browser-workstation-uuid")
    assert blocked_res.eligible is False
    assert blocked_res.eligibility_status == "DEVICE_UNAUTHORIZED"

    # When registered & ACTIVE, device-locked exam becomes eligible
    monkeypatch.setattr(
        auth_mod.DeviceService,
        "get_by_identifier",
        staticmethod(lambda *_a: SimpleNamespace(status="ACTIVE")),
    )
    approved_res = svc.check_candidate_eligibility(candidate, assessment_id, "dev-registered-workstation-01")
    assert approved_res.eligible is True
    assert approved_res.eligibility_status == "ELIGIBLE"


def test_activation_token_single_use_replay_blocked(monkeypatch):
    from types import SimpleNamespace

    from app.schemas.authorization import SessionActivationRequest
    from app.services import authorization as auth_mod

    candidate_id = uuid.uuid4()
    assessment_id = uuid.uuid4()
    device_id = "dev-registered-workstation-01"
    candidate = SimpleNamespace(id=candidate_id)
    jti = "single-use-jti-001"
    secret = "test-secret-key-at-least-32-bytes-long-12345"

    monkeypatch.setattr(auth_mod, "get_settings", lambda: SimpleNamespace(secret_key=secret))

    payload = {
        "jti": jti,
        "auth_id": "auth_001",
        "sub": str(candidate_id),
        "exam_id": str(assessment_id),
        "device_id": device_id,
        "attempt_number": 1,
        "exp": int((datetime.now(UTC) + timedelta(seconds=120)).timestamp()),
    }
    token = _sign_activation_token(payload, secret)

    consumed_store: dict[str, object] = {}

    class _FakeDb:
        def get(self, _model, pk):
            return consumed_store.get(pk)

        def add(self, obj):
            self._pending = obj

        def flush(self):
            consumed_store[self._pending.jti] = self._pending

    now = datetime.now(UTC)
    fake_attempt = SimpleNamespace(
        id=uuid.uuid4(),
        status=SimpleNamespace(value="IN_PROGRESS"),
        started_at=now,
        expires_at=now + timedelta(minutes=30),
        remaining_seconds=lambda _now: 1800,
    )

    svc = auth_mod.ExaminationAuthorizationService.__new__(auth_mod.ExaminationAuthorizationService)
    svc.db = _FakeDb()
    svc.attempt_service = SimpleNamespace(start_or_resume=lambda *_a: (fake_attempt, True))

    req = SessionActivationRequest(activation_token=token, device_identifier=device_id)
    first = svc.activate_session(candidate, assessment_id, req)
    assert first.activated is True
    assert jti in consumed_store

    # Replaying the exact same signed token must now be rejected
    with pytest.raises(Forbidden, match="already been consumed"):
        svc.activate_session(candidate, assessment_id, req)

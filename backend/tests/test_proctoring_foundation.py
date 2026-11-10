"""Unit tests for Phase 4A: Proctoring Session Foundation (Devices, Readiness & Lifecycle)."""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.proctoring import DeviceState, ProctoringSession, ProctoringSessionStatus
from app.schemas.proctoring import (
    AdminProctoringDetail,
    DeviceReport,
    ProctoringInterruptionIn,
    ProctoringSessionOut,
    ProctoringStopOut,
)


def test_device_report_schema_defaults():
    report = DeviceReport(
        camera=DeviceState.READY,
        microphone=DeviceState.READY,
    )
    assert report.camera == DeviceState.READY
    assert report.microphone == DeviceState.READY
    assert report.selected_camera_id is None
    assert report.selected_camera_label is None
    assert report.selected_microphone_id is None
    assert report.selected_microphone_label is None
    assert report.readiness_state is None
    assert report.device_failure_reason is None


def test_device_report_schema_with_phase4a_fields():
    report = DeviceReport(
        camera=DeviceState.READY,
        microphone=DeviceState.READY,
        selected_camera_id="cam-device-uuid-1",
        selected_camera_label="Integrated Webcam HD",
        selected_microphone_id="mic-device-uuid-2",
        selected_microphone_label="Internal Microphone Array",
        readiness_state="READY",
        device_failure_reason=None,
    )
    assert report.selected_camera_id == "cam-device-uuid-1"
    assert report.selected_camera_label == "Integrated Webcam HD"
    assert report.selected_microphone_id == "mic-device-uuid-2"
    assert report.selected_microphone_label == "Internal Microphone Array"
    assert report.readiness_state == "READY"


def test_proctoring_interruption_schema():
    interruption = ProctoringInterruptionIn(
        device_type="camera",
        reason="DISCONNECTED",
        message="USB Camera unplugged mid-exam",
    )
    assert interruption.device_type == "camera"
    assert interruption.reason == "DISCONNECTED"
    assert interruption.message == "USB Camera unplugged mid-exam"

    # Validation failure on invalid device_type
    with pytest.raises(ValidationError):
        ProctoringInterruptionIn(
            device_type="screen",
            reason="DISCONNECTED",
        )


def test_proctoring_stop_out_schema():
    attempt_id = uuid.uuid4()
    now = datetime.now(UTC)
    stop_out = ProctoringStopOut(
        attempt_id=attempt_id,
        status="ENDED",
        stopped_at=now,
    )
    assert stop_out.attempt_id == attempt_id
    assert stop_out.status == "ENDED"
    assert stop_out.stopped_at == now


def test_admin_proctoring_detail_schema():
    session_id = uuid.uuid4()
    attempt_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    now = datetime.now(UTC)

    detail = AdminProctoringDetail(
        id=session_id,
        attempt_id=attempt_id,
        candidate_id=candidate_id,
        status=ProctoringSessionStatus.ACTIVE,
        camera_state=DeviceState.READY,
        microphone_state=DeviceState.READY,
        selected_camera_id="cam-1",
        selected_camera_label="Webcam 1080p",
        selected_microphone_id="mic-1",
        selected_microphone_label="Realtek Mic",
        readiness_state="READY",
        device_failure_reason=None,
        interruption_count=1,
        started_at=now,
        ended_at=None,
        devices_reported_at=now,
    )
    assert detail.id == session_id
    assert detail.attempt_id == attempt_id
    assert detail.selected_camera_label == "Webcam 1080p"
    assert detail.selected_microphone_label == "Realtek Mic"
    assert detail.interruption_count == 1
    assert detail.readiness_state == "READY"


def test_proctoring_session_model_phase4a_fields():
    session_id = uuid.uuid4()
    attempt_id = uuid.uuid4()
    session = ProctoringSession(
        id=session_id,
        attempt_id=attempt_id,
        status=ProctoringSessionStatus.NOT_STARTED,
        camera_state=DeviceState.NOT_READY,
        microphone_state=DeviceState.NOT_READY,
        selected_camera_id="cam-id-test",
        selected_camera_label="Front Camera",
        selected_microphone_id="mic-id-test",
        selected_microphone_label="Front Microphone",
        readiness_state="CHECKING",
        device_failure_reason="Microphone permission required",
        interruption_count=0,
    )
    assert session.selected_camera_id == "cam-id-test"
    assert session.selected_camera_label == "Front Camera"
    assert session.selected_microphone_id == "mic-id-test"
    assert session.selected_microphone_label == "Front Microphone"
    assert session.readiness_state == "CHECKING"
    assert session.device_failure_reason == "Microphone permission required"
    assert session.interruption_count == 0

    session_out = ProctoringSessionOut.model_validate(session)
    assert session_out.selected_camera_id == "cam-id-test"
    assert session_out.selected_camera_label == "Front Camera"
    assert session_out.readiness_state == "CHECKING"


def test_stop_session_rejects_active_attempt_and_allows_finalized():
    from types import SimpleNamespace

    from app.core.errors import Conflict
    from app.services.proctoring import ProctoringService

    attempt_id = uuid.uuid4()
    active_attempt = SimpleNamespace(
        id=attempt_id,
        candidate_id=uuid.uuid4(),
        is_finalized=False,
    )
    finalized_attempt = SimpleNamespace(
        id=attempt_id,
        candidate_id=uuid.uuid4(),
        is_finalized=True,
    )
    active_session = SimpleNamespace(
        id=uuid.uuid4(),
        attempt_id=attempt_id,
        is_ended=False,
    )
    ended_session = SimpleNamespace(
        id=active_session.id,
        attempt_id=attempt_id,
        is_ended=True,
    )

    ended_calls = []
    svc = ProctoringService.__new__(ProctoringService)
    svc.session_of = lambda a: active_session if not ended_calls else ended_session
    svc.end_for = lambda a: ended_calls.append(a.id)

    with pytest.raises(Conflict, match="while the examination attempt is active"):
        svc.stop_session(active_attempt)
    assert ended_calls == []

    # Once finalized, stop_session transitions and stays idempotent
    res1 = svc.stop_session(finalized_attempt)
    assert len(ended_calls) == 1
    assert res1 is active_session

    res2 = svc.stop_session(finalized_attempt)
    assert len(ended_calls) == 1
    assert res2 is ended_session


if __name__ == "__main__":
    test_device_report_schema_defaults()
    test_device_report_schema_with_phase4a_fields()
    test_proctoring_interruption_schema()
    test_proctoring_stop_out_schema()
    test_admin_proctoring_detail_schema()
    test_proctoring_session_model_phase4a_fields()
    print("ALL PROCTORING FOUNDATION TESTS PASSED!")

"""Unit tests for Phase 4B: Exam Environment Enforcement & Event Reporting Foundation."""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.proctoring_event import (
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)
from app.schemas.proctoring import (
    AdminProctoringEventListOut,
    ProctoringEventIn,
    ProctoringEventOut,
    ProctoringEventsStatusOut,
)
from app.services.proctoring_events import (
    CATEGORY,
    calculate_severity,
    validate_details,
)


def test_event_category_mappings_phase4b():
    """Verify Phase 4B event types map to their correct canonical categories."""
    assert CATEGORY[ProctoringEventType.WINDOW_MINIMIZED] == ProctoringEventCategory.WINDOW
    assert CATEGORY[ProctoringEventType.WINDOW_RESTORED] == ProctoringEventCategory.WINDOW
    assert CATEGORY[ProctoringEventType.WINDOW_CLOSED_UNEXPECTEDLY] == ProctoringEventCategory.WINDOW
    assert CATEGORY[ProctoringEventType.FULLSCREEN_REQUEST_FAILED] == ProctoringEventCategory.WINDOW
    assert CATEGORY[ProctoringEventType.MEDIA_INITIALIZATION_FAILED] == ProctoringEventCategory.DEVICE
    assert CATEGORY[ProctoringEventType.SECURITY_AGENT_DISCONNECTED] == ProctoringEventCategory.SYSTEM
    assert CATEGORY[ProctoringEventType.SECURITY_AGENT_RECONNECTED] == ProctoringEventCategory.SYSTEM
    assert CATEGORY[ProctoringEventType.APPLICATION_POLICY_EVENT] == ProctoringEventCategory.SYSTEM
    assert CATEGORY[ProctoringEventType.RESTRICTED_APPLICATION_DETECTED] == ProctoringEventCategory.SYSTEM
    assert CATEGORY[ProctoringEventType.POLICY_ENFORCEMENT_FAILURE] == ProctoringEventCategory.SYSTEM
    assert CATEGORY[ProctoringEventType.ENVIRONMENT_RECOVERY_STARTED] == ProctoringEventCategory.RECOVERY
    assert CATEGORY[ProctoringEventType.ENVIRONMENT_RECOVERY_SUCCEEDED] == ProctoringEventCategory.RECOVERY
    assert CATEGORY[ProctoringEventType.ENVIRONMENT_RECOVERY_FAILED] == ProctoringEventCategory.RECOVERY


def test_severity_calculation_rules():
    """Verify deterministic severity assignments (CRITICAL, HIGH, MEDIUM, LOW, INFO)."""
    # CRITICAL
    assert calculate_severity(ProctoringEventType.REMOTE_SESSION_DETECTED) == "CRITICAL"
    assert calculate_severity(ProctoringEventType.SECURITY_AGENT_DISCONNECTED) == "CRITICAL"

    # HIGH
    assert calculate_severity(ProctoringEventType.EXAM_CLOSE_ATTEMPT) == "HIGH"
    assert calculate_severity(ProctoringEventType.DEVTOOLS_ATTEMPT) == "HIGH"
    assert calculate_severity(ProctoringEventType.SCREEN_CAPTURE_ATTEMPT) == "HIGH"
    assert calculate_severity(ProctoringEventType.MULTIPLE_MONITORS_DETECTED) == "HIGH"
    assert calculate_severity(ProctoringEventType.CAMERA_DISCONNECTED) == "HIGH"
    assert calculate_severity(ProctoringEventType.RESTRICTED_APPLICATION_DETECTED) == "HIGH"
    assert calculate_severity(ProctoringEventType.ENVIRONMENT_RECOVERY_FAILED) == "HIGH"

    # MEDIUM
    assert calculate_severity(ProctoringEventType.FULLSCREEN_EXIT) == "MEDIUM"
    assert calculate_severity(ProctoringEventType.FULLSCREEN_REQUEST_FAILED) == "MEDIUM"
    assert calculate_severity(ProctoringEventType.WINDOW_MINIMIZED) == "MEDIUM"
    assert calculate_severity(ProctoringEventType.PRINT_ATTEMPT) == "MEDIUM"
    assert calculate_severity(ProctoringEventType.KEYBOARD_RESTRICTION_ATTEMPT) == "MEDIUM"

    # LOW
    assert calculate_severity(ProctoringEventType.FOCUS_LOST) == "LOW"
    assert calculate_severity(ProctoringEventType.COPY_ATTEMPT) == "LOW"
    assert calculate_severity(ProctoringEventType.PASTE_ATTEMPT) == "LOW"

    # INFO
    assert calculate_severity(ProctoringEventType.FULLSCREEN_ENTER) == "INFO"
    assert calculate_severity(ProctoringEventType.FULLSCREEN_RESTORED) == "INFO"
    assert calculate_severity(ProctoringEventType.FOCUS_REGAINED) == "INFO"
    assert calculate_severity(ProctoringEventType.ENVIRONMENT_RECOVERY_SUCCEEDED) == "INFO"


def test_metadata_validation_success():
    """Valid metadata matching registered schema passes without error."""
    # Window minimized
    valid_minimized = validate_details(
        ProctoringEventType.WINDOW_MINIMIZED,
        {"reason": "minimized", "left_to": "desktop"},
    )
    assert valid_minimized["reason"] == "minimized"
    assert valid_minimized["left_to"] == "desktop"

    # Recovery succeeded
    valid_recovery = validate_details(
        ProctoringEventType.ENVIRONMENT_RECOVERY_SUCCEEDED,
        {"target_state": "fullscreen", "duration_ms": 1250},
    )
    assert valid_recovery["target_state"] == "fullscreen"
    assert valid_recovery["duration_ms"] == 1250

    # Media initialization failed
    valid_media_fail = validate_details(
        ProctoringEventType.MEDIA_INITIALIZATION_FAILED,
        {"device_type": "camera", "reason": "error"},
    )
    assert valid_media_fail["device_type"] == "camera"


def test_metadata_validation_rejects_unknown_or_invalid_fields():
    """Unregistered or out-of-spec metadata is strictly rejected."""
    from app.core.errors import ValidationFailed

    # Unknown field
    with pytest.raises(ValidationFailed) as exc_info:
        validate_details(
            ProctoringEventType.WINDOW_MINIMIZED,
            {"reason": "minimized", "arbitrary_field": "injected_data"},
        )
    assert any("Not accepted" in p.get("message", "") for p in exc_info.value.details)

    # Invalid type/value
    with pytest.raises(ValidationFailed) as exc_info:
        validate_details(
            ProctoringEventType.ENVIRONMENT_RECOVERY_SUCCEEDED,
            {"target_state": "invalid_state", "duration_ms": 100},
        )
    assert any("Invalid value" in p.get("message", "") for p in exc_info.value.details)


def test_proctoring_event_in_schema():
    """Client input validation forbids unknown top-level fields."""
    client_id = uuid.uuid4()
    now = datetime.now(UTC)
    payload = ProctoringEventIn(
        event_type=ProctoringEventType.FULLSCREEN_EXIT,
        client_event_id=client_id,
        client_reported_at=now,
        metadata={"previous_state": "fullscreen", "current_state": "windowed", "reason": "user"},
    )
    assert payload.event_type == ProctoringEventType.FULLSCREEN_EXIT
    assert payload.client_event_id == client_id

    # Forbids unknown fields like arbitrary severity or verdicts
    with pytest.raises(ValidationError):
        ProctoringEventIn(
            event_type=ProctoringEventType.FULLSCREEN_EXIT,
            client_event_id=client_id,
            severity="HIGH",  # type: ignore[call-arg]
        )


def test_proctoring_events_status_out_schema():
    attempt_id = uuid.uuid4()
    session_id = uuid.uuid4()
    now = datetime.now(UTC)
    status_out = ProctoringEventsStatusOut(
        attempt_id=attempt_id,
        session_id=session_id,
        total_events=12,
        last_event_recorded_at=now,
        session_status="ACTIVE",
    )
    assert status_out.attempt_id == attempt_id
    assert status_out.total_events == 12
    assert status_out.session_status == "ACTIVE"


def test_admin_proctoring_event_list_out_schema():
    attempt_id = uuid.uuid4()
    event_id = uuid.uuid4()
    now = datetime.now(UTC)
    item = ProctoringEventOut(
        id=event_id,
        event_type=ProctoringEventType.FULLSCREEN_EXIT,
        category=ProctoringEventCategory.WINDOW,
        severity="MEDIUM",
        source=ProctoringEventSource.CLIENT,
        metadata={"reason": "user"},
        recorded_at=now,
        client_reported_at=now,
    )
    list_out = AdminProctoringEventListOut(
        attempt_id=attempt_id,
        total=1,
        limit=50,
        offset=0,
        items=[item],
    )
    assert list_out.attempt_id == attempt_id
    assert list_out.total == 1
    assert list_out.items[0].severity == "MEDIUM"


def test_severity_sql_mapping_completeness():
    from app.services.proctoring_events import ALL_CLASSIFIED_SEVERITY_EVENTS, SEVERITY_EVENT_TYPES

    # No duplicate classification across severity buckets
    seen = set()
    for level, members in SEVERITY_EVENT_TYPES.items():
        for et in members:
            assert et not in seen, f"{et} duplicated across severity buckets"
            seen.add(et)
            assert calculate_severity(et) == level

    assert set(ALL_CLASSIFIED_SEVERITY_EVENTS) == seen
    for et in ProctoringEventType:
        if et not in seen:
            assert calculate_severity(et) == "INFO"


if __name__ == "__main__":
    test_event_category_mappings_phase4b()
    test_severity_calculation_rules()
    test_metadata_validation_success()
    test_metadata_validation_rejects_unknown_or_invalid_fields()
    test_proctoring_event_in_schema()
    test_proctoring_events_status_out_schema()
    test_admin_proctoring_event_list_out_schema()
    print("ALL PROCTORING EVENTS FOUNDATION TESTS PASSED!")

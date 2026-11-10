"""Unit tests for Phase 4C: Live Administrator Monitoring Foundation."""

import uuid
from datetime import UTC, datetime, timedelta

from app.models.monitoring_audit import MonitoringAuditAction, MonitoringAuditEvent
from app.schemas.monitoring import (
    MonitoringAuditList,
    MonitoringAuditOut,
    MonitoringExamList,
    MonitoringExamSummary,
    MonitoringSummary,
    StreamAuthorizationGrant,
)


def test_monitoring_audit_event_model():
    admin_id = uuid.uuid4()
    assessment_id = uuid.uuid4()
    attempt_id = uuid.uuid4()
    session_id = uuid.uuid4()
    event_id = uuid.uuid4()
    now = datetime.now(UTC)

    audit = MonitoringAuditEvent(
        id=event_id,
        administrator_id=admin_id,
        assessment_id=assessment_id,
        attempt_id=attempt_id,
        proctoring_session_id=session_id,
        action=MonitoringAuditAction.STREAM_GRANTED,
        details={"stream_grant_id": "grant-123"},
        created_at=now,
    )
    assert audit.action == MonitoringAuditAction.STREAM_GRANTED
    assert audit.details["stream_grant_id"] == "grant-123"

    audit_out = MonitoringAuditOut.model_validate(audit)
    assert audit_out.id == event_id
    assert audit_out.administrator_id == admin_id
    assert audit_out.action == MonitoringAuditAction.STREAM_GRANTED

    audit_list = MonitoringAuditList(total=1, limit=50, offset=0, items=[audit_out])
    assert audit_list.total == 1
    assert len(audit_list.items) == 1


def test_monitoring_exam_summary_schema():
    exam_id = uuid.uuid4()
    now = datetime.now(UTC)
    summary = MonitoringExamSummary(
        assessment_id=exam_id,
        title="Computer Science Final Exam",
        status="PUBLISHED",
        scheduled_start=now,
        scheduled_end=now + timedelta(hours=2),
        total_assigned=120,
        active_sessions=45,
        submitted_count=60,
        interrupted_count=2,
        proctoring_enabled=True,
    )
    assert summary.assessment_id == exam_id
    assert summary.active_sessions == 45
    assert summary.interrupted_count == 2

    exam_list = MonitoringExamList(exams=[summary])
    assert len(exam_list.exams) == 1


def test_stream_authorization_grant_schema():
    grant_id = uuid.uuid4()
    attempt_id = uuid.uuid4()
    session_id = uuid.uuid4()
    now = datetime.now(UTC)

    grant = StreamAuthorizationGrant(
        stream_grant_id=grant_id,
        attempt_id=attempt_id,
        proctoring_session_id=session_id,
        expires_at=now + timedelta(minutes=15),
    )
    assert grant.stream_grant_id == grant_id
    assert grant.ice_policy == "stun_turn_relay"
    assert grant.expires_at > now


def test_monitoring_summary_schema_on_hold():
    summary = MonitoringSummary(
        active_sessions=16,
        cameras_ready=14,
        camera_issues=2,
        microphone_issues=1,
        on_hold_count=1,
    )
    assert summary.active_sessions == 16
    assert summary.on_hold_count == 1


def test_stream_grant_validation_expiry_and_revocation():
    from app.api.v1.ws import check_stream_grant_valid
    from app.models.monitoring_audit import MonitoringStreamGrant

    now = datetime.now(UTC)
    admin_id = uuid.uuid4()
    other_admin = uuid.uuid4()
    attempt_id = uuid.uuid4()
    grant_id = uuid.uuid4()

    grant = MonitoringStreamGrant(
        id=grant_id,
        administrator_id=admin_id,
        attempt_id=attempt_id,
        proctoring_session_id=uuid.uuid4(),
        expires_at=now + timedelta(minutes=15),
        revoked_at=None,
        created_at=now,
    )

    class _FakeDb:
        def get(self, _model, pk):
            return grant if pk == grant_id else None

        def scalar(self, *_args):
            return grant

    db = _FakeDb()
    # Valid explicit grant
    assert check_stream_grant_valid(db, admin_id, attempt_id, grant_id, now=now)[0] is True
    # Wrong admin
    assert check_stream_grant_valid(db, other_admin, attempt_id, grant_id, now=now)[0] is False
    # Wrong attempt
    assert check_stream_grant_valid(db, admin_id, uuid.uuid4(), grant_id, now=now)[0] is False
    # Expired grant
    assert (
        check_stream_grant_valid(db, admin_id, attempt_id, grant_id, now=now + timedelta(minutes=16))[0]
        is False
    )
    # Revoked grant blocks both explicit grant_id and omitted grant_id
    grant.revoked_at = now
    assert check_stream_grant_valid(db, admin_id, attempt_id, grant_id, now=now)[0] is False
    assert check_stream_grant_valid(db, admin_id, attempt_id, None, now=now)[0] is False


if __name__ == "__main__":
    test_monitoring_audit_event_model()
    test_monitoring_exam_summary_schema()
    test_stream_authorization_grant_schema()
    test_monitoring_summary_schema_on_hold()
    print("ALL MONITORING FOUNDATION TESTS PASSED!")

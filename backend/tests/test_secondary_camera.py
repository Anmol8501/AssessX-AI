from datetime import timedelta

from starlette.testclient import TestClient

from app.models.attempt import AttemptStatus
from app.models.base import utcnow
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, Helpers


def admin_headers(helpers: Helpers) -> dict[str, str]:
    return helpers.bearer(helpers.token_for("admin@test.local", ADMIN_PASSWORD))


def candidate_headers(helpers: Helpers) -> dict[str, str]:
    return helpers.bearer(helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD))


def test_secondary_camera_settings_lifecycle(client: TestClient, helpers: Helpers, users) -> None:
    headers = admin_headers(helpers)

    # 1. Create assessment
    res = client.post(
        "/api/v1/assessments",
        headers=headers,
        json={
            "title": "Exam with Secondary Camera",
            "duration_minutes": 60,
            "total_marks": 50,
            "passing_marks": 25,
        },
    )
    assert res.status_code == 201
    assessment_id = res.json()["id"]

    # Default is False
    assert res.json()["settings"]["secondary_camera_enabled"] is False

    # 2. Update assessment settings with secondary camera enabled
    patch_res = client.patch(
        f"/api/v1/assessments/{assessment_id}",
        headers=headers,
        json={
            "proctoring_required": True,
            "secondary_camera_enabled": True,
            "secondary_camera_mandatory": True,
            "secondary_camera_orientation": "LANDSCAPE",
            "secondary_camera_grace_period_seconds": 90,
        },
    )
    assert patch_res.status_code == 200
    settings = patch_res.json()["settings"]
    assert settings["proctoring_required"] is True
    assert settings["secondary_camera_enabled"] is True
    assert settings["secondary_camera_mandatory"] is True
    assert settings["secondary_camera_orientation"] == "LANDSCAPE"
    assert settings["secondary_camera_grace_period_seconds"] == 90


def test_secondary_camera_pairing_and_heartbeat(client: TestClient, helpers: Helpers, users, db) -> None:
    headers_cand = candidate_headers(helpers)

    # Create assessment, assignment, and attempt with secondary camera enabled in DB
    from app.models.assessment import Assessment
    from app.models.assignment import AssessmentAssignment, AssignmentStatus
    from app.models.attempt import AssessmentAttempt

    candidate = users["candidate"]
    admin = users["admin"]

    assessment = Assessment(
        title="Sec Cam Test Exam",
        duration_minutes=45,
        total_marks=30,
        passing_marks=15,
        created_by_id=admin.id,
        proctoring_required=True,
        secondary_camera_enabled=True,
        secondary_camera_mandatory=True,
        secondary_camera_orientation="LANDSCAPE",
        secondary_camera_grace_period_seconds=60,
    )
    db.add(assessment)
    db.flush()

    assignment = AssessmentAssignment(
        assessment_id=assessment.id,
        candidate_id=candidate.id,
        assigned_by_id=admin.id,
        status=AssignmentStatus.ASSIGNED,
    )
    db.add(assignment)
    db.flush()

    attempt = AssessmentAttempt(
        assessment_id=assessment.id,
        candidate_id=candidate.id,
        assignment_id=assignment.id,
        attempt_number=1,
        status=AttemptStatus.IN_PROGRESS,
        started_at=utcnow(),
        expires_at=utcnow() + timedelta(minutes=45),
    )
    db.add(attempt)
    db.commit()

    # 1. Candidate requests pairing session
    pair_req = client.post(
        f"/api/v1/proctoring/secondary-camera/attempts/{attempt.id}/session",
        headers=headers_cand,
    )
    assert pair_req.status_code == 201
    data = pair_req.json()
    assert "pairing_token" in data
    assert "pairing_url" in data
    assert data["orientation"] == "LANDSCAPE"
    assert data["mandatory"] is True
    session_id = data["session"]["id"]
    token = data["pairing_token"]

    # 2. Mobile attempts invalid token -> 401
    bad_pair = client.post(
        "/api/v1/proctoring/secondary-camera/pair",
        json={"session_id": session_id, "token": "invalid_token_123"},
    )
    assert bad_pair.status_code == 401

    # 3. Mobile submits correct token -> 200
    mobile_pair = client.post(
        "/api/v1/proctoring/secondary-camera/pair",
        json={"session_id": session_id, "token": token, "device_info": "iPhone 15 Pro / Safari"},
    )
    assert mobile_pair.status_code == 200
    mobile_data = mobile_pair.json()
    assert mobile_data["status"] == "PAIRED"
    assert "mobile_token" in mobile_data
    mobile_token = mobile_data["mobile_token"]

    # 4. Mobile sends heartbeat
    hb = client.post(
        "/api/v1/proctoring/secondary-camera/heartbeat",
        json={
            "session_id": session_id,
            "mobile_token": mobile_token,
            "battery_level": 88,
            "status": "STREAMING",
        },
    )
    assert hb.status_code == 200
    hb_data = hb.json()
    assert hb_data["status"] == "STREAMING"
    assert hb_data["battery_level"] == 88

    # 5. Desktop polls status
    st = client.get(f"/api/v1/proctoring/secondary-camera/{session_id}/status")
    assert st.status_code == 200
    st_data = st.json()
    assert st_data["status"] == "STREAMING"
    assert st_data["battery_level"] == 88

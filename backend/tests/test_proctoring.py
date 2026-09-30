"""Phase 4A: the proctoring session that runs alongside a proctored exam attempt.

What is asserted here, in order: the setting that makes an exam proctored; the session's
lifecycle (created with the attempt, activated by confirmed devices, ended by the attempt
finishing); that the Phase 3 attempt lifecycle is unchanged around it; and the ownership and
tampering boundaries — which matter most, because every write here comes from the candidate's own
machine.
"""

import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.models.attempt import AttemptStatus
from app.models.base import utcnow
from app.models.proctoring import DeviceState, ProctoringSession, ProctoringSessionStatus
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers, create_assessment
from tests.test_attempts import ME, assign, question_of, save, start
from tests.test_exam_session import attempt_row, submit, wind_clock_past_deadline
from tests.test_publishing import create_candidate, published_assessment

READY = {"camera": "READY", "microphone": "READY"}


def proctored_exam(client, helpers: Helpers, users) -> dict:
    """A published, proctored assessment (MCQ 2 + multiple-select 3 + true/false 1) held by the
    candidate."""
    headers = admin_headers(helpers)
    assessment = published_assessment(client, headers)
    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}", json={"proctoring_required": True}, headers=headers
    )
    assert response.status_code == 200, response.text
    assign(client, headers, assessment["id"], str(users["candidate"].id))
    return response.json()


def unproctored_exam(client, helpers: Helpers, users) -> dict:
    headers = admin_headers(helpers)
    assessment = published_assessment(client, headers)
    assign(client, headers, assessment["id"], str(users["candidate"].id))
    return assessment


def proctoring(client, headers, attempt_id: str, expect: int = 200):
    response = client.get(f"{ME}/attempts/{attempt_id}/proctoring", headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def activate(client, headers, attempt_id: str, devices: dict = READY, expect: int = 200, **extra):
    response = client.post(
        f"{ME}/attempts/{attempt_id}/proctoring/activate", json={**devices, **extra}, headers=headers
    )
    assert response.status_code == expect, response.text
    return response.json()


def report(client, headers, attempt_id: str, devices: dict, expect: int = 200, **extra):
    response = client.put(
        f"{ME}/attempts/{attempt_id}/proctoring/devices", json={**devices, **extra}, headers=headers
    )
    assert response.status_code == expect, response.text
    return response.json()


def session_row(db, attempt: dict) -> ProctoringSession | None:
    return db.scalar(
        select(ProctoringSession).where(ProctoringSession.attempt_id == uuid.UUID(attempt["id"]))
    )


def intruder(client, helpers: Helpers, exam: dict) -> dict[str, str]:
    """A second candidate who holds the same exam, so a refusal cannot be blamed on assignment."""
    admin = admin_headers(helpers)
    other = create_candidate(
        client, admin, email="intruder@demo.local", roll_number="D7", initial_password="Intruder-pass-1"
    )
    assign(client, admin, exam["id"], other["id"])
    return helpers.bearer(helpers.token_for_candidate("intruder@demo.local", "Intruder-pass-1", "D7"))


# -- the setting ----------------------------------------------------------------------------------


def test_proctoring_is_off_by_default_and_an_admin_can_turn_it_on(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    assert assessment["settings"]["proctoring_required"] is False

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}", json={"proctoring_required": True}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["settings"]["proctoring_required"] is True
    reread = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()
    assert reread["settings"]["proctoring_required"] is True


def test_a_candidate_cannot_make_an_exam_proctored_or_unproctored(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)

    response = client.patch(
        f"/api/v1/assessments/{exam['id']}",
        json={"proctoring_required": False},
        headers=candidate_headers(helpers),
    )

    assert response.status_code == 403
    reread = client.get(f"/api/v1/assessments/{exam['id']}", headers=admin_headers(helpers)).json()
    assert reread["settings"]["proctoring_required"] is True


def test_the_candidate_is_told_before_starting_whether_an_exam_is_proctored(client, helpers: Helpers, users):
    proctored = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)

    detail = client.get(f"{ME}/assessments/{proctored['id']}", headers=headers).json()
    listed = {row["assessment_id"]: row for row in client.get(f"{ME}/assessments", headers=headers).json()}

    assert detail["proctoring_required"] is True
    assert listed[proctored["id"]]["proctoring_required"] is True


# -- creation -------------------------------------------------------------------------------------


def test_starting_a_proctored_exam_creates_a_not_started_session(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)

    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert attempt["proctoring"]["status"] == ProctoringSessionStatus.NOT_STARTED
    assert attempt["proctoring"]["attempt_id"] == attempt["id"]
    assert attempt["proctoring"]["camera_state"] == DeviceState.NOT_READY
    assert attempt["proctoring"]["microphone_state"] == DeviceState.NOT_READY
    assert attempt["proctoring"]["started_at"] is None
    assert attempt["proctoring"]["ended_at"] is None
    row = session_row(db, attempt)
    assert row is not None
    assert row.attempt.candidate_id == users["candidate"].id


def test_starting_a_non_proctored_exam_creates_no_session(client, helpers: Helpers, users, db):
    exam = unproctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)

    attempt = start(client, headers, exam["id"])

    assert attempt["proctoring"] is None
    assert session_row(db, attempt) is None
    proctoring(client, headers, attempt["id"], expect=404)
    activate(client, headers, attempt["id"], expect=404)


def test_a_non_proctored_exam_runs_exactly_as_in_phase_3(client, helpers: Helpers, users):
    """Answer straight away, without any proctoring step, and submit."""
    exam = unproctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")

    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][1]["id"]])
    finished = submit(client, headers, attempt["id"])

    assert finished["status"] == AttemptStatus.SUBMITTED
    assert finished["proctoring"] is None


def test_resuming_a_proctored_exam_keeps_the_same_session(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)

    first = start(client, headers, exam["id"])
    again = start(client, headers, exam["id"])

    assert again["id"] == first["id"]
    assert again["proctoring"]["id"] == first["proctoring"]["id"]
    count = db.scalar(
        select(func.count())
        .select_from(ProctoringSession)
        .where(ProctoringSession.attempt_id == uuid.UUID(first["id"]))
    )
    assert count == 1


def test_changing_the_setting_does_not_change_a_running_attempt(client, helpers: Helpers, users):
    """Proctoring is decided when the attempt starts; the session row is what carries it after."""
    exam = unproctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    client.patch(
        f"/api/v1/assessments/{exam['id']}",
        json={"proctoring_required": True},
        headers=admin_headers(helpers),
    )

    resumed = start(client, headers, exam["id"])
    assert resumed["id"] == attempt["id"]
    assert resumed["proctoring"] is None
    mcq = question_of(resumed, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][0]["id"]])  # still not gated


# -- activation -----------------------------------------------------------------------------------


def test_confirmed_devices_activate_the_session(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    session = activate(client, headers, attempt["id"])

    assert session["status"] == ProctoringSessionStatus.ACTIVE
    assert session["camera_state"] == DeviceState.READY
    assert session["microphone_state"] == DeviceState.READY
    assert session["started_at"] is not None
    assert session["devices_reported_at"] is not None
    assert session["ended_at"] is None
    assert proctoring(client, headers, attempt["id"]) == session
    assert start(client, headers, exam["id"])["proctoring"] == session


def test_activation_requires_both_devices_ready(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    for devices, refused in (
        ({"camera": "DENIED", "microphone": "READY"}, {"camera"}),
        ({"camera": "READY", "microphone": "UNAVAILABLE"}, {"microphone"}),
        ({"camera": "NOT_READY", "microphone": "DENIED"}, {"camera", "microphone"}),
    ):
        response = client.post(
            f"{ME}/attempts/{attempt['id']}/proctoring/activate", json=devices, headers=headers
        )
        assert response.status_code == 422, response.text
        assert {d["field"] for d in response.json()["error"]["details"]} == refused

    assert session_row(db, attempt).status is ProctoringSessionStatus.NOT_STARTED


def test_an_unknown_device_state_is_rejected(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    activate(client, headers, attempt["id"], {"camera": "FACE_DETECTED", "microphone": "READY"}, expect=422)
    activate(client, headers, attempt["id"], {"camera": "READY"}, expect=422)


def test_activating_again_on_resume_keeps_the_original_start(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    first = activate(client, headers, attempt["id"])

    again = activate(client, headers, attempt["id"])

    assert again["status"] == ProctoringSessionStatus.ACTIVE
    assert again["started_at"] == first["started_at"]
    assert again["devices_reported_at"] >= first["devices_reported_at"]


def test_a_client_cannot_set_session_timestamps_or_status(client, helpers: Helpers, users, db):
    """No request shape accepts them; sending them anyway changes nothing."""
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    forged = (utcnow() - timedelta(days=3)).isoformat()

    session = activate(
        client,
        headers,
        attempt["id"],
        started_at=forged,
        ended_at=forged,
        devices_reported_at=forged,
        status="ENDED",
    )

    row = session_row(db, attempt)
    assert row.status is ProctoringSessionStatus.ACTIVE
    assert row.ended_at is None
    assert row.started_at > utcnow() - timedelta(minutes=1)
    assert session["started_at"] != forged


# -- answering under proctoring -------------------------------------------------------------------


def test_a_proctored_exam_cannot_be_answered_before_proctoring_is_active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")

    response = client.put(
        f"{ME}/attempts/{attempt['id']}/answers/{mcq['id']}",
        json={"selected_option_ids": [mcq["options"][1]["id"]]},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "proctoring_not_active"

    activate(client, headers, attempt["id"])
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][1]["id"]])


def test_device_changes_are_recorded_while_active(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])

    lost = report(client, headers, attempt["id"], {"camera": "UNAVAILABLE", "microphone": "READY"})

    assert lost["camera_state"] == DeviceState.UNAVAILABLE
    assert lost["status"] == ProctoringSessionStatus.ACTIVE  # a device change is not a verdict
    # Losing a device does not stop the exam: answering still works (what should happen is an
    # open product decision, recorded in docs/PHASE-4-PLAN.md).
    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][1]["id"]])

    recovered = report(client, headers, attempt["id"], READY)
    assert recovered["camera_state"] == DeviceState.READY
    assert session_row(db, attempt).camera_state is DeviceState.READY


def test_devices_cannot_be_reported_before_activation(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    response = client.put(f"{ME}/attempts/{attempt['id']}/proctoring/devices", json=READY, headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "proctoring_not_active"


# -- ending ---------------------------------------------------------------------------------------


def test_submitting_ends_the_session(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])

    finished = submit(client, headers, attempt["id"])

    assert finished["status"] == AttemptStatus.SUBMITTED
    assert finished["proctoring"]["status"] == ProctoringSessionStatus.ENDED
    row = session_row(db, attempt)
    assert row.status is ProctoringSessionStatus.ENDED
    assert row.ended_at == attempt_row(db, attempt).finalized_at


def test_submitting_twice_leaves_one_consistent_ending(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])

    first = submit(client, headers, attempt["id"])
    second = submit(client, headers, attempt["id"])  # Phase 3: idempotent

    assert second["proctoring"] == first["proctoring"]
    assert second["proctoring"]["ended_at"] == first["proctoring"]["ended_at"]


def test_a_timeout_ends_the_session_at_the_deadline(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    # Time passes: proctoring began ten minutes ago, and the deadline went by five seconds ago.
    session_row(db, attempt).started_at = utcnow() - timedelta(minutes=10)
    row = wind_clock_past_deadline(db, attempt, seconds_ago=5)

    session = proctoring(client, headers, attempt["id"])  # any read settles the clock

    assert attempt_row(db, attempt).status is AttemptStatus.TIME_EXPIRED
    assert session["status"] == ProctoringSessionStatus.ENDED
    # The exam ended at its deadline, not when the server noticed — and so did proctoring.
    assert session_row(db, attempt).ended_at == row.expires_at


def test_a_session_that_never_started_still_ends_with_its_attempt(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    submit(client, headers, attempt["id"])  # submitting is never blocked by proctoring

    row = session_row(db, attempt)
    assert row.status is ProctoringSessionStatus.ENDED
    assert row.started_at is None
    assert row.ended_at is not None


def test_an_ended_session_cannot_be_reactivated_or_updated(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    submit(client, headers, attempt["id"])

    for response in (
        client.post(f"{ME}/attempts/{attempt['id']}/proctoring/activate", json=READY, headers=headers),
        client.put(f"{ME}/attempts/{attempt['id']}/proctoring/devices", json=READY, headers=headers),
    ):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "attempt_locked"

    assert session_row(db, attempt).status is ProctoringSessionStatus.ENDED


def test_activation_after_the_deadline_is_refused_and_ends_the_session(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    wind_clock_past_deadline(db, attempt)

    response = client.post(f"{ME}/attempts/{attempt['id']}/proctoring/activate", json=READY, headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "attempt_locked"
    assert session_row(db, attempt).status is ProctoringSessionStatus.ENDED


def test_the_phase_3_result_is_still_produced_for_a_proctored_exam(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][1]["id"]])  # the correct option
    submit(client, headers, attempt["id"])

    results = client.get(f"/api/v1/assessments/{exam['id']}/results", headers=admin_headers(helpers))

    assert results.status_code == 200, results.text
    [row] = results.json()["results"]
    assert row["attempt_id"] == attempt["id"]
    assert row["score"] == 2


# -- ownership ------------------------------------------------------------------------------------


def test_another_candidate_cannot_read_or_change_a_session(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    other = intruder(client, helpers, exam)

    proctoring(client, other, attempt["id"], expect=404)  # not found, not forbidden
    activate(client, other, attempt["id"], expect=404)
    report(client, other, attempt["id"], READY, expect=404)

    assert session_row(db, attempt).status is ProctoringSessionStatus.NOT_STARTED


def test_a_candidate_cannot_attach_a_session_to_another_candidates_attempt(
    client, helpers: Helpers, users, db
):
    """No route takes a candidate id; adding one to the request changes nothing."""
    exam = proctored_exam(client, helpers, users)
    other = intruder(client, helpers, exam)
    victim = start(client, candidate_headers(helpers), exam["id"])

    own = start(client, other, exam["id"])
    response = client.post(
        f"{ME}/attempts/{own['id']}/proctoring/activate",
        json={**READY, "candidate_id": str(users["candidate"].id), "attempt_id": victim["id"]},
        headers=other,
    )

    assert response.status_code == 200, response.text

    assert session_row(db, victim).status is ProctoringSessionStatus.NOT_STARTED
    assert session_row(db, own).status is ProctoringSessionStatus.ACTIVE
    assert session_row(db, own).attempt_id == uuid.UUID(own["id"])


def test_an_admin_cannot_use_the_candidate_proctoring_routes(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])

    admin = admin_headers(helpers)
    assert client.get(f"{ME}/attempts/{attempt['id']}/proctoring", headers=admin).status_code == 403
    response = client.post(f"{ME}/attempts/{attempt['id']}/proctoring/activate", json=READY, headers=admin)
    assert response.status_code == 403


def test_proctoring_routes_require_authentication(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert client.get(f"{ME}/attempts/{attempt['id']}/proctoring").status_code == 401
    assert client.post(f"{ME}/attempts/{attempt['id']}/proctoring/activate", json=READY).status_code == 401
    assert client.put(f"{ME}/attempts/{attempt['id']}/proctoring/devices", json=READY).status_code == 401


def test_there_is_no_route_to_end_a_session_early(client, helpers: Helpers, users, db):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])

    for method, path in (
        ("POST", f"{ME}/attempts/{attempt['id']}/proctoring/end"),
        ("DELETE", f"{ME}/attempts/{attempt['id']}/proctoring"),
    ):
        assert client.request(method, path, headers=headers).status_code in {404, 405}

    assert session_row(db, attempt).status is ProctoringSessionStatus.ACTIVE

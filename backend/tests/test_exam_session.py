"""Phase 3B: the server-side clock, submission, and the locking of a finished attempt.

Time is simulated by moving an attempt's stored `expires_at`, not by sleeping. The deadline is an
ordinary column, so rewriting it in the test database is exactly equivalent to the clock having
advanced — and it keeps the suite fast without adding an injectable clock to production code.
"""

import uuid
from datetime import timedelta

from app.models.assessment import Assessment
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.base import utcnow
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, assign, assigned_exam, question_of, save, start
from tests.test_publishing import create_candidate

DURATION_MINUTES = 60  # `tests.test_assessments.VALID_ASSESSMENT`


def attempt_row(db, attempt: dict) -> AssessmentAttempt:
    return db.get(AssessmentAttempt, uuid.UUID(attempt["id"]))


def wind_clock_past_deadline(db, attempt: dict, *, seconds_ago: int = 1) -> AssessmentAttempt:
    """Moves the attempt's deadline into the past — the same state as time having run out."""
    row = attempt_row(db, attempt)
    row.expires_at = utcnow() - timedelta(seconds=seconds_ago)
    db.flush()
    return row


def submit(client, headers, attempt_id: str, expect: int = 200):
    response = client.post(f"{ME}/attempts/{attempt_id}/submit", headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def session(client, headers, attempt_id: str, expect: int = 200):
    response = client.get(f"{ME}/attempts/{attempt_id}/session", headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


# -- the deadline ---------------------------------------------------------------------------------


def test_the_deadline_is_the_start_plus_the_configured_duration(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)

    attempt = start(client, candidate_headers(helpers), exam["id"])

    row = attempt_row(db, attempt)
    assert row.expires_at - row.started_at == timedelta(minutes=DURATION_MINUTES)


def test_a_shorter_exam_gets_a_shorter_deadline(client, helpers: Helpers, users, db):
    """The duration comes from the assessment, not from a constant."""
    exam = assigned_exam(client, helpers, users)
    db.get(Assessment, uuid.UUID(exam["id"])).duration_minutes = 5
    db.flush()

    attempt = start(client, candidate_headers(helpers), exam["id"])

    row = attempt_row(db, attempt)
    assert row.expires_at - row.started_at == timedelta(minutes=5)


def test_the_attempt_reports_its_deadline_and_the_servers_own_clock(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)

    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert attempt["expires_at"] > attempt["started_at"]
    assert attempt["server_time"]
    assert attempt["submitted_at"] is None
    assert attempt["finalized_at"] is None
    # Truncated, never rounded up: the display can understate but never overstate the time left.
    assert 0 < attempt["remaining_seconds"] <= DURATION_MINUTES * 60


def test_the_session_endpoint_carries_the_clock_without_the_paper(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = session(client, headers, attempt["id"])

    assert body["attempt_id"] == attempt["id"]
    assert body["status"] == AttemptStatus.IN_PROGRESS
    assert body["expires_at"] == attempt["expires_at"]
    assert body["server_time"]
    assert 0 < body["remaining_seconds"] <= DURATION_MINUTES * 60
    assert "questions" not in body  # this is polled; it stays small


def test_a_client_cannot_set_its_own_deadline(client, helpers: Helpers, users, db):
    """No request shape accepts timing, and sending it anyway changes nothing."""
    exam = assigned_exam(client, helpers, users)
    forged_start = (utcnow() - timedelta(hours=5)).isoformat()
    forged_end = (utcnow() + timedelta(days=30)).isoformat()

    response = client.post(
        f"{ME}/assessments/{exam['id']}/attempts",
        json={"started_at": forged_start, "expires_at": forged_end, "remaining_seconds": 999999},
        headers=candidate_headers(helpers),
    )

    assert response.status_code == 200
    row = attempt_row(db, response.json())
    assert row.expires_at - row.started_at == timedelta(minutes=DURATION_MINUTES)
    assert row.expires_at < utcnow() + timedelta(minutes=DURATION_MINUTES + 1)


def test_resuming_does_not_restart_the_clock(client, helpers: Helpers, users):
    """The single most important timer property: reopening the exam is not a fresh hour."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)

    first = start(client, headers, exam["id"])
    again = start(client, headers, exam["id"])
    reloaded = client.get(f"{ME}/attempts/{first['id']}", headers=headers).json()

    assert again["expires_at"] == first["expires_at"]
    assert again["started_at"] == first["started_at"]
    assert reloaded["expires_at"] == first["expires_at"]


def test_a_candidate_cannot_buy_time_by_editing_the_attempt_through_the_answer_route(
    client, helpers: Helpers, users, db
):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    before = attempt_row(db, attempt).expires_at

    client.put(
        f"{ME}/attempts/{attempt['id']}/answers/{mcq['id']}",
        json={
            "selected_option_ids": [mcq["options"][0]["id"]],
            "expires_at": (utcnow() + timedelta(days=1)).isoformat(),
            "status": "IN_PROGRESS",
        },
        headers=headers,
    )

    assert attempt_row(db, attempt).expires_at == before


# -- running out of time --------------------------------------------------------------------------


def test_an_expired_attempt_is_finished_the_next_time_it_is_read(client, helpers: Helpers, users, db):
    """Automatic timeout without a background worker: the next interaction settles it."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    deadline = wind_clock_past_deadline(db, attempt).expires_at

    body = client.get(f"{ME}/attempts/{attempt['id']}", headers=headers).json()

    assert body["status"] == AttemptStatus.TIME_EXPIRED
    assert body["remaining_seconds"] == 0
    assert body["submitted_at"] is None
    row = attempt_row(db, attempt)
    assert row.status is AttemptStatus.TIME_EXPIRED
    # Finalized when the time ran out, not when the server noticed.
    assert row.finalized_at == deadline


def test_polling_the_session_also_finishes_an_expired_attempt(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    wind_clock_past_deadline(db, attempt)

    body = session(client, headers, attempt["id"])

    assert body["status"] == AttemptStatus.TIME_EXPIRED
    assert body["remaining_seconds"] == 0
    assert attempt_row(db, attempt).status is AttemptStatus.TIME_EXPIRED


def test_opening_my_exams_finishes_an_attempt_whose_time_ran_out(client, helpers: Helpers, users, db):
    """A candidate who never opens the exam screen still cannot dodge expiry."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    wind_clock_past_deadline(db, attempt)

    rows = client.get(f"{ME}/assessments", headers=headers).json()

    row = next(r for r in rows if r["assessment_id"] == exam["id"])
    assert row["latest_attempt_status"] == AttemptStatus.TIME_EXPIRED
    assert row["active_attempt_id"] is None  # nothing left to resume
    assert attempt_row(db, attempt).status is AttemptStatus.TIME_EXPIRED


def test_an_answer_arriving_after_the_deadline_is_refused(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    wind_clock_past_deadline(db, attempt)

    body = save(client, headers, attempt["id"], mcq["id"], [mcq["options"][0]["id"]], expect=409)

    assert body["error"]["code"] == "attempt_locked"
    # Refused *and* settled: the attempt is finished in the database, not merely rejected.
    assert attempt_row(db, attempt).status is AttemptStatus.TIME_EXPIRED


def test_answers_saved_before_the_deadline_survive_expiry(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][1]["id"]])
    wind_clock_past_deadline(db, attempt)

    body = client.get(f"{ME}/attempts/{attempt['id']}", headers=headers).json()

    assert body["status"] == AttemptStatus.TIME_EXPIRED
    assert body["answers"][0]["selected_option_ids"] == [mcq["options"][1]["id"]]


def test_an_expired_attempt_cannot_be_reopened(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    wind_clock_past_deadline(db, attempt)

    response = client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=headers)

    # The one allowed attempt is spent; starting again is refused rather than resuming it.
    assert response.status_code == 409
    assert attempt_row(db, attempt).status is AttemptStatus.TIME_EXPIRED


# -- submitting -----------------------------------------------------------------------------------


def test_a_candidate_can_submit_their_own_attempt(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = submit(client, headers, attempt["id"])

    assert body["status"] == AttemptStatus.SUBMITTED
    assert body["submitted_at"] is not None
    assert body["finalized_at"] == body["submitted_at"]
    assert body["remaining_seconds"] == 0
    row = attempt_row(db, attempt)
    assert row.status is AttemptStatus.SUBMITTED
    assert row.submitted_at is not None


def test_submitting_returns_no_score_of_any_kind(client, helpers: Helpers, users):
    """Phase 3C has not been built; the submission response must not pretend otherwise."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = submit(client, headers, attempt["id"])

    assert not {"score", "percentage", "passed", "pass_fail", "result", "marks_obtained"} & set(body)
    assert "is_correct" not in str(body)


def test_submitting_twice_is_harmless(client, helpers: Helpers, users):
    """A retried or double-clicked submit returns the same finalized attempt, not an error."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    first = submit(client, headers, attempt["id"])
    second = submit(client, headers, attempt["id"])

    assert second["status"] == AttemptStatus.SUBMITTED
    assert second["submitted_at"] == first["submitted_at"]  # not re-stamped


def test_a_submitted_attempt_refuses_answer_changes(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][0]["id"]])
    submit(client, headers, attempt["id"])

    changed = save(client, headers, attempt["id"], mcq["id"], [mcq["options"][2]["id"]], expect=409)

    assert changed["error"]["code"] == "attempt_locked"
    # And the stored answer is the one from before submission.
    body = client.get(f"{ME}/attempts/{attempt['id']}", headers=headers).json()
    assert body["answers"][0]["selected_option_ids"] == [mcq["options"][0]["id"]]


def test_a_submitted_attempt_cannot_be_reopened(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    submit(client, headers, attempt["id"])

    response = client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=headers)

    assert response.status_code == 409


def test_my_exams_shows_a_submitted_exam_as_finished(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    submit(client, headers, attempt["id"])

    rows = client.get(f"{ME}/assessments", headers=headers).json()
    detail = client.get(f"{ME}/assessments/{exam['id']}", headers=headers).json()

    row = next(r for r in rows if r["assessment_id"] == exam["id"])
    assert row["latest_attempt_status"] == AttemptStatus.SUBMITTED
    assert row["active_attempt_id"] is None
    # The details screen can still reach the finished attempt, which is how the final state shows.
    assert detail["latest_attempt_id"] == attempt["id"]
    assert detail["latest_attempt_status"] == AttemptStatus.SUBMITTED
    assert detail["can_start"] is False


# -- submit versus expiry -------------------------------------------------------------------------


def test_a_submit_arriving_before_the_deadline_wins(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    row = attempt_row(db, attempt)
    row.expires_at = utcnow() + timedelta(seconds=30)  # nearly out of time, but not yet
    db.flush()

    body = submit(client, headers, attempt["id"])

    assert body["status"] == AttemptStatus.SUBMITTED


def test_a_submit_arriving_after_the_deadline_loses_deterministically(client, helpers: Helpers, users, db):
    """The server's clock decides. A request that left the client in time but arrives late is late."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    wind_clock_past_deadline(db, attempt)

    body = submit(client, headers, attempt["id"], expect=409)

    assert body["error"]["code"] == "attempt_locked"
    row = attempt_row(db, attempt)
    assert row.status is AttemptStatus.TIME_EXPIRED  # not SUBMITTED
    assert row.submitted_at is None


def test_the_deadline_instant_itself_counts_as_expired(client, helpers: Helpers, users, db):
    """`>=`, so the final instant does not hand back one more tick."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    wind_clock_past_deadline(db, attempt, seconds_ago=0)

    assert session(client, headers, attempt["id"])["status"] == AttemptStatus.TIME_EXPIRED


# -- security -------------------------------------------------------------------------------------


def test_a_candidate_cannot_submit_or_time_another_candidates_attempt(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    admin = admin_headers(helpers)
    attempt = start(client, candidate_headers(helpers), exam["id"])

    other = create_candidate(
        client, admin, email="rival@demo.local", roll_number="D8", initial_password="Rival-pass-1"
    )
    assign(client, admin, exam["id"], other["id"])
    intruder = helpers.bearer(helpers.token_for_candidate("rival@demo.local", "Rival-pass-1", "D8"))

    # Not found, not forbidden: no disclosure that the attempt exists.
    assert client.get(f"{ME}/attempts/{attempt['id']}/session", headers=intruder).status_code == 404
    assert client.post(f"{ME}/attempts/{attempt['id']}/submit", headers=intruder).status_code == 404


def test_the_session_and_submit_routes_reject_anonymous_and_admin_callers(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert client.get(f"{ME}/attempts/{attempt['id']}/session").status_code == 401
    assert client.post(f"{ME}/attempts/{attempt['id']}/submit").status_code == 401

    admin = admin_headers(helpers)
    assert client.get(f"{ME}/attempts/{attempt['id']}/session", headers=admin).status_code == 403
    assert client.post(f"{ME}/attempts/{attempt['id']}/submit", headers=admin).status_code == 403


def test_submitting_an_unknown_attempt_is_not_found(client, helpers: Helpers, users):
    assert (
        client.post(f"{ME}/attempts/{uuid.uuid4()}/submit", headers=candidate_headers(helpers)).status_code
        == 404
    )


def test_a_finished_attempt_still_hides_the_answer_key(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    submitted = client.post(f"{ME}/attempts/{attempt['id']}/submit", headers=headers)
    reread = client.get(f"{ME}/attempts/{attempt['id']}", headers=headers)

    for response in (submitted, reread):
        assert "is_correct" not in response.text
        assert "explanation" not in response.text


# -- the Phase 3B boundary ------------------------------------------------------------------------


def test_the_lifecycle_has_exactly_the_three_expected_states():
    assert sorted(s.value for s in AttemptStatus) == ["IN_PROGRESS", "SUBMITTED", "TIME_EXPIRED"]


def test_finishing_carries_no_proctoring_or_risk_information(client, helpers: Helpers, users):
    """Results arrived with Phase 3C; anything from Phase 4 must still be absent."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = submit(client, headers, attempt["id"])

    assert not {
        "risk_score",
        "risk_level",
        "proctoring_events",
        "evidence",
        "integrity_score",
    } & set(body)
    assert client.get(f"{ME}/attempts/{attempt['id']}/proctoring", headers=headers).status_code == 404

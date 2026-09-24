"""Phase 3A: starting an exam, reading the paper, and recording answers.

The security tests here are the point of the file. A candidate's exam data is the first thing in
this project that another candidate would want, and the answer key is the first thing every
candidate would want, so both boundaries are asserted rather than assumed.
"""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.assessment import Assessment, AssessmentStatus
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.base import utcnow
from app.services.attempts import AttemptService
from tests.conftest import CANDIDATE_PASSWORD, Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_publishing import create_candidate, published_assessment

ME = "/api/v1/candidates/me"


def assign(client, headers, assessment_id: str, candidate_id: str) -> None:
    response = client.post(
        f"/api/v1/assessments/{assessment_id}/assignments",
        json={"candidate_ids": [candidate_id]},
        headers=headers,
    )
    assert response.status_code == 201, response.text


def assigned_exam(client, helpers: Helpers, users) -> dict:
    """A published assessment (MCQ 2 + multiple-select 3 + true/false 1) held by the candidate."""
    headers = admin_headers(helpers)
    assessment = published_assessment(client, headers)
    assign(client, headers, assessment["id"], str(users["candidate"].id))
    return assessment


def start(client, headers, assessment_id: str, expect: int = 200) -> dict:
    response = client.post(f"{ME}/assessments/{assessment_id}/attempts", headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def question_of(attempt: dict, question_type: str) -> dict:
    return next(q for q in attempt["questions"] if q["type"] == question_type)


def save(client, headers, attempt_id: str, question_id: str, option_ids: list[str], expect: int = 200):
    return _expect(
        client.put(
            f"{ME}/attempts/{attempt_id}/answers/{question_id}",
            json={"selected_option_ids": option_ids},
            headers=headers,
        ),
        expect,
    )


def _expect(response, expect: int):
    assert response.status_code == expect, response.text
    return response.json() if response.content else None


# -- starting an attempt -------------------------------------------------------------------------


def test_an_assigned_candidate_can_start_a_published_exam(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)

    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert attempt["status"] == AttemptStatus.IN_PROGRESS
    assert attempt["attempt_number"] == 1
    assert attempt["assessment_id"] == exam["id"]
    assert attempt["started_at"]
    assert uuid.UUID(attempt["id"])


def test_a_started_attempt_carries_the_paper_and_no_answers_yet(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)

    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert len(attempt["questions"]) == 3
    assert attempt["answers"] == []
    assert attempt["question_navigation"] == "FREE"


def test_an_unassigned_candidate_cannot_start(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    exam = published_assessment(client, headers)  # published, but assigned to nobody

    response = client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=candidate_headers(helpers))

    # 404, not 403: an exam they were never given must not be distinguishable from one that
    # does not exist.
    assert response.status_code == 404


def test_an_unknown_assessment_cannot_be_started(client, helpers: Helpers, users):
    response = client.post(f"{ME}/assessments/{uuid.uuid4()}/attempts", headers=candidate_headers(helpers))

    assert response.status_code == 404


def test_an_assessment_that_is_not_published_cannot_be_started(client, helpers: Helpers, users, db):
    """Assignment requires PUBLISHED and unpublishing is refused while anyone holds it, so this
    state is unreachable through the API — the guard is checked directly against the database."""
    exam = assigned_exam(client, helpers, users)
    db.get(Assessment, uuid.UUID(exam["id"])).status = AssessmentStatus.DRAFT
    db.flush()

    response = client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=candidate_headers(helpers))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_an_exam_outside_its_availability_window_cannot_be_started(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    assessment = db.get(Assessment, uuid.UUID(exam["id"]))
    assessment.availability_end = utcnow().replace(year=utcnow().year - 1)
    db.flush()

    response = client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=candidate_headers(helpers))

    assert response.status_code == 409
    assert "closed" in response.json()["error"]["message"].lower()


def test_starting_twice_resumes_the_same_attempt(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)

    first = start(client, headers, exam["id"])
    second = start(client, headers, exam["id"])

    assert first["id"] == second["id"]
    assert second["attempt_number"] == 1
    attempts = db.query(AssessmentAttempt).filter_by(assessment_id=uuid.UUID(exam["id"])).all()
    assert len(attempts) == 1  # resumed, not duplicated


def test_a_second_open_attempt_is_impossible_even_below_the_database(client, helpers: Helpers, users, db):
    """`uq_attempt_one_active_per_candidate` is what makes two concurrent Start clicks safe, so
    the index itself is asserted rather than only the service's read-then-write."""
    exam = assigned_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    row = db.get(AssessmentAttempt, uuid.UUID(attempt["id"]))

    duplicate = AssessmentAttempt(
        assessment_id=row.assessment_id,
        candidate_id=row.candidate_id,
        assignment_id=row.assignment_id,
        attempt_number=2,
        status=AttemptStatus.IN_PROGRESS,
        started_at=utcnow(),
        expires_at=row.expires_at,  # valid, so the unique index is what rejects this
    )
    db.add(duplicate)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_the_maximum_attempt_configuration_blocks_a_further_attempt(client, helpers: Helpers, users, db):
    """The allowance itself, checked directly.

    Reaching it through the API needs a finished attempt, which is Phase 3B's
    `test_a_submitted_attempt_cannot_be_reopened`.
    """
    exam = assigned_exam(client, helpers, users)
    assessment = db.get(Assessment, uuid.UUID(exam["id"]))
    service = AttemptService(db)

    assert assessment.max_attempts == 1
    assert service.start_blocker(assessment, attempts_used=0) is None
    assert "all 1 attempt" in service.start_blocker(assessment, attempts_used=1)


def test_the_attempt_belongs_to_the_session_user_whatever_the_request_says(
    client, helpers: Helpers, users, db
):
    """There is no candidate id in the route, body or query — this asserts that adding one does
    not change whose attempt is created."""
    exam = assigned_exam(client, helpers, users)
    other = create_candidate(client, admin_headers(helpers), email="other@demo.local", roll_number="D9")

    response = client.post(
        f"{ME}/assessments/{exam['id']}/attempts?candidate_id={other['id']}",
        json={"candidate_id": other["id"]},
        headers=candidate_headers(helpers),
    )

    assert response.status_code == 200
    attempt = db.get(AssessmentAttempt, uuid.UUID(response.json()["id"]))
    assert attempt.candidate_id == users["candidate"].id


# -- exam details --------------------------------------------------------------------------------


def test_exam_details_report_that_the_exam_can_be_started(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)

    body = _expect(client.get(f"{ME}/assessments/{exam['id']}", headers=candidate_headers(helpers)), 200)

    assert body["can_start"] is True
    assert body["active_attempt_id"] is None
    assert body["attempts_used"] == 0
    assert body["start_blocked_reason"] is None
    assert body["question_count"] == 3


def test_exam_details_offer_the_open_attempt_once_one_exists(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = _expect(client.get(f"{ME}/assessments/{exam['id']}", headers=headers), 200)

    assert body["active_attempt_id"] == attempt["id"]
    assert body["can_start"] is False  # resume, not start again
    assert body["attempts_used"] == 1


def test_exam_details_never_carry_questions_or_answer_keys(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)

    response = client.get(f"{ME}/assessments/{exam['id']}", headers=candidate_headers(helpers))

    assert "questions" not in response.json()
    assert "is_correct" not in response.text


def test_exam_details_for_an_unassigned_assessment_are_not_found(client, helpers: Helpers, users):
    exam = published_assessment(client, admin_headers(helpers))

    response = client.get(f"{ME}/assessments/{exam['id']}", headers=candidate_headers(helpers))

    assert response.status_code == 404


def test_my_exams_shows_the_open_attempt_so_the_card_can_offer_resume(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    rows = _expect(client.get(f"{ME}/assessments", headers=headers), 200)

    row = next(r for r in rows if r["assessment_id"] == exam["id"])
    assert row["active_attempt_id"] == attempt["id"]


# -- attempt access ------------------------------------------------------------------------------


def test_a_candidate_can_read_their_own_attempt(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = _expect(client.get(f"{ME}/attempts/{attempt['id']}", headers=headers), 200)

    assert body["id"] == attempt["id"]
    assert len(body["questions"]) == 3


def test_a_candidate_cannot_reach_another_candidates_attempt(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    admin = admin_headers(helpers)
    attempt = start(client, candidate_headers(helpers), exam["id"])

    other = create_candidate(
        client, admin, email="intruder@demo.local", roll_number="D7", initial_password="Intruder-pass-1"
    )
    assign(client, admin, exam["id"], other["id"])
    intruder = helpers.bearer(helpers.token_for_candidate("intruder@demo.local", "Intruder-pass-1", "D7"))

    read = client.get(f"{ME}/attempts/{attempt['id']}", headers=intruder)

    assert read.status_code == 404  # not found, not forbidden: no existence disclosure
    # Nor can they write to it, even holding the same exam themselves.
    question_id = question_of(attempt, "MCQ")["id"]
    save(client, intruder, attempt["id"], question_id, [], expect=404)


def test_an_unknown_attempt_is_not_found(client, helpers: Helpers, users):
    response = client.get(f"{ME}/attempts/{uuid.uuid4()}", headers=candidate_headers(helpers))

    assert response.status_code == 404


def test_the_exam_endpoints_reject_anonymous_and_admin_callers(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    question_id = question_of(attempt, "MCQ")["id"]

    anonymous = [
        client.get(f"{ME}/assessments/{exam['id']}"),
        client.post(f"{ME}/assessments/{exam['id']}/attempts"),
        client.get(f"{ME}/attempts/{attempt['id']}"),
        client.put(f"{ME}/attempts/{attempt['id']}/answers/{question_id}", json={"selected_option_ids": []}),
    ]
    for response in anonymous:
        assert response.status_code == 401, response.text

    admin = admin_headers(helpers)
    for response in [
        client.get(f"{ME}/assessments/{exam['id']}", headers=admin),
        client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=admin),
        client.get(f"{ME}/attempts/{attempt['id']}", headers=admin),
    ]:
        assert response.status_code == 403, response.text


# -- the paper the candidate receives --------------------------------------------------------------


def test_questions_arrive_in_their_authored_order(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)

    attempt = start(client, candidate_headers(helpers), exam["id"])

    assert [q["position"] for q in attempt["questions"]] == [0, 1, 2]
    assert [q["type"] for q in attempt["questions"]] == ["MCQ", "MULTIPLE_SELECT", "TRUE_FALSE"]
    assert [o["position"] for o in attempt["questions"][0]["options"]] == [0, 1, 2, 3]


def test_the_answer_key_never_reaches_the_candidate(client, helpers: Helpers, users):
    """The single most important assertion in Phase 3A."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)

    started = client.post(f"{ME}/assessments/{exam['id']}/attempts", headers=headers)
    fetched = client.get(f"{ME}/attempts/{started.json()['id']}", headers=headers)

    for response in (started, fetched):
        assert "is_correct" not in response.text
        assert "explanation" not in response.text
        for question in response.json()["questions"]:
            assert set(question) == {"id", "type", "text", "marks", "position", "options"}
            for option in question["options"]:
                assert set(option) == {"id", "text", "position"}


def test_the_admin_shape_still_carries_the_answer_key(client, helpers: Helpers, users):
    """The candidate shape is narrower; authoring must not have lost anything."""
    exam = assigned_exam(client, helpers, users)

    body = _expect(client.get(f"/api/v1/assessments/{exam['id']}", headers=admin_headers(helpers)), 200)

    assert any(option["is_correct"] for option in body["questions"][0]["options"])


# -- answering -----------------------------------------------------------------------------------


def test_an_mcq_answer_is_saved_and_read_back(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")

    saved = save(client, headers, attempt["id"], mcq["id"], [mcq["options"][1]["id"]])

    assert saved["selected_option_ids"] == [mcq["options"][1]["id"]]
    reloaded = _expect(client.get(f"{ME}/attempts/{attempt['id']}", headers=headers), 200)
    assert reloaded["answers"][0]["selected_option_ids"] == [mcq["options"][1]["id"]]


def test_a_multiple_select_answer_keeps_every_selection(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    question = question_of(attempt, "MULTIPLE_SELECT")
    chosen = [question["options"][0]["id"], question["options"][2]["id"]]

    saved = save(client, headers, attempt["id"], question["id"], chosen)

    assert sorted(saved["selected_option_ids"]) == sorted(chosen)


def test_a_true_false_answer_is_saved(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    question = question_of(attempt, "TRUE_FALSE")

    saved = save(client, headers, attempt["id"], question["id"], [question["options"][0]["id"]])

    assert saved["selected_option_ids"] == [question["options"][0]["id"]]


def test_changing_an_answer_replaces_the_previous_one(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")

    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][0]["id"]])
    saved = save(client, headers, attempt["id"], mcq["id"], [mcq["options"][3]["id"]])

    assert saved["selected_option_ids"] == [mcq["options"][3]["id"]]
    reloaded = _expect(client.get(f"{ME}/attempts/{attempt['id']}", headers=headers), 200)
    assert len(reloaded["answers"]) == 1  # replaced, not appended


def test_an_answer_can_be_cleared(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][0]["id"]])

    cleared = save(client, headers, attempt["id"], mcq["id"], [])

    assert cleared["selected_option_ids"] == []
    # The row survives: "answered then cleared" and "never opened" are different states.
    reloaded = _expect(client.get(f"{ME}/attempts/{attempt['id']}", headers=headers), 200)
    assert len(reloaded["answers"]) == 1


def test_a_fabricated_option_is_rejected(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")

    save(client, headers, attempt["id"], mcq["id"], [str(uuid.uuid4())], expect=422)


def test_an_option_belonging_to_another_question_is_rejected(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    elsewhere = question_of(attempt, "TRUE_FALSE")["options"][0]["id"]

    body = save(client, headers, attempt["id"], mcq["id"], [elsewhere], expect=422)

    assert body["error"]["code"] == "validation_error"


def test_a_single_answer_question_refuses_two_selections(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")

    save(
        client,
        headers,
        attempt["id"],
        mcq["id"],
        [mcq["options"][0]["id"], mcq["options"][1]["id"]],
        expect=422,
    )


def test_a_question_from_another_exam_cannot_be_answered(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    other = published_assessment(client, admin_headers(helpers))
    foreign_question = other["questions"][0]
    foreign_option = foreign_question["options"][0]["id"]

    save(client, headers, attempt["id"], foreign_question["id"], [foreign_option], expect=404)


def test_an_unknown_question_is_not_found(client, helpers: Helpers, users):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    save(client, headers, attempt["id"], str(uuid.uuid4()), [], expect=404)


# -- the Phase 3A boundary --------------------------------------------------------------------------


def test_the_attempt_itself_never_carries_a_score(client, helpers: Helpers, users):
    """Scores live on the result (Phase 3C, `tests/test_evaluation.py`), never on the paper the
    candidate is still working on."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = client.get(f"{ME}/attempts/{attempt['id']}", headers=headers).json()

    assert not {"score", "percentage", "passed", "result", "marks_obtained"} & set(body)


def test_a_new_attempt_starts_in_progress():
    """The state an attempt begins in. The full lifecycle is asserted in test_exam_session.py."""
    assert AttemptStatus.IN_PROGRESS in AttemptStatus


def test_candidate_password_still_signs_in(client, helpers: Helpers, users):
    """Cheap regression guard: Phase 3A touched the candidates router."""
    assert helpers.login_candidate("candidate@test.local", CANDIDATE_PASSWORD).status_code == 200

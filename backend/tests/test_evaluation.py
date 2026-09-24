"""Phase 3C: scoring a finished attempt, and who may see the result.

The scoring rules are exercised directly against `score_attempt` where that is clearest — it is
pure arithmetic over questions and answers — and through the API where the point is authorization
or state. The two most important assertions in the file are that a candidate never receives an
answer key, and that no request can supply a score.
"""

import uuid
from decimal import Decimal

import pytest

from app.core.errors import Conflict
from app.models.assessment import Assessment
from app.models.attempt import AttemptStatus
from app.models.base import utcnow
from app.models.result import AttemptResult
from app.services.evaluation import AnswerOutcome, EvaluationService, percentage_of
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, assign, assigned_exam, question_of, save, start
from tests.test_exam_session import attempt_row, submit, wind_clock_past_deadline
from tests.test_publishing import create_candidate

# `assigned_exam` builds MCQ (2 marks) + MULTIPLE_SELECT (3) + TRUE_FALSE (1) = 6, passing 3.
MAX_MARKS = 6
PASSING_MARKS = 3


def show_results(db, exam: dict, released: bool = True) -> None:
    """Assessments default to withholding results; most tests here want them shown."""
    db.get(Assessment, uuid.UUID(exam["id"])).show_results = released
    db.flush()


def answer_correctly(client, headers, attempt: dict, question_type: str) -> None:
    """Selects exactly the correct option set, read from the admin-visible answer key."""
    question = question_of(attempt, question_type)
    correct = [o["id"] for o in question["options"] if o["id"] in _correct_ids(question)]
    save(client, headers, attempt["id"], question["id"], correct)


def _correct_ids(question: dict) -> set[str]:
    """The tests know the fixtures' answer keys by position (see tests/test_questions.py)."""
    keys = {"MCQ": [1], "MULTIPLE_SELECT": [0, 2], "TRUE_FALSE": [0]}
    return {question["options"][i]["id"] for i in keys[question["type"]]}


def result_of(client, headers, attempt_id: str, expect: int = 200):
    response = client.get(f"{ME}/attempts/{attempt_id}/result", headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def full_marks_attempt(client, helpers, users, db) -> tuple[dict, dict, dict]:
    """An exam answered perfectly and submitted. Returns (exam, attempt, headers)."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    for question_type in ("MCQ", "MULTIPLE_SELECT", "TRUE_FALSE"):
        answer_correctly(client, headers, attempt, question_type)
    submit(client, headers, attempt["id"])
    return exam, attempt, headers


# -- the arithmetic -------------------------------------------------------------------------------


def test_percentage_is_exact_to_two_places():
    assert percentage_of(7, 8) == Decimal("87.50")
    assert percentage_of(1, 3) == Decimal("33.33")
    assert percentage_of(6, 6) == Decimal("100.00")
    assert percentage_of(0, 6) == Decimal("0.00")


def test_percentage_of_an_empty_paper_is_zero_not_a_crash():
    """An assessment whose questions were all deleted still has to produce a result."""
    assert percentage_of(0, 0) == Decimal("0.00")


# -- scoring each type ----------------------------------------------------------------------------


def test_every_question_answered_correctly_scores_full_marks(client, helpers: Helpers, users, db):
    _, attempt, headers = full_marks_attempt(client, helpers, users, db)

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == MAX_MARKS
    assert body["maximum_score"] == MAX_MARKS
    assert Decimal(body["percentage"]) == Decimal("100.00")
    assert body["passed"] is True
    assert (body["correct_count"], body["incorrect_count"], body["unanswered_count"]) == (3, 0, 0)


def test_an_mcq_answered_wrongly_scores_nothing_for_that_question(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    wrong = next(o["id"] for o in mcq["options"] if o["id"] not in _correct_ids(mcq))
    save(client, headers, attempt["id"], mcq["id"], [wrong])
    answer_correctly(client, headers, attempt, "TRUE_FALSE")
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    # 1 of 6: the true/false mark only. No partial credit for the MCQ, no negative marking.
    assert body["score"] == 1
    assert (body["correct_count"], body["incorrect_count"], body["unanswered_count"]) == (1, 1, 1)


def test_multiple_select_needs_the_exact_set(client, helpers: Helpers, users, db):
    """Missing one option and adding one extra are both simply incorrect."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)

    attempt = start(client, headers, exam["id"])
    question = question_of(attempt, "MULTIPLE_SELECT")
    correct = sorted(_correct_ids(question))

    # One of the two correct options only.
    save(client, headers, attempt["id"], question["id"], [correct[0]])
    submit(client, headers, attempt["id"])
    partial = result_of(client, headers, attempt["id"])
    assert partial["score"] == 0
    assert partial["incorrect_count"] == 1


def test_multiple_select_with_an_extra_option_is_incorrect(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    question = question_of(attempt, "MULTIPLE_SELECT")
    everything = [o["id"] for o in question["options"]]
    save(client, headers, attempt["id"], question["id"], everything)
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == 0
    assert body["incorrect_count"] == 1


def test_an_untouched_paper_scores_zero_and_counts_as_unanswered(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == 0
    assert body["maximum_score"] == MAX_MARKS
    assert Decimal(body["percentage"]) == Decimal("0.00")
    assert body["passed"] is False
    assert (body["correct_count"], body["incorrect_count"], body["unanswered_count"]) == (0, 0, 3)


def test_an_answer_that_was_cleared_counts_as_unanswered(client, helpers: Helpers, users, db):
    """ "Answered then cleared" is not a wrong answer."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], [mcq["options"][0]["id"]])
    save(client, headers, attempt["id"], mcq["id"], [])  # cleared
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["unanswered_count"] == 3
    assert body["incorrect_count"] == 0


def test_question_marks_are_respected_rather_than_counted(client, helpers: Helpers, users, db):
    """Questions are worth 2, 3 and 1 — a score must not be a count of questions."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MULTIPLE_SELECT")  # the 3-mark question alone
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == 3
    assert body["maximum_score"] == 6
    assert Decimal(body["percentage"]) == Decimal("50.00")
    assert body["correct_count"] == 1


# -- pass and fail -----------------------------------------------------------------------------------


def test_exactly_the_passing_mark_passes(client, helpers: Helpers, users, db):
    """Passing marks are 3 and the multiple-select question is worth exactly 3."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MULTIPLE_SELECT")
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == PASSING_MARKS
    assert body["passed"] is True


def test_one_mark_short_fails(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")  # 2 of the 3 needed
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == 2
    assert body["passed"] is False


def test_pass_is_decided_on_marks_not_on_the_rounded_percentage(client, helpers: Helpers, users, db):
    """A displayed percentage must never round a candidate over the line."""
    exam = assigned_exam(client, helpers, users)
    db.get(Assessment, uuid.UUID(exam["id"])).passing_marks = 3
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")  # 2/6 = 33.33%
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert Decimal(body["percentage"]) == Decimal("33.33")
    assert body["passed"] is False


def test_the_result_records_the_threshold_it_was_judged_against(client, helpers: Helpers, users, db):
    _, attempt, _ = full_marks_attempt(client, helpers, users, db)

    row = db.query(AttemptResult).filter_by(attempt_id=uuid.UUID(attempt["id"])).one()

    assert row.passing_marks == PASSING_MARKS


# -- when evaluation happens ---------------------------------------------------------------------------


def test_submitting_evaluates_the_attempt_in_the_same_breath(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    submit(client, headers, attempt["id"])

    # The row exists the moment the attempt is submitted, with no second request.
    assert db.query(AttemptResult).filter_by(attempt_id=uuid.UUID(attempt["id"])).count() == 1


def test_running_out_of_time_evaluates_the_attempt_too(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")
    wind_clock_past_deadline(db, attempt)

    body = result_of(client, headers, attempt["id"])  # the read settles and evaluates

    assert body["attempt_status"] == AttemptStatus.TIME_EXPIRED
    assert body["score"] == 2  # scored from the answers saved before the deadline
    assert attempt_row(db, attempt).status is AttemptStatus.TIME_EXPIRED


def test_an_attempt_still_running_has_no_result(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    body = result_of(client, headers, attempt["id"], expect=409)

    assert body["error"]["code"] == "conflict"
    assert db.query(AttemptResult).filter_by(attempt_id=uuid.UUID(attempt["id"])).count() == 0


def test_the_service_refuses_to_evaluate_a_running_attempt(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    row = attempt_row(db, attempt)

    with pytest.raises(Conflict):
        EvaluationService(db).ensure_result(row)


# -- idempotency ------------------------------------------------------------------------------------


def test_evaluating_twice_returns_the_same_result(client, helpers: Helpers, users, db):
    _, attempt, headers = full_marks_attempt(client, helpers, users, db)
    row = attempt_row(db, attempt)
    service = EvaluationService(db)

    first = service.ensure_result(row)
    second = service.ensure_result(row)

    assert first.id == second.id
    assert first.evaluated_at == second.evaluated_at  # not re-stamped
    assert db.query(AttemptResult).filter_by(attempt_id=row.id).count() == 1


def test_reading_the_result_repeatedly_does_not_create_more(client, helpers: Helpers, users, db):
    _, attempt, headers = full_marks_attempt(client, helpers, users, db)

    for _ in range(3):
        result_of(client, headers, attempt["id"])

    assert db.query(AttemptResult).filter_by(attempt_id=uuid.UUID(attempt["id"])).count() == 1


def test_a_second_result_row_is_impossible_even_below_the_database(client, helpers: Helpers, users, db):
    from sqlalchemy.exc import IntegrityError

    _, attempt, _ = full_marks_attempt(client, helpers, users, db)
    row = attempt_row(db, attempt)

    db.add(
        AttemptResult(
            attempt_id=row.id,
            candidate_id=row.candidate_id,
            assessment_id=row.assessment_id,
            score=0,
            maximum_score=6,
            percentage=Decimal("0.00"),
            passing_marks=3,
            passed=False,
            correct_count=0,
            incorrect_count=0,
            unanswered_count=3,
            evaluated_at=utcnow(),
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_an_existing_result_is_not_recalculated_when_the_answer_key_changes(
    client, helpers: Helpers, users, db
):
    """A published assessment is still editable (see the Phase 3C report). A stored result must
    not silently change underneath a candidate who has already been told it."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")
    submit(client, headers, attempt["id"])
    before = result_of(client, headers, attempt["id"])["score"]

    # Flip the MCQ's key through the admin API.
    mcq = question_of(attempt, "MCQ")
    admin = admin_headers(helpers)
    flipped = [{"text": o["text"], "is_correct": o["id"] not in _correct_ids(mcq)} for o in mcq["options"]]
    client.patch(
        f"/api/v1/assessments/{exam['id']}/questions/{mcq['id']}",
        json={"type": "MCQ", "options": flipped},
        headers=admin,
    )

    assert result_of(client, headers, attempt["id"])["score"] == before


# -- what the candidate is allowed to see ---------------------------------------------------------------


def test_the_result_never_carries_an_answer_key(client, helpers: Helpers, users, db):
    """The most important assertion in Phase 3C."""
    _, attempt, headers = full_marks_attempt(client, helpers, users, db)

    response = client.get(f"{ME}/attempts/{attempt['id']}/result", headers=headers)

    assert "is_correct" not in response.text
    assert "explanation" not in response.text
    assert "correct_answer" not in response.text
    for question in response.json()["questions"]:
        assert set(question) == {"position", "marks", "marks_awarded", "outcome"}


def test_the_breakdown_says_how_each_question_went_without_saying_what_was_right(
    client, helpers: Helpers, users, db
):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")
    mcq_wrong = question_of(attempt, "MULTIPLE_SELECT")
    save(client, headers, attempt["id"], mcq_wrong["id"], [mcq_wrong["options"][1]["id"]])
    submit(client, headers, attempt["id"])

    questions = result_of(client, headers, attempt["id"])["questions"]

    assert [q["position"] for q in questions] == [0, 1, 2]
    assert [q["outcome"] for q in questions] == [
        AnswerOutcome.CORRECT,
        AnswerOutcome.INCORRECT,
        AnswerOutcome.UNANSWERED,
    ]
    assert [q["marks"] for q in questions] == [2, 3, 1]
    assert [q["marks_awarded"] for q in questions] == [2, 0, 0]


def test_a_result_is_withheld_when_the_assessment_says_so(client, helpers: Helpers, users, db):
    """`show_results` is off by default; the attempt is still evaluated and stored."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam, released=False)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["released"] is False
    # Null, not zero: a withheld result must never look like a failed one.
    assert body["score"] is None
    assert body["percentage"] is None
    assert body["passed"] is None
    assert body["questions"] == []
    # The administrator can still see it, and the row exists.
    stored = db.query(AttemptResult).filter_by(attempt_id=uuid.UUID(attempt["id"])).one()
    assert stored.score == 2


def test_the_results_list_shows_only_released_results(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam, released=False)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    submit(client, headers, attempt["id"])

    assert client.get(f"{ME}/results", headers=headers).json() == []

    show_results(db, exam, released=True)
    listed = client.get(f"{ME}/results", headers=headers).json()
    assert len(listed) == 1
    assert listed[0]["attempt_id"] == attempt["id"]


# -- authorization ---------------------------------------------------------------------------------------


def test_a_candidate_cannot_read_another_candidates_result(client, helpers: Helpers, users, db):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    admin = admin_headers(helpers)
    owner = candidate_headers(helpers)
    attempt = start(client, owner, exam["id"])
    submit(client, owner, attempt["id"])

    other = create_candidate(
        client, admin, email="peeker@demo.local", roll_number="D6", initial_password="Peeker-pass-1"
    )
    assign(client, admin, exam["id"], other["id"])
    intruder = helpers.bearer(helpers.token_for_candidate("peeker@demo.local", "Peeker-pass-1", "D6"))

    # Not found, not forbidden: the attempt's existence is not disclosed.
    assert client.get(f"{ME}/attempts/{attempt['id']}/result", headers=intruder).status_code == 404
    assert client.get(f"{ME}/results", headers=intruder).json() == []


def test_the_result_routes_reject_anonymous_and_admin_callers(client, helpers: Helpers, users, db):
    _, attempt, _ = full_marks_attempt(client, helpers, users, db)

    assert client.get(f"{ME}/attempts/{attempt['id']}/result").status_code == 401
    assert client.get(f"{ME}/results").status_code == 401

    admin = admin_headers(helpers)
    assert client.get(f"{ME}/attempts/{attempt['id']}/result", headers=admin).status_code == 403
    assert client.get(f"{ME}/results", headers=admin).status_code == 403


def test_an_unknown_attempt_has_no_result(client, helpers: Helpers, users):
    assert (
        client.get(f"{ME}/attempts/{uuid.uuid4()}/result", headers=candidate_headers(helpers)).status_code
        == 404
    )


# -- the administrator's table -------------------------------------------------------------------------------


def test_an_admin_sees_every_result_for_an_assessment(client, helpers: Helpers, users, db):
    exam, attempt, _ = full_marks_attempt(client, helpers, users, db)

    body = client.get(f"/api/v1/assessments/{exam['id']}/results", headers=admin_headers(helpers)).json()

    assert body["assessment_title"] == exam["title"]
    assert body["total_marks"] == MAX_MARKS
    assert body["passing_marks"] == PASSING_MARKS
    assert len(body["results"]) == 1
    row = body["results"][0]
    assert row["candidate_email"] == "candidate@test.local"
    assert row["score"] == MAX_MARKS
    assert row["passed"] is True
    assert row["attempt_status"] == AttemptStatus.SUBMITTED


def test_the_admin_table_shows_a_withheld_result(client, helpers: Helpers, users, db):
    """Withholding is a candidate-facing decision, not an administrative one."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam, released=False)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")
    submit(client, headers, attempt["id"])

    body = client.get(f"/api/v1/assessments/{exam['id']}/results", headers=admin_headers(helpers)).json()

    assert body["results"][0]["score"] == 2


def test_the_admin_table_evaluates_attempts_that_were_never_scored(client, helpers: Helpers, users, db):
    """Attempts finished before Phase 3C existed have no result row; reading the table creates it."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    answer_correctly(client, headers, attempt, "MCQ")
    submit(client, headers, attempt["id"])
    # Simulate the pre-3C state by deleting the result the submission created.
    db.query(AttemptResult).filter_by(attempt_id=uuid.UUID(attempt["id"])).delete()
    db.flush()

    body = client.get(f"/api/v1/assessments/{exam['id']}/results", headers=admin_headers(helpers)).json()

    assert len(body["results"]) == 1
    assert body["results"][0]["score"] == 2


def test_a_candidate_cannot_read_the_admin_results_table(client, helpers: Helpers, users, db):
    exam, _, _ = full_marks_attempt(client, helpers, users, db)

    response = client.get(f"/api/v1/assessments/{exam['id']}/results", headers=candidate_headers(helpers))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_results_for_an_unknown_assessment_are_not_found(client, helpers: Helpers, users):
    response = client.get(f"/api/v1/assessments/{uuid.uuid4()}/results", headers=admin_headers(helpers))

    assert response.status_code == 404


# -- the client cannot score itself ----------------------------------------------------------


def test_a_candidate_cannot_submit_a_score(client, helpers: Helpers, users, db):
    """No request shape accepts a score; sending one changes nothing."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    forged = client.post(
        f"{ME}/attempts/{attempt['id']}/submit",
        json={"score": 6, "maximum_score": 6, "percentage": 100, "passed": True},
        headers=headers,
    )

    assert forged.status_code == 200
    body = result_of(client, headers, attempt["id"])
    assert body["score"] == 0  # nothing was answered
    assert body["passed"] is False


def test_a_candidate_cannot_answer_after_finalization_to_improve_a_result(
    client, helpers: Helpers, users, db
):
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    submit(client, headers, attempt["id"])

    mcq = question_of(attempt, "MCQ")
    save(client, headers, attempt["id"], mcq["id"], sorted(_correct_ids(mcq)), expect=409)

    assert result_of(client, headers, attempt["id"])["score"] == 0


# -- marks cannot be edited by anyone ----------------------------------------------------------


def test_a_result_has_no_write_endpoint_at_all(client, helpers: Helpers, users, db):
    """Marks are not editable. There is no route to change them, for a candidate or an admin —
    a score is only ever produced by evaluating stored answers."""
    exam, attempt, candidate = full_marks_attempt(client, helpers, users, db)
    admin = admin_headers(helpers)

    paths = [
        f"{ME}/attempts/{attempt['id']}/result",
        f"{ME}/results",
        f"/api/v1/assessments/{exam['id']}/results",
    ]
    forged = {"score": 99, "maximum_score": 99, "percentage": 100, "passed": True}

    for headers in (candidate, admin):
        for path in paths:
            for verb in ("POST", "PUT", "PATCH", "DELETE"):
                # DELETE carries no body, so `json` is omitted rather than passed as None.
                body = {} if verb == "DELETE" else {"json": forged}
                response = client.request(verb, path, headers=headers, **body)
                # 405 where a GET route exists, 404 where nothing does — never a successful write.
                assert response.status_code in (404, 405), f"{verb} {path} -> {response.status_code}"

    # And the stored marks are untouched.
    assert result_of(client, candidate, attempt["id"])["score"] == MAX_MARKS


def test_an_admin_cannot_rewrite_marks_through_the_assessment_api(client, helpers: Helpers, users, db):
    """Editing the assessment changes future evaluations, never an existing result."""
    exam, attempt, candidate = full_marks_attempt(client, helpers, users, db)
    admin = admin_headers(helpers)
    before = result_of(client, candidate, attempt["id"])

    # Re-weight every question and halve the pass mark.
    detail = client.get(f"/api/v1/assessments/{exam['id']}", headers=admin).json()
    for question in detail["questions"]:
        client.patch(
            f"/api/v1/assessments/{exam['id']}/questions/{question['id']}",
            json={"marks": 50},
            headers=admin,
        )
    client.patch(f"/api/v1/assessments/{exam['id']}", json={"passing_marks": 1}, headers=admin)

    after = result_of(client, candidate, attempt["id"])
    assert after["score"] == before["score"]
    assert after["maximum_score"] == before["maximum_score"]
    assert after["percentage"] == before["percentage"]
    assert after["passed"] == before["passed"]


def test_a_candidate_cannot_edit_the_paper_at_any_point(client, helpers: Helpers, users, db):
    """Authoring is admin-only throughout, during an attempt and after it."""
    exam = assigned_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    question = question_of(attempt, "MCQ")

    writes = [
        client.post(
            "/api/v1/assessments",
            json={"title": "Mine", "duration_minutes": 10, "total_marks": 1, "passing_marks": 1},
            headers=headers,
        ),
        client.patch(f"/api/v1/assessments/{exam['id']}", json={"total_marks": 999}, headers=headers),
        client.delete(f"/api/v1/assessments/{exam['id']}", headers=headers),
        client.patch(
            f"/api/v1/assessments/{exam['id']}/questions/{question['id']}",
            json={"marks": 99},
            headers=headers,
        ),
        client.delete(f"/api/v1/assessments/{exam['id']}/questions/{question['id']}", headers=headers),
    ]
    for response in writes:
        assert response.status_code == 403, response.text


# -- the Phase 3C boundary -------------------------------------------------------------------


def test_nothing_from_phase_4_has_appeared(client, helpers: Helpers, users, db):
    _, attempt, headers = full_marks_attempt(client, helpers, users, db)

    body = result_of(client, headers, attempt["id"])

    assert not {"risk_score", "risk_level", "proctoring_events", "evidence", "integrity_score"} & set(body)


def test_an_attempt_with_no_questions_left_still_evaluates(client, helpers: Helpers, users, db):
    """A published assessment can still have its questions deleted, so evaluation has to cope."""
    exam = assigned_exam(client, helpers, users)
    show_results(db, exam)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    admin = admin_headers(helpers)
    for question in attempt["questions"]:
        client.delete(f"/api/v1/assessments/{exam['id']}/questions/{question['id']}", headers=admin)
    submit(client, headers, attempt["id"])

    body = result_of(client, headers, attempt["id"])

    assert body["score"] == 0
    assert body["maximum_score"] == 0
    assert Decimal(body["percentage"]) == Decimal("0.00")

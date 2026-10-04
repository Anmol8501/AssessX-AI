"""Coding assessments, stage C1: assessment types, coding questions, and the question lock.

What is asserted: existing behaviour is unchanged (an assessment is MCQ unless told otherwise); the server
refuses coding questions in an MCQ assessment and multiple-choice questions in a coding one, however they
arrive (the question route, the type change, readiness); a mixed assessment holds both in the order the
administrator sets; a coding question pins a published version, appears once per assessment, takes its
marks from the version unless given, and only its marks can be edited; it can move to another published
version of the same problem; publishing an assessment with coding questions is refused until the code
runner is enabled, and allowed once it is; once any attempt exists, an assessment's questions and type are
locked (409 `assessment_in_use`); a problem pinned by an assessment cannot be deleted.
"""

import pytest

from app.core.config import get_settings
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers, create_assessment
from tests.test_attempts import assigned_exam, start
from tests.test_coding_problems import BASE as CODING
from tests.test_coding_problems import call, published
from tests.test_questions import MCQ, TRUE_FALSE, add_question

A = "/api/v1/assessments"


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


def add_coding(client, admin, assessment_id: str, version_id: str, expect: int = 201, **extra):
    return call(
        client,
        "POST",
        f"{A}/{assessment_id}/coding-questions",
        admin,
        expect,
        {"problem_version_id": version_id, **extra},
    )


def readiness_messages(client, admin, assessment_id: str) -> list[str]:
    return [
        i["message"] for i in call(client, "GET", f"{A}/{assessment_id}", admin, 200)["readiness"]["issues"]
    ]


def test_assessments_are_mcq_unless_told_otherwise(client, admin):
    assert create_assessment(client, admin)["assessment_type"] == "MCQ"
    assert create_assessment(client, admin, assessment_type="CODING")["assessment_type"] == "CODING"
    call(
        client,
        "POST",
        A,
        admin,
        422,
        {
            "title": "Bad type",
            "duration_minutes": 30,
            "total_marks": 10,
            "passing_marks": 5,
            "assessment_type": "ESSAY",
        },
    )


def test_the_server_enforces_which_questions_each_type_allows(client, admin):
    _, version = published(client, admin)
    mcq_only = create_assessment(client, admin)
    coding_only = create_assessment(client, admin, assessment_type="CODING")
    mixed = create_assessment(client, admin, assessment_type="MIXED")

    add_question(client, admin, mcq_only["id"], MCQ)
    error = add_coding(client, admin, mcq_only["id"], version, expect=422)
    assert "can't add coding questions to an MCQ-only assessment" in error["error"]["message"]

    add_coding(client, admin, coding_only["id"], version)
    error = add_question(client, admin, coding_only["id"], MCQ, expect=422)
    assert "multiple-choice" in error["error"]["message"]
    add_question(client, admin, coding_only["id"], TRUE_FALSE, expect=422)

    add_question(client, admin, mixed["id"], MCQ)
    add_coding(client, admin, mixed["id"], version)
    # The MCQ route never creates a coding question, whatever the client sends.
    add_question(client, admin, mixed["id"], {**MCQ, "type": "CODING"}, expect=422)


def test_a_mixed_assessment_keeps_the_administrators_order(client, admin):
    _, v1 = published(client, admin, title="Problem One")
    _, v2 = published(client, admin, title="Problem Two")
    mixed = create_assessment(client, admin, assessment_type="MIXED")
    q1 = add_question(client, admin, mixed["id"], MCQ)
    c1 = add_coding(client, admin, mixed["id"], v1)
    q2 = add_question(client, admin, mixed["id"], TRUE_FALSE)
    c2 = add_coding(client, admin, mixed["id"], v2)
    order = [c2["id"], q1["id"], c1["id"], q2["id"]]
    call(client, "POST", f"{A}/{mixed['id']}/questions/reorder", admin, 200, {"question_ids": order})
    questions = call(client, "GET", f"{A}/{mixed['id']}", admin, 200)["questions"]
    assert [q["id"] for q in questions] == order and [q["position"] for q in questions] == [0, 1, 2, 3]
    assert [q["type"] for q in questions] == ["CODING", "MCQ", "CODING", "TRUE_FALSE"]
    assert questions[0]["coding_version"]["title"] == "Problem Two" and questions[0]["options"] == []


def test_coding_questions_pin_a_published_version_once_with_its_marks(client, admin):
    problem, version = published(client, admin)
    coding = create_assessment(client, admin, assessment_type="CODING")
    question = add_coding(client, admin, coding["id"], version)
    assert (
        question["type"] == "CODING" and question["marks"] == 10 and question["text"] == "Sum of Two Numbers"
    )
    assert question["coding_version"]["version"] == 1 and question["coding_version"]["languages"] == [
        "python",
        "c",
        "cpp",
        "java",
    ]
    add_coding(client, admin, coding["id"], version, expect=422)  # once per assessment
    other = create_assessment(client, admin, assessment_type="CODING")
    assert add_coding(client, admin, other["id"], version, marks=25)["marks"] == 25

    draft = call(client, "POST", f"{CODING}/{problem['id']}/versions", admin, 201)
    add_coding(
        client,
        admin,
        create_assessment(client, admin, assessment_type="CODING")["id"],
        draft["id"],
        expect=422,
    )
    call(client, "PATCH", f"{CODING}/{problem['id']}", admin, 200, {"is_enabled": False})
    add_coding(
        client, admin, create_assessment(client, admin, assessment_type="CODING")["id"], version, expect=422
    )

    path = f"{A}/{coding['id']}/questions/{question['id']}"
    call(client, "PATCH", path, admin, 200, {"marks": 15})
    call(client, "PATCH", path, admin, 422, {"text": "Renamed"})
    call(client, "POST", f"{path}/duplicate", admin, 422)


def test_a_coding_question_moves_only_to_another_published_version_of_its_problem(client, admin):
    problem, v1 = published(client, admin)
    _, unrelated = published(client, admin, title="Another Problem")
    coding = create_assessment(client, admin, assessment_type="CODING")
    question = add_coding(client, admin, coding["id"], v1)
    draft = call(client, "POST", f"{CODING}/{problem['id']}/versions", admin, 201)
    call(
        client,
        "PATCH",
        f"{CODING}/{problem['id']}/versions/{draft['id']}",
        admin,
        200,
        {"title": "Sum of Two Numbers (v2)"},
    )
    path = f"{A}/{coding['id']}/questions/{question['id']}/coding-version"
    call(client, "POST", path, admin, 422, {"problem_version_id": draft["id"]})  # not published yet
    call(client, "POST", f"{CODING}/{problem['id']}/versions/{draft['id']}/publish", admin, 200)
    moved = call(client, "POST", path, admin, 200, {"problem_version_id": draft["id"]})
    assert moved["coding_version"]["version"] == 2 and moved["text"] == "Sum of Two Numbers (v2)"
    call(client, "POST", path, admin, 422, {"problem_version_id": unrelated})


def test_changing_the_type_is_refused_while_questions_would_break_it(client, admin):
    _, version = published(client, admin)
    mixed = create_assessment(client, admin, assessment_type="MIXED")
    add_question(client, admin, mixed["id"], MCQ)
    add_coding(client, admin, mixed["id"], version)
    error = call(client, "PATCH", f"{A}/{mixed['id']}", admin, 422, {"assessment_type": "MCQ"})
    assert "Remove the coding questions" in error["error"]["message"]
    call(client, "PATCH", f"{A}/{mixed['id']}", admin, 422, {"assessment_type": "CODING"})
    mcq = create_assessment(client, admin)
    add_question(client, admin, mcq["id"], MCQ)
    assert (
        call(client, "PATCH", f"{A}/{mcq['id']}", admin, 200, {"assessment_type": "MIXED"})["assessment_type"]
        == "MIXED"
    )


def test_publishing_coding_questions_waits_for_the_runner(client, admin, monkeypatch):
    _, version = published(client, admin)
    coding = create_assessment(client, admin, assessment_type="CODING", total_marks=10, passing_marks=5)
    add_coding(client, admin, coding["id"], version)
    assert any(
        "code runner has not been set up" in m for m in readiness_messages(client, admin, coding["id"])
    )
    call(client, "POST", f"{A}/{coding['id']}/ready", admin, 422)

    monkeypatch.setattr(get_settings(), "coding_execution_enabled", True)
    assert readiness_messages(client, admin, coding["id"]) == []
    assert call(client, "POST", f"{A}/{coding['id']}/ready", admin, 200)["status"] == "READY"


def test_questions_and_type_lock_once_an_attempt_exists(client, helpers: Helpers, users, admin):
    exam = assigned_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    question = attempt["questions"][0]["id"]
    path = f"{A}/{exam['id']}"
    for method, url, body in [
        ("POST", f"{path}/questions", MCQ),
        ("PATCH", f"{path}/questions/{question}", {"marks": 5}),
        ("DELETE", f"{path}/questions/{question}", None),
        ("POST", f"{path}/questions/{question}/duplicate", None),
        (
            "POST",
            f"{path}/questions/reorder",
            {"question_ids": [q["id"] for q in reversed(attempt["questions"])]},
        ),
        ("PATCH", path, {"assessment_type": "MIXED"}),
    ]:
        response = client.request(method, url, json=body, headers=admin)
        assert response.status_code == 409, (method, url, response.text)
        assert response.json()["error"]["code"] == "assessment_in_use"
    # Other settings (and the description) can still change.
    call(client, "PATCH", path, admin, 200, {"description": "Updated after attempts began."})


def test_a_problem_pinned_by_an_assessment_cannot_be_deleted(client, admin):
    problem, version = published(client, admin)
    add_coding(client, admin, create_assessment(client, admin, assessment_type="CODING")["id"], version)
    assert call(client, "DELETE", f"{CODING}/{problem['id']}", admin, 409)["error"]["code"] == "conflict"
    assert call(client, "GET", CODING, admin, 200)[0]["used_in"] == 1


def test_candidates_cannot_add_coding_questions(client, helpers: Helpers, admin):
    _, version = published(client, admin)
    coding = create_assessment(client, admin, assessment_type="CODING")
    response = client.post(
        f"{A}/{coding['id']}/coding-questions",
        json={"problem_version_id": version},
        headers=candidate_headers(helpers),
    )
    assert response.status_code == 403

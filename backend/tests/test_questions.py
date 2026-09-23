"""Phase 2A: question authoring — the three types, per-type validation, scoping, authorization."""

import uuid

from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers, create_assessment

MCQ = {
    "type": "MCQ",
    "text": "What is the time complexity of binary search?",
    "marks": 2,
    "options": [
        {"text": "O(n)", "is_correct": False},
        {"text": "O(log n)", "is_correct": True},
        {"text": "O(n^2)", "is_correct": False},
        {"text": "O(1)", "is_correct": False},
    ],
}
MULTIPLE_SELECT = {
    "type": "MULTIPLE_SELECT",
    "text": "Which are sorting algorithms?",
    "marks": 3,
    "options": [
        {"text": "Merge Sort", "is_correct": True},
        {"text": "Binary Search", "is_correct": False},
        {"text": "Quick Sort", "is_correct": True},
        {"text": "BFS", "is_correct": False},
    ],
}
TRUE_FALSE = {
    "type": "TRUE_FALSE",
    "text": "A stack follows LIFO.",
    "marks": 1,
    "options": [{"text": "True", "is_correct": True}, {"text": "False", "is_correct": False}],
}


def add_question(client, headers, assessment_id: str, payload: dict, expect: int = 201):
    response = client.post(f"/api/v1/assessments/{assessment_id}/questions", json=payload, headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


# -- creation per type ---------------------------------------------------------------------------


def test_admin_can_create_an_mcq(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    body = add_question(client, headers, assessment["id"], MCQ)

    assert body["type"] == "MCQ"
    assert body["marks"] == 2
    assert body["position"] == 0
    assert [o["text"] for o in body["options"]] == ["O(n)", "O(log n)", "O(n^2)", "O(1)"]
    assert [o["is_correct"] for o in body["options"]] == [False, True, False, False]


def test_admin_can_create_a_multiple_select_question(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    body = add_question(client, headers, assessment["id"], MULTIPLE_SELECT)

    assert body["type"] == "MULTIPLE_SELECT"
    assert sum(o["is_correct"] for o in body["options"]) == 2


def test_admin_can_create_a_true_false_question(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    body = add_question(client, headers, assessment["id"], TRUE_FALSE)

    assert body["type"] == "TRUE_FALSE"
    assert [o["text"] for o in body["options"]] == ["True", "False"]


def test_questions_get_sequential_positions_and_are_listed_in_order(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    for payload in (MCQ, MULTIPLE_SELECT, TRUE_FALSE):
        add_question(client, headers, assessment["id"], payload)

    listed = client.get(f"/api/v1/assessments/{assessment['id']}/questions", headers=headers).json()
    assert [q["position"] for q in listed] == [0, 1, 2]
    assert [q["type"] for q in listed] == ["MCQ", "MULTIPLE_SELECT", "TRUE_FALSE"]


def test_assessment_detail_reports_question_count_and_allocated_marks(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    add_question(client, headers, assessment["id"], MCQ)  # 2 marks
    add_question(client, headers, assessment["id"], TRUE_FALSE)  # 1 mark

    detail = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()

    assert detail["question_count"] == 2
    assert detail["allocated_marks"] == 3
    assert detail["total_marks"] == 50  # configured separately; 2B reconciles the two


# -- type-specific validation --------------------------------------------------------------------


def test_mcq_requires_exactly_one_correct_answer(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    two_correct = {**MCQ, "options": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}]}
    none_correct = {
        **MCQ,
        "options": [{"text": "A", "is_correct": False}, {"text": "B", "is_correct": False}],
    }

    for payload in (two_correct, none_correct):
        response = client.post(
            f"/api/v1/assessments/{assessment['id']}/questions", json=payload, headers=headers
        )
        assert response.status_code == 422
        assert "exactly one correct answer" in response.text


def test_multiple_select_requires_at_least_one_correct_answer(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    payload = {
        **MULTIPLE_SELECT,
        "options": [{"text": "A", "is_correct": False}, {"text": "B", "is_correct": False}],
    }
    response = client.post(f"/api/v1/assessments/{assessment['id']}/questions", json=payload, headers=headers)

    assert response.status_code == 422
    assert "at least one correct answer" in response.text


def test_multiple_select_accepts_all_options_correct(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    payload = {
        **MULTIPLE_SELECT,
        "options": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}],
    }
    assert add_question(client, headers, assessment["id"], payload)["type"] == "MULTIPLE_SELECT"


def test_true_false_must_have_exactly_true_and_false_options(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    wrong_labels = {**TRUE_FALSE, "options": [{"text": "Yes", "is_correct": True}, {"text": "No"}]}
    response = client.post(
        f"/api/v1/assessments/{assessment['id']}/questions", json=wrong_labels, headers=headers
    )

    assert response.status_code == 422
    assert "True and False" in response.text


def test_question_requires_text_options_and_positive_marks(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    for payload, field in (
        ({**MCQ, "text": ""}, "text"),
        ({**MCQ, "marks": 0}, "marks"),
        ({**MCQ, "options": [{"text": "only one", "is_correct": True}]}, "options"),
    ):
        response = client.post(
            f"/api/v1/assessments/{assessment['id']}/questions", json=payload, headers=headers
        )
        assert response.status_code == 422, field
        assert field in response.text


def test_duplicate_option_text_is_rejected(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    payload = {
        **MCQ,
        "options": [{"text": "Same", "is_correct": True}, {"text": "same", "is_correct": False}],
    }
    response = client.post(f"/api/v1/assessments/{assessment['id']}/questions", json=payload, headers=headers)

    assert response.status_code == 422
    assert "distinct" in response.text


def test_unknown_question_type_is_rejected(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    response = client.post(
        f"/api/v1/assessments/{assessment['id']}/questions", json={**MCQ, "type": "CODING"}, headers=headers
    )

    assert response.status_code == 422


def test_question_cannot_be_attached_to_a_nonexistent_assessment(client, helpers: Helpers, users):
    response = client.post(
        f"/api/v1/assessments/{uuid.uuid4()}/questions", json=MCQ, headers=admin_headers(helpers)
    )

    assert response.status_code == 404


# -- update / delete -------------------------------------------------------------------------------


def test_admin_can_edit_a_question(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    question = add_question(client, headers, assessment["id"], MCQ)

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}/questions/{question['id']}",
        json={"text": "Updated question text", "marks": 5},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Updated question text"
    assert response.json()["marks"] == 5
    assert len(response.json()["options"]) == 4  # options untouched when not supplied


def test_editing_options_replaces_the_answer_key(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    question = add_question(client, headers, assessment["id"], MCQ)

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}/questions/{question['id']}",
        json={
            "type": "MCQ",
            "options": [{"text": "Alpha", "is_correct": False}, {"text": "Beta", "is_correct": True}],
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert [o["text"] for o in response.json()["options"]] == ["Alpha", "Beta"]
    assert [o["is_correct"] for o in response.json()["options"]] == [False, True]


def test_editing_options_is_revalidated_for_the_type(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    question = add_question(client, headers, assessment["id"], MCQ)

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}/questions/{question['id']}",
        json={
            "type": "MCQ",
            "options": [{"text": "Alpha", "is_correct": True}, {"text": "Beta", "is_correct": True}],
        },
        headers=headers,
    )

    assert response.status_code == 422


def test_changing_type_without_options_is_rejected(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    question = add_question(client, headers, assessment["id"], MCQ)

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}/questions/{question['id']}",
        json={"type": "TRUE_FALSE"},
        headers=headers,
    )

    assert response.status_code == 422
    assert "requires new options" in response.text


def test_admin_can_delete_a_question(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    question = add_question(client, headers, assessment["id"], MCQ)

    deleted = client.delete(
        f"/api/v1/assessments/{assessment['id']}/questions/{question['id']}", headers=headers
    )

    assert deleted.status_code == 204
    assert client.get(f"/api/v1/assessments/{assessment['id']}/questions", headers=headers).json() == []


# -- scoping and authorization ----------------------------------------------------------------------


def test_question_is_not_reachable_through_another_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    first = create_assessment(client, headers)
    second = create_assessment(client, headers, title="Another Assessment")
    question = add_question(client, headers, first["id"], MCQ)

    path = f"/api/v1/assessments/{second['id']}/questions/{question['id']}"
    assert client.get(path, headers=headers).status_code == 404
    assert client.patch(path, json={"marks": 9}, headers=headers).status_code == 404
    assert client.delete(path, headers=headers).status_code == 404
    # …and the question is untouched in its own assessment.
    assert (
        client.get(f"/api/v1/assessments/{first['id']}/questions/{question['id']}", headers=headers).json()[
            "marks"
        ]
        == 2
    )


def test_questions_are_listed_only_for_their_own_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    first = create_assessment(client, headers)
    second = create_assessment(client, headers, title="Another Assessment")
    add_question(client, headers, first["id"], MCQ)

    assert len(client.get(f"/api/v1/assessments/{first['id']}/questions", headers=headers).json()) == 1
    assert client.get(f"/api/v1/assessments/{second['id']}/questions", headers=headers).json() == []


def test_candidate_cannot_create_edit_or_delete_questions(client, helpers: Helpers, users):
    admin = admin_headers(helpers)
    assessment = create_assessment(client, admin)
    question = add_question(client, admin, assessment["id"], MCQ)
    headers = candidate_headers(helpers)

    base = f"/api/v1/assessments/{assessment['id']}/questions"
    assert client.get(base, headers=headers).status_code == 403
    assert client.post(base, json=TRUE_FALSE, headers=headers).status_code == 403
    assert client.patch(f"{base}/{question['id']}", json={"marks": 9}, headers=headers).status_code == 403
    assert client.delete(f"{base}/{question['id']}", headers=headers).status_code == 403


def test_unauthenticated_user_cannot_touch_questions(client, helpers: Helpers, users):
    assessment = create_assessment(client, admin_headers(helpers))

    assert client.get(f"/api/v1/assessments/{assessment['id']}/questions").status_code == 401
    assert client.post(f"/api/v1/assessments/{assessment['id']}/questions", json=MCQ).status_code == 401

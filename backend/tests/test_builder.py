"""Phase 2B: settings, the DRAFT → READY lifecycle, question ordering and duplication."""

import uuid

from tests.test_assessments import admin_headers, candidate_headers, create_assessment
from tests.test_questions import MCQ, MULTIPLE_SELECT, TRUE_FALSE, add_question


def ready_assessment(client, headers) -> dict:
    """An assessment whose questions add up to its total marks — i.e. one that may become READY."""
    assessment = create_assessment(client, headers, total_marks=6, passing_marks=3)
    add_question(client, headers, assessment["id"], MCQ)  # 2
    add_question(client, headers, assessment["id"], MULTIPLE_SELECT)  # 3
    add_question(client, headers, assessment["id"], TRUE_FALSE)  # 1
    return client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()


# -- settings -------------------------------------------------------------------------------


def test_new_assessment_has_sensible_default_settings(client, helpers, users):
    body = create_assessment(client, admin_headers(helpers))

    assert body["settings"] == {
        "max_attempts": 1,
        "randomize_questions": False,
        "randomize_options": False,
        "show_results": False,
        "question_navigation": "FREE",
        # Phase 4A: off by default, so an assessment is unproctored unless an admin opts in.
        "proctoring_required": False,
        "availability_start": None,
        "availability_end": None,
    }


def test_admin_can_save_settings_and_they_persist(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}",
        json={
            "max_attempts": 3,
            "randomize_questions": True,
            "randomize_options": True,
            "show_results": True,
            "question_navigation": "SEQUENTIAL",
            "availability_start": "2026-10-01T09:00:00Z",
            "availability_end": "2026-10-01T11:00:00Z",
        },
        headers=headers,
    )

    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["max_attempts"] == 3
    assert settings["question_navigation"] == "SEQUENTIAL"
    assert settings["randomize_questions"] and settings["randomize_options"] and settings["show_results"]

    # Still there on a fresh read.
    reread = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()
    assert reread["settings"]["max_attempts"] == 3
    assert reread["settings"]["availability_start"].startswith("2026-10-01T09:00:00")


def test_settings_reject_invalid_values(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    path = f"/api/v1/assessments/{assessment['id']}"

    assert client.patch(path, json={"max_attempts": 0}, headers=headers).status_code == 422
    assert client.patch(path, json={"max_attempts": -2}, headers=headers).status_code == 422
    assert client.patch(path, json={"question_navigation": "TELEPORT"}, headers=headers).status_code == 422
    assert client.patch(path, json={"duration_minutes": 0}, headers=headers).status_code == 422


def test_availability_end_must_follow_start(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)

    response = client.patch(
        f"/api/v1/assessments/{assessment['id']}",
        json={"availability_start": "2026-10-01T11:00:00Z", "availability_end": "2026-10-01T09:00:00Z"},
        headers=headers,
    )

    assert response.status_code == 422
    assert "after" in response.text


def test_availability_range_is_checked_across_separate_patches(client, helpers, users):
    """A second PATCH must not be able to sneak an end date before an already-stored start."""
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    path = f"/api/v1/assessments/{assessment['id']}"

    assert (
        client.patch(path, json={"availability_start": "2026-10-01T11:00:00Z"}, headers=headers).status_code
        == 200
    )
    response = client.patch(path, json={"availability_end": "2026-10-01T09:00:00Z"}, headers=headers)

    assert response.status_code == 422


# -- readiness and lifecycle -------------------------------------------------------------------


def test_a_new_assessment_is_not_ready_and_says_why(client, helpers, users):
    body = create_assessment(client, admin_headers(helpers))

    assert body["status"] == "DRAFT"
    assert body["readiness"]["is_ready"] is False
    assert any("at least one question" in issue["message"] for issue in body["readiness"]["issues"])


def test_marks_mismatch_is_reported_as_a_readiness_issue(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers, total_marks=50)
    add_question(client, headers, assessment["id"], MCQ)  # 2 of 50

    detail = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()

    assert detail["readiness"]["is_ready"] is False
    assert any("add up to 2" in issue["message"] for issue in detail["readiness"]["issues"])


def test_a_complete_assessment_can_be_marked_ready(client, helpers, users):
    headers = admin_headers(helpers)
    detail = ready_assessment(client, headers)
    assert detail["readiness"]["is_ready"] is True

    response = client.post(f"/api/v1/assessments/{detail['id']}/ready", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "READY"
    # Persisted, not just returned.
    assert client.get(f"/api/v1/assessments/{detail['id']}", headers=headers).json()["status"] == "READY"


def test_an_incomplete_assessment_cannot_be_marked_ready(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)  # no questions

    response = client.post(f"/api/v1/assessments/{assessment['id']}/ready", headers=headers)

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert any("at least one question" in detail["message"] for detail in body["details"])
    # Status is untouched.
    assert client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()["status"] == "DRAFT"


def test_marking_ready_is_idempotent(client, helpers, users):
    headers = admin_headers(helpers)
    detail = ready_assessment(client, headers)

    assert client.post(f"/api/v1/assessments/{detail['id']}/ready", headers=headers).status_code == 200
    assert client.post(f"/api/v1/assessments/{detail['id']}/ready", headers=headers).status_code == 200


def test_a_ready_assessment_can_go_back_to_draft(client, helpers, users):
    headers = admin_headers(helpers)
    detail = ready_assessment(client, headers)
    client.post(f"/api/v1/assessments/{detail['id']}/ready", headers=headers)

    response = client.post(f"/api/v1/assessments/{detail['id']}/draft", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "DRAFT"


def test_unknown_assessment_cannot_be_marked_ready(client, helpers, users):
    response = client.post(f"/api/v1/assessments/{uuid.uuid4()}/ready", headers=admin_headers(helpers))

    assert response.status_code == 404


def test_candidate_cannot_change_the_lifecycle(client, helpers, users):
    admin = admin_headers(helpers)
    detail = ready_assessment(client, admin)
    headers = candidate_headers(helpers)

    assert client.post(f"/api/v1/assessments/{detail['id']}/ready", headers=headers).status_code == 403
    assert client.post(f"/api/v1/assessments/{detail['id']}/draft", headers=headers).status_code == 403
    assert (
        client.patch(
            f"/api/v1/assessments/{detail['id']}", json={"max_attempts": 9}, headers=headers
        ).status_code
        == 403
    )


# -- ordering ------------------------------------------------------------------------------------


def test_questions_can_be_reordered_and_the_order_persists(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    first = add_question(client, headers, assessment["id"], MCQ)
    second = add_question(client, headers, assessment["id"], MULTIPLE_SELECT)
    third = add_question(client, headers, assessment["id"], TRUE_FALSE)

    # Move the third question to the front.
    response = client.post(
        f"/api/v1/assessments/{assessment['id']}/questions/reorder",
        json={"question_ids": [third["id"], first["id"], second["id"]]},
        headers=headers,
    )

    assert response.status_code == 200
    assert [q["id"] for q in response.json()] == [third["id"], first["id"], second["id"]]
    assert [q["position"] for q in response.json()] == [0, 1, 2]

    # Re-read from the database, not the response.
    detail = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()
    assert [q["id"] for q in detail["questions"]] == [third["id"], first["id"], second["id"]]


def test_reorder_rejects_a_list_that_is_not_exactly_the_questions(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    first = add_question(client, headers, assessment["id"], MCQ)
    second = add_question(client, headers, assessment["id"], TRUE_FALSE)
    path = f"/api/v1/assessments/{assessment['id']}/questions/reorder"

    missing = client.post(path, json={"question_ids": [first["id"]]}, headers=headers)
    duplicated = client.post(path, json={"question_ids": [first["id"], first["id"]]}, headers=headers)
    foreign = client.post(
        path, json={"question_ids": [first["id"], second["id"], str(uuid.uuid4())]}, headers=headers
    )

    assert missing.status_code == 422
    assert duplicated.status_code == 422
    assert foreign.status_code == 422
    # Nothing moved.
    detail = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()
    assert [q["id"] for q in detail["questions"]] == [first["id"], second["id"]]


def test_deleting_a_question_closes_the_gap_in_positions(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    first = add_question(client, headers, assessment["id"], MCQ)
    second = add_question(client, headers, assessment["id"], MULTIPLE_SELECT)
    third = add_question(client, headers, assessment["id"], TRUE_FALSE)

    client.delete(f"/api/v1/assessments/{assessment['id']}/questions/{second['id']}", headers=headers)

    detail = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()
    assert [q["id"] for q in detail["questions"]] == [first["id"], third["id"]]
    assert [q["position"] for q in detail["questions"]] == [0, 1]


def test_candidate_cannot_reorder_questions(client, helpers, users):
    admin = admin_headers(helpers)
    assessment = create_assessment(client, admin)
    question = add_question(client, admin, assessment["id"], MCQ)

    response = client.post(
        f"/api/v1/assessments/{assessment['id']}/questions/reorder",
        json={"question_ids": [question["id"]]},
        headers=candidate_headers(helpers),
    )

    assert response.status_code == 403


# -- duplication ---------------------------------------------------------------------------------


def test_duplicating_a_question_copies_it_directly_after_the_original(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    first = add_question(client, headers, assessment["id"], MCQ)
    last = add_question(client, headers, assessment["id"], TRUE_FALSE)

    response = client.post(
        f"/api/v1/assessments/{assessment['id']}/questions/{first['id']}/duplicate", headers=headers
    )

    assert response.status_code == 201
    copy = response.json()
    assert copy["id"] != first["id"]
    assert copy["text"] == first["text"]
    assert copy["type"] == first["type"]
    assert copy["marks"] == first["marks"]
    assert [(o["text"], o["is_correct"]) for o in copy["options"]] == [
        (o["text"], o["is_correct"]) for o in first["options"]
    ]
    # Option rows are new, not shared with the original.
    assert {o["id"] for o in copy["options"]}.isdisjoint({o["id"] for o in first["options"]})

    detail = client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()
    assert [q["id"] for q in detail["questions"]] == [first["id"], copy["id"], last["id"]]
    assert [q["position"] for q in detail["questions"]] == [0, 1, 2]


def test_duplicating_does_not_modify_the_original(client, helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)
    original = add_question(client, headers, assessment["id"], MCQ)

    client.post(
        f"/api/v1/assessments/{assessment['id']}/questions/{original['id']}/duplicate", headers=headers
    )

    reread = client.get(
        f"/api/v1/assessments/{assessment['id']}/questions/{original['id']}", headers=headers
    ).json()
    assert reread["text"] == original["text"]
    assert reread["marks"] == original["marks"]
    assert [(o["text"], o["is_correct"]) for o in reread["options"]] == [
        (o["text"], o["is_correct"]) for o in original["options"]
    ]


def test_duplicate_requires_the_question_to_belong_to_the_assessment(client, helpers, users):
    headers = admin_headers(helpers)
    first = create_assessment(client, headers)
    second = create_assessment(client, headers, title="Another Assessment")
    question = add_question(client, headers, first["id"], MCQ)

    response = client.post(
        f"/api/v1/assessments/{second['id']}/questions/{question['id']}/duplicate", headers=headers
    )

    assert response.status_code == 404


def test_candidate_cannot_duplicate_a_question(client, helpers, users):
    admin = admin_headers(helpers)
    assessment = create_assessment(client, admin)
    question = add_question(client, admin, assessment["id"], MCQ)

    response = client.post(
        f"/api/v1/assessments/{assessment['id']}/questions/{question['id']}/duplicate",
        headers=candidate_headers(helpers),
    )

    assert response.status_code == 403

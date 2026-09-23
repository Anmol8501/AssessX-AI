"""Phase 2A: assessment authoring — CRUD, admin-only access, validation, cascade."""

import uuid

from sqlalchemy import func, select

from app.models.question import Question, QuestionOption
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, Helpers

VALID_ASSESSMENT = {
    "title": "Data Structures Mid-Term",
    "description": "Mid-term examination covering Modules 1-3",
    "instructions": "Answer all questions carefully.",
    "duration_minutes": 60,
    "total_marks": 50,
    "passing_marks": 20,
}


def admin_headers(helpers: Helpers) -> dict[str, str]:
    return helpers.bearer(helpers.token_for("admin@test.local", ADMIN_PASSWORD))


def candidate_headers(helpers: Helpers) -> dict[str, str]:
    return helpers.bearer(helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD))


def create_assessment(client, headers, **overrides) -> dict:
    response = client.post("/api/v1/assessments", json={**VALID_ASSESSMENT, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# -- creation ---------------------------------------------------------------------------------


def test_admin_can_create_an_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)

    body = create_assessment(client, headers)

    assert body["title"] == "Data Structures Mid-Term"
    assert body["status"] == "DRAFT"  # Phase 2A authors drafts only
    assert body["duration_minutes"] == 60
    assert body["question_count"] == 0
    assert body["allocated_marks"] == 0
    assert body["questions"] == []
    assert uuid.UUID(body["id"])


def test_created_assessment_persists_and_appears_in_the_list(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    created = create_assessment(client, headers)

    listed = client.get("/api/v1/assessments", headers=headers)
    fetched = client.get(f"/api/v1/assessments/{created['id']}", headers=headers)

    assert listed.status_code == 200
    assert created["id"] in {row["id"] for row in listed.json()}
    assert fetched.status_code == 200
    assert fetched.json()["title"] == created["title"]


def test_title_is_trimmed_and_blank_fields_stored_as_null(client, helpers: Helpers, users):
    body = create_assessment(client, admin_headers(helpers), title="  Spaced Title  ", description="")

    assert body["title"] == "Spaced Title"
    assert body["description"] is None


# -- validation -------------------------------------------------------------------------------


def test_assessment_requires_a_title(client, helpers: Helpers, users):
    response = client.post(
        "/api/v1/assessments", json={**VALID_ASSESSMENT, "title": ""}, headers=admin_headers(helpers)
    )

    assert response.status_code == 422
    assert "title" in {d["field"] for d in response.json()["error"]["details"]}


def test_assessment_rejects_non_positive_duration_and_marks(client, helpers: Helpers, users):
    headers = admin_headers(helpers)

    for field, value in (("duration_minutes", 0), ("total_marks", 0), ("duration_minutes", -5)):
        response = client.post(
            "/api/v1/assessments", json={**VALID_ASSESSMENT, field: value}, headers=headers
        )
        assert response.status_code == 422, (field, value)
        assert field in {d["field"] for d in response.json()["error"]["details"]}


def test_passing_marks_cannot_exceed_total_marks(client, helpers: Helpers, users):
    response = client.post(
        "/api/v1/assessments",
        json={**VALID_ASSESSMENT, "total_marks": 50, "passing_marks": 60},
        headers=admin_headers(helpers),
    )

    assert response.status_code == 422
    assert "exceed total marks" in response.text


def test_patch_cannot_make_passing_marks_exceed_total(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    created = create_assessment(client, headers)

    response = client.patch(
        f"/api/v1/assessments/{created['id']}", json={"passing_marks": 999}, headers=headers
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# -- update / delete ---------------------------------------------------------------------------


def test_admin_can_update_an_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    created = create_assessment(client, headers)

    response = client.patch(
        f"/api/v1/assessments/{created['id']}",
        json={"title": "Revised Title", "duration_minutes": 90},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Revised Title"
    assert response.json()["duration_minutes"] == 90
    assert response.json()["total_marks"] == created["total_marks"]  # untouched fields survive


def test_admin_can_delete_an_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    created = create_assessment(client, headers)

    assert client.delete(f"/api/v1/assessments/{created['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/assessments/{created['id']}", headers=headers).status_code == 404


def test_unknown_assessment_is_a_not_found(client, helpers: Helpers, users):
    response = client.get(f"/api/v1/assessments/{uuid.uuid4()}", headers=admin_headers(helpers))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_malformed_assessment_id_is_a_validation_error(client, helpers: Helpers, users):
    response = client.get("/api/v1/assessments/not-a-uuid", headers=admin_headers(helpers))

    assert response.status_code == 422


# -- authorization -----------------------------------------------------------------------------


def test_candidate_cannot_create_an_assessment(client, helpers: Helpers, users):
    response = client.post("/api/v1/assessments", json=VALID_ASSESSMENT, headers=candidate_headers(helpers))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_candidate_cannot_read_update_or_delete_assessments(client, helpers: Helpers, users):
    created = create_assessment(client, admin_headers(helpers))
    headers = candidate_headers(helpers)

    assert client.get("/api/v1/assessments", headers=headers).status_code == 403
    assert client.get(f"/api/v1/assessments/{created['id']}", headers=headers).status_code == 403
    assert (
        client.patch(f"/api/v1/assessments/{created['id']}", json={"title": "x"}, headers=headers).status_code
        == 403
    )
    assert client.delete(f"/api/v1/assessments/{created['id']}", headers=headers).status_code == 403


def test_unauthenticated_user_cannot_touch_assessments(client, users):
    assert client.get("/api/v1/assessments").status_code == 401
    assert client.post("/api/v1/assessments", json=VALID_ASSESSMENT).status_code == 401


# -- cascade ------------------------------------------------------------------------------------


def test_deleting_an_assessment_removes_its_questions_and_options(client, helpers: Helpers, db, users):
    headers = admin_headers(helpers)
    created = create_assessment(client, headers)
    client.post(
        f"/api/v1/assessments/{created['id']}/questions",
        json={
            "type": "MCQ",
            "text": "Binary search complexity?",
            "marks": 2,
            "options": [
                {"text": "O(n)", "is_correct": False},
                {"text": "O(log n)", "is_correct": True},
            ],
        },
        headers=headers,
    )
    assessment_id = uuid.UUID(created["id"])
    assert (
        db.scalar(select(func.count()).select_from(Question).where(Question.assessment_id == assessment_id))
        == 1
    )

    assert client.delete(f"/api/v1/assessments/{created['id']}", headers=headers).status_code == 204

    db.expire_all()
    assert (
        db.scalar(select(func.count()).select_from(Question).where(Question.assessment_id == assessment_id))
        == 0
    )
    # No orphaned options either.
    assert db.scalar(select(func.count()).select_from(QuestionOption)) == 0

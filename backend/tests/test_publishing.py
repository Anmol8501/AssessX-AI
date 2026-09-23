"""Phase 2C: publishing, demo candidates, assignment, and the candidate's own view."""

import uuid

from tests.conftest import CANDIDATE_PASSWORD, Helpers
from tests.test_assessments import admin_headers, candidate_headers, create_assessment
from tests.test_builder import ready_assessment
from tests.test_questions import MCQ, add_question

NEW_CANDIDATE = {
    "name": "Rahul Sharma",
    "email": "rahul@demo.local",
    "roll_number": "DEMO2026001",
    "initial_password": "Demo-candidate-pass-1",
}


def published_assessment(client, headers) -> dict:
    detail = ready_assessment(client, headers)
    response = client.post(f"/api/v1/assessments/{detail['id']}/publish", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def create_candidate(client, headers, **overrides) -> dict:
    response = client.post("/api/v1/candidates", json={**NEW_CANDIDATE, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# -- publishing -------------------------------------------------------------------------------


def test_a_ready_assessment_can_be_published(client, helpers: Helpers, users):
    headers = admin_headers(helpers)

    body = published_assessment(client, headers)

    assert body["status"] == "PUBLISHED"
    # Persisted, not just returned.
    assert client.get(f"/api/v1/assessments/{body['id']}", headers=headers).json()["status"] == "PUBLISHED"


def test_a_draft_cannot_be_published_directly(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers)  # no questions: not even ready

    response = client.post(f"/api/v1/assessments/{assessment['id']}/publish", headers=headers)

    assert response.status_code == 422
    assert client.get(f"/api/v1/assessments/{assessment['id']}", headers=headers).json()["status"] == "DRAFT"


def test_an_invalid_assessment_cannot_be_published_and_says_why(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    assessment = create_assessment(client, headers, total_marks=50)
    add_question(client, headers, assessment["id"], MCQ)  # 2 of 50 marks

    response = client.post(f"/api/v1/assessments/{assessment['id']}/publish", headers=headers)

    assert response.status_code == 422
    assert any("add up to 2" in d["message"] for d in response.json()["error"]["details"])


def test_publishing_twice_is_idempotent(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    again = client.post(f"/api/v1/assessments/{body['id']}/publish", headers=headers)

    assert again.status_code == 200
    assert again.json()["status"] == "PUBLISHED"


def test_a_published_assessment_can_be_unpublished_while_unassigned(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    response = client.post(f"/api/v1/assessments/{body['id']}/unpublish", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "DRAFT"


def test_a_published_assessment_with_candidates_cannot_be_unpublished(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["candidate"].id)]},
        headers=headers,
    )

    response = client.post(f"/api/v1/assessments/{body['id']}/unpublish", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_candidate_cannot_publish(client, helpers: Helpers, users):
    detail = ready_assessment(client, admin_headers(helpers))

    response = client.post(f"/api/v1/assessments/{detail['id']}/publish", headers=candidate_headers(helpers))

    assert response.status_code == 403


def test_unauthenticated_cannot_publish(client, helpers: Helpers, users):
    detail = ready_assessment(client, admin_headers(helpers))

    assert client.post(f"/api/v1/assessments/{detail['id']}/publish").status_code == 401


# -- demo candidates ---------------------------------------------------------------------------


def test_admin_can_create_a_demo_candidate(client, helpers: Helpers, users):
    body = create_candidate(client, admin_headers(helpers))

    assert body["role"] == "CANDIDATE"
    assert body["email"] == "rahul@demo.local"
    assert body["roll_number"] == "DEMO2026001"
    assert "password" not in body and "password_hash" not in body


def test_a_created_candidate_can_sign_in(client, helpers: Helpers, users):
    create_candidate(client, admin_headers(helpers))

    response = helpers.login_candidate(
        "rahul@demo.local", NEW_CANDIDATE["initial_password"], roll_number="DEMO2026001"
    )

    assert response.status_code == 200
    assert response.json()["user"]["role"] == "CANDIDATE"


def test_duplicate_candidate_email_is_rejected(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    create_candidate(client, headers)

    response = client.post(
        "/api/v1/candidates", json={**NEW_CANDIDATE, "roll_number": "DEMO2026999"}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_duplicate_roll_number_is_rejected(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    create_candidate(client, headers)

    response = client.post(
        "/api/v1/candidates", json={**NEW_CANDIDATE, "email": "other@demo.local"}, headers=headers
    )

    assert response.status_code == 409


def test_invalid_candidate_input_is_rejected(client, helpers: Helpers, users):
    headers = admin_headers(helpers)

    for payload in (
        {**NEW_CANDIDATE, "email": "not-an-email"},
        {**NEW_CANDIDATE, "name": ""},
        {**NEW_CANDIDATE, "initial_password": "short"},
        {**NEW_CANDIDATE, "roll_number": ""},
    ):
        assert client.post("/api/v1/candidates", json=payload, headers=headers).status_code == 422


def test_creating_a_candidate_cannot_mint_an_admin(client, helpers: Helpers, users):
    """A client-supplied role is ignored: this endpoint only ever creates candidates."""
    body = create_candidate(client, admin_headers(helpers), role="ADMIN", username="sneaky")

    assert body["role"] == "CANDIDATE"
    assert body["username"] is None


def test_admin_sees_candidates_with_assignment_counts(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["candidate"].id)]},
        headers=headers,
    )

    listed = client.get("/api/v1/candidates", headers=headers)

    assert listed.status_code == 200
    rows = {row["email"]: row for row in listed.json()}
    assert rows["candidate@test.local"]["assignment_count"] == 1
    assert rows["inactive@test.local"]["assignment_count"] == 0
    assert "admin@test.local" not in rows  # administrators are not candidates


def test_candidate_cannot_create_or_list_candidates(client, helpers: Helpers, users):
    headers = candidate_headers(helpers)

    assert client.post("/api/v1/candidates", json=NEW_CANDIDATE, headers=headers).status_code == 403
    assert client.get("/api/v1/candidates", headers=headers).status_code == 403


# -- assignment ---------------------------------------------------------------------------------


def test_admin_can_assign_a_published_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    response = client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["candidate"].id)]},
        headers=headers,
    )

    assert response.status_code == 201
    result = response.json()
    assert len(result["assigned"]) == 1
    assert result["assigned"][0]["candidate_email"] == "candidate@test.local"
    assert result["assigned"][0]["status"] == "ASSIGNED"
    assert result["already_assigned"] == []


def test_a_draft_or_ready_assessment_cannot_be_assigned(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    draft = create_assessment(client, headers)
    ready = ready_assessment(client, headers)
    client.post(f"/api/v1/assessments/{ready['id']}/ready", headers=headers)
    payload = {"candidate_ids": [str(users["candidate"].id)]}

    assert (
        client.post(
            f"/api/v1/assessments/{draft['id']}/assignments", json=payload, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/v1/assessments/{ready['id']}/assignments", json=payload, headers=headers
        ).status_code
        == 422
    )


def test_duplicate_assignment_is_reported_not_duplicated(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)
    payload = {"candidate_ids": [str(users["candidate"].id)]}
    client.post(f"/api/v1/assessments/{body['id']}/assignments", json=payload, headers=headers)

    response = client.post(f"/api/v1/assessments/{body['id']}/assignments", json=payload, headers=headers)

    assert response.status_code == 201
    assert response.json()["assigned"] == []
    assert response.json()["already_assigned"] == [str(users["candidate"].id)]
    assert len(client.get(f"/api/v1/assessments/{body['id']}/assignments", headers=headers).json()) == 1


def test_an_admin_cannot_be_assigned_as_a_candidate(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    response = client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["admin"].id)]},
        headers=headers,
    )

    assert response.status_code == 422
    assert "not a candidate" in response.text


def test_an_inactive_candidate_cannot_be_assigned(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    response = client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["inactive"].id)]},
        headers=headers,
    )

    assert response.status_code == 422
    assert "inactive" in response.text


def test_assigning_an_unknown_candidate_is_a_not_found(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    response = client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(uuid.uuid4())]},
        headers=headers,
    )

    assert response.status_code == 404


def test_admin_can_view_and_remove_assignments(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)
    candidate_id = str(users["candidate"].id)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [candidate_id]},
        headers=headers,
    )

    listed = client.get(f"/api/v1/assessments/{body['id']}/assignments", headers=headers)
    assert listed.status_code == 200
    assert [row["candidate_email"] for row in listed.json()] == ["candidate@test.local"]

    removed = client.delete(f"/api/v1/assessments/{body['id']}/assignments/{candidate_id}", headers=headers)
    assert removed.status_code == 204
    assert client.get(f"/api/v1/assessments/{body['id']}/assignments", headers=headers).json() == []


def test_unassigning_someone_who_is_not_assigned_is_a_not_found(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)

    response = client.delete(
        f"/api/v1/assessments/{body['id']}/assignments/{users['candidate'].id}", headers=headers
    )

    assert response.status_code == 404


def test_assignment_count_appears_on_the_assessment(client, helpers: Helpers, users):
    headers = admin_headers(helpers)
    body = published_assessment(client, headers)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["candidate"].id)]},
        headers=headers,
    )

    detail = client.get(f"/api/v1/assessments/{body['id']}", headers=headers).json()
    listed = client.get("/api/v1/assessments", headers=headers).json()

    assert detail["assignment_count"] == 1
    assert next(row for row in listed if row["id"] == body["id"])["assignment_count"] == 1


def test_candidate_cannot_assign_or_unassign(client, helpers: Helpers, users):
    admin = admin_headers(helpers)
    body = published_assessment(client, admin)
    headers = candidate_headers(helpers)
    payload = {"candidate_ids": [str(users["candidate"].id)]}

    assert (
        client.post(
            f"/api/v1/assessments/{body['id']}/assignments", json=payload, headers=headers
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/assessments/{body['id']}/assignments", headers=headers).status_code == 403
    assert (
        client.delete(
            f"/api/v1/assessments/{body['id']}/assignments/{users['candidate'].id}", headers=headers
        ).status_code
        == 403
    )


# -- the candidate's own view ---------------------------------------------------------------------


def test_candidate_sees_only_their_own_assigned_assessments(client, helpers: Helpers, users):
    admin = admin_headers(helpers)
    body = published_assessment(client, admin)
    # A second candidate who is not assigned anything.
    other = create_candidate(client, admin)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["candidate"].id)]},
        headers=admin,
    )

    mine = client.get("/api/v1/candidates/me/assessments", headers=candidate_headers(helpers))
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    row = mine.json()[0]
    assert row["title"] == "Data Structures Mid-Term"
    assert row["question_count"] == 3
    assert row["total_marks"] == 6
    assert row["status"] == "ASSIGNED"
    assert row["assessment_status"] == "PUBLISHED"
    # No questions or answer keys reach the candidate.
    assert "questions" not in row

    other_token = helpers.token_for_candidate(
        "rahul@demo.local", NEW_CANDIDATE["initial_password"], "DEMO2026001"
    )
    theirs = client.get("/api/v1/candidates/me/assessments", headers=helpers.bearer(other_token))
    assert theirs.status_code == 200
    assert theirs.json() == []
    assert other["id"] != str(users["candidate"].id)


def test_an_unassigned_candidate_sees_an_empty_list(client, helpers: Helpers, users):
    response = client.get("/api/v1/candidates/me/assessments", headers=candidate_headers(helpers))

    assert response.status_code == 200
    assert response.json() == []


def test_admin_cannot_use_the_candidate_assessments_endpoint(client, helpers: Helpers, users):
    response = client.get("/api/v1/candidates/me/assessments", headers=admin_headers(helpers))

    assert response.status_code == 403


def test_unauthenticated_cannot_read_candidate_assessments(client, users):
    assert client.get("/api/v1/candidates/me/assessments").status_code == 401


def test_unassigning_removes_it_from_the_candidate_view(client, helpers: Helpers, users):
    admin = admin_headers(helpers)
    body = published_assessment(client, admin)
    candidate_id = str(users["candidate"].id)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments", json={"candidate_ids": [candidate_id]}, headers=admin
    )
    assert (
        len(client.get("/api/v1/candidates/me/assessments", headers=candidate_headers(helpers)).json()) == 1
    )

    client.delete(f"/api/v1/assessments/{body['id']}/assignments/{candidate_id}", headers=admin)

    assert client.get("/api/v1/candidates/me/assessments", headers=candidate_headers(helpers)).json() == []


def test_deleting_an_assessment_removes_its_assignments(client, helpers: Helpers, db, users):
    from sqlalchemy import func, select

    from app.models.assignment import AssessmentAssignment

    admin = admin_headers(helpers)
    body = published_assessment(client, admin)
    client.post(
        f"/api/v1/assessments/{body['id']}/assignments",
        json={"candidate_ids": [str(users["candidate"].id)]},
        headers=admin,
    )

    assert client.delete(f"/api/v1/assessments/{body['id']}", headers=admin).status_code == 204

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(AssessmentAssignment)) == 0
    assert CANDIDATE_PASSWORD  # the candidate account itself is untouched
    assert client.get("/api/v1/candidates/me/assessments", headers=candidate_headers(helpers)).json() == []

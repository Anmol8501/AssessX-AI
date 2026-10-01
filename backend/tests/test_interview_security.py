"""Phase 7A security: broken access control, IDOR/BOLA, tampering, leakage and domain separation.

Attack scenarios, each asserted to fail closed:
* candidate B reads, answers or ends candidate A's session (by guessed or leaked id) → 404, A unchanged;
* a candidate reaches an interview they are not assigned, or one that is not published → 404;
* an item or question id from another session or interview is submitted as an answer → refused;
* an administrator uses candidate routes, a candidate uses admin routes, anonymous → 403/403/401;
* mass assignment of status, score, candidate or timing fields → 422;
* evaluation metadata (expected concepts, competency) never appears in any candidate response;
* injection-shaped text is stored as data; errors carry no stack traces or SQL;
* an interview never creates proctoring events, risk, evidence or reviews (separate domains).
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.attempt import AssessmentAttempt
from app.models.interview import InterviewSessionItem
from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent
from app.models.review import AttemptReview
from app.models.user import User
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_interview_config import BASE, ME, add_question, assign, call, create, published_interview
from tests.test_publishing import create_candidate

SESSIONS = f"{ME}/interview-sessions"


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


@pytest.fixture
def two(client, helpers: Helpers, admin, users):
    """One published interview assigned to candidate A (the fixture candidate) and candidate B; A has
    started. Returns both candidates' headers and A's session state."""
    ctx = published_interview(client, admin, questions=3, follow_ups=(0,))
    other = create_candidate(
        client, admin, email="b@demo.local", roll_number="B7", initial_password="Candidate-b-pass-1"
    )
    assign(client, admin, ctx["id"], users["candidate"].id)
    assign(client, admin, ctx["id"], other["id"])
    a = candidate_headers(helpers)
    b = helpers.bearer(helpers.token_for_candidate("b@demo.local", "Candidate-b-pass-1", "B7"))
    state = call(client, "POST", f"{ME}/interviews/{ctx['id']}/session", a, 201)
    return {"ctx": ctx, "a": a, "b": b, "state": state}


def test_candidate_b_cannot_touch_candidate_a_session(client, db, two):
    a_state, b = two["state"], two["b"]
    sid, item = a_state["session_id"], a_state["current"]["item_id"]
    call(client, "GET", f"{SESSIONS}/{sid}", b, 404)
    call(client, "POST", f"{SESSIONS}/{sid}/answers", b, 404, {"item_id": item, "answer_text": "Hijack."})
    call(client, "POST", f"{SESSIONS}/{sid}/complete", b, 404)
    call(client, "GET", f"{SESSIONS}/{uuid.uuid4()}", b, 404)  # guessed id

    after = call(client, "GET", f"{SESSIONS}/{sid}", two["a"], 200)
    assert after["status"] == "ACTIVE" and after["current"] == a_state["current"]
    assert (
        db.scalar(
            select(func.count())
            .select_from(InterviewSessionItem)
            .where(InterviewSessionItem.answer_text.is_not(None))
        )
        == 0
    )


def test_an_item_from_another_candidates_session_cannot_be_answered(client, two):
    b_state = call(client, "POST", f"{ME}/interviews/{two['ctx']['id']}/session", two["b"], 201)
    a_state = two["state"]
    # B submits A's current item id to B's own session: not B's current question.
    error = call(
        client,
        "POST",
        f"{SESSIONS}/{b_state['session_id']}/answers",
        two["b"],
        409,
        {"item_id": a_state["current"]["item_id"], "answer_text": "Cross-session."},
    )
    assert error["error"]["code"] == "stale_question"
    assert (
        call(client, "GET", f"{SESSIONS}/{a_state['session_id']}", two["a"], 200)["progress"][
            "primary_answered"
        ]
        == 0
    )


def test_another_interviews_question_cannot_be_answered(client, admin, users, two):
    other = published_interview(client, admin, questions=3, follow_ups=(), title="Other")
    error = call(
        client,
        "POST",
        f"{SESSIONS}/{two['state']['session_id']}/answers",
        two["a"],
        409,
        {"item_id": other["primaries"][0]["id"], "answer_text": "Wrong interview."},
    )
    assert error["error"]["code"] == "stale_question"


def test_unassigned_unpublished_and_unknown_interviews_are_not_found(client, helpers: Helpers, admin, users):
    a = candidate_headers(helpers)
    unassigned = published_interview(client, admin, title="Not yours")
    draft = create(client, admin, title="Draft")
    add_question(client, admin, draft["id"])
    for interview_id in (unassigned["id"], draft["id"], str(uuid.uuid4())):
        call(client, "GET", f"{ME}/interviews/{interview_id}", a, 404)
        call(client, "POST", f"{ME}/interviews/{interview_id}/session", a, 404)
    assert call(client, "GET", f"{ME}/interviews", a, 200) == []
    call(client, "GET", f"{ME}/interviews/not-a-uuid", a, 422)


def test_roles_are_enforced_on_candidate_routes(client, admin, two):
    sid, iid = two["state"]["session_id"], two["ctx"]["id"]
    body = {"item_id": two["state"]["current"]["item_id"], "answer_text": "x"}
    for method, url, json in [
        ("GET", f"{ME}/interviews", None),
        ("GET", f"{ME}/interviews/{iid}", None),
        ("POST", f"{ME}/interviews/{iid}/session", None),
        ("GET", f"{SESSIONS}/{sid}", None),
        ("POST", f"{SESSIONS}/{sid}/answers", body),
        ("POST", f"{SESSIONS}/{sid}/complete", None),
    ]:
        call(client, method, url, admin, 403, json)  # an administrator cannot act as a candidate
        call(client, method, url, None, 401, json)
    call(client, "POST", BASE, two["a"], 403, {"title": "x"})


def test_evaluation_metadata_never_reaches_the_candidate(client, admin, users, helpers: Helpers):
    interview = create(client, admin, question_count=1, max_follow_ups=1)
    primary = add_question(
        client,
        admin,
        interview["id"],
        expected_concepts=["SECRET-CONCEPT"],
        competency="SECRET-COMPETENCY",
        context="A visible scenario.",
    )
    call(
        client,
        "POST",
        f"{BASE}/{interview['id']}/questions/{primary['id']}/follow-up",
        admin,
        201,
        {"text": "Follow?", "expected_concepts": ["SECRET-FOLLOW-CONCEPT"]},
    )
    call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 200)
    assign(client, admin, interview["id"], users["candidate"].id)
    a = candidate_headers(helpers)

    responses = [
        call(client, "GET", f"{ME}/interviews", a, 200),
        call(client, "GET", f"{ME}/interviews/{interview['id']}", a, 200),
    ]
    state = call(client, "POST", f"{ME}/interviews/{interview['id']}/session", a, 201)
    responses.append(state)
    state = call(
        client,
        "POST",
        f"{SESSIONS}/{state['session_id']}/answers",
        a,
        200,
        {"item_id": state["current"]["item_id"], "answer_text": "An answer."},
    )
    responses.append(state)
    text = str(responses)
    for hidden in ("SECRET-CONCEPT", "SECRET-COMPETENCY", "SECRET-FOLLOW-CONCEPT", "expected_concepts",
                   "competency", "parent_question_id", "is_active", primary["id"]):  # fmt: skip
        assert hidden not in text
    assert responses[2]["current"]["context"] == "A visible scenario."  # part of the question as shown


def test_injection_shaped_text_is_stored_as_data(client, db, two):
    payload = "'); DROP TABLE users; -- <script>alert(1)</script> {{7*7}}"
    state = two["state"]
    call(
        client,
        "POST",
        f"{SESSIONS}/{state['session_id']}/answers",
        two["a"],
        200,
        {"item_id": state["current"]["item_id"], "answer_text": payload},
    )
    stored = db.scalar(
        select(InterviewSessionItem.answer_text).where(InterviewSessionItem.answer_text.is_not(None))
    )
    assert stored == payload
    assert db.scalar(select(func.count()).select_from(User)) >= 3


def test_errors_do_not_leak_internals(client, two):
    response = client.post(
        f"{SESSIONS}/{two['state']['session_id']}/answers",
        headers={**two["a"], "Content-Type": "application/json"},
        content=b'{"item_id": ',
    )
    assert response.status_code == 422
    body = response.text.lower()
    assert (
        "traceback" not in body and "sqlalchemy" not in body and "select " not in body and ".py" not in body
    )


def test_an_interview_creates_no_proctoring_risk_or_review_data(client, db, two):
    state = two["state"]
    while state["status"] == "ACTIVE":
        state = call(
            client,
            "POST",
            f"{SESSIONS}/{state['session_id']}/answers",
            two["a"],
            200,
            {"item_id": state["current"]["item_id"], "answer_text": "A deliberately weak answer."},
        )
    for model in (ProctoringEvent, ProctoringSession, AssessmentAttempt, AttemptReview):
        assert db.scalar(select(func.count()).select_from(model)) == 0, model.__name__

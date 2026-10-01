"""Phase 7A: interview configuration (admin) — validation, the question bank, publishing, assignment.

What is asserted: an administrator creates and configures an interview with bounded, validated fields
(types and difficulty constrained, topics de-duplicated, follow-up budget ≤ question count); questions
must use an approved topic; a follow-up inherits its primary's topic/type/difficulty, and a primary has
at most one; reordering lists every primary exactly once; publishing is refused until enough eligible
questions exist, and locks the interview; unpublishing is refused while anyone is assigned; only a
published interview is assigned, only to active candidates; every change is audited with ids and field
names only; and candidates and anonymous callers can do none of it.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers

BASE = "/api/v1/interviews"
ME = "/api/v1/candidates/me"

CONFIG = {
    "title": "Python Technical Interview",
    "description": "Screening interview.",
    "instructions": "Answer in your own words.",
    "interview_type": "TECHNICAL",
    "difficulty": "MEDIUM",
    "topics": ["Python", "SQL"],
    "duration_minutes": 30,
    "question_count": 3,
    "follow_ups_enabled": True,
    "max_follow_ups": 2,
}
QUESTION = {
    "text": "Explain the difference between a process and a thread.",
    "question_type": "TECHNICAL",
    "topic": "Python",
    "difficulty": "EASY",
    "expected_concepts": ["memory isolation", "execution context", "concurrency"],
}


def call(client, method: str, url: str, headers, expect: int, json=None):
    response = client.request(method, url, headers=headers, json=json)
    assert response.status_code == expect, response.text
    return response.json() if response.content else None


def create(client, admin, **overrides) -> dict:
    return call(client, "POST", BASE, admin, 201, {**CONFIG, **overrides})


def add_question(client, admin, interview_id: str, expect: int = 201, **overrides) -> dict:
    return call(client, "POST", f"{BASE}/{interview_id}/questions", admin, expect, {**QUESTION, **overrides})


def add_follow_up(client, admin, interview_id: str, question_id: str, expect: int = 201, **overrides) -> dict:
    body = {
        "text": "How does memory isolation differ between the two?",
        "expected_concepts": ["address space"],
    }
    return call(
        client,
        "POST",
        f"{BASE}/{interview_id}/questions/{question_id}/follow-up",
        admin,
        expect,
        {**body, **overrides},
    )


def published_interview(
    client, admin, *, questions: int = 3, follow_ups: tuple[int, ...] = (0,), **config
) -> dict:
    """A published interview with `questions` primaries (in order) and follow-ups on the given ones."""
    interview = create(client, admin, **config)
    primaries = [
        add_question(client, admin, interview["id"], text=f"Primary question {n + 1}?")
        for n in range(questions)
    ]
    extras = [
        add_follow_up(
            client, admin, interview["id"], primaries[n]["id"], text=f"Follow-up to question {n + 1}?"
        )
        for n in follow_ups
    ]
    call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 200)
    return {"interview": interview, "id": interview["id"], "primaries": primaries, "follow_ups": extras}


def assign(client, admin, interview_id: str, candidate_id, expect: int = 201) -> dict:
    return call(
        client,
        "POST",
        f"{BASE}/{interview_id}/assignments",
        admin,
        expect,
        {"candidate_ids": [str(candidate_id)]},
    )


def audit_actions(db, interview_id: str) -> list[str]:
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.interview_id == uuid.UUID(interview_id))
        .order_by(AuditLog.occurred_at)
    )
    return [r.action.value for r in rows]


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


# -- configuration ----------------------------------------------------------------------------------


def test_an_admin_creates_a_draft_interview(client, admin, users):
    body = create(client, admin, topics=["Python", "python", " SQL "])
    assert body["status"] == "DRAFT" and body["published_at"] is None
    assert body["topics"] == ["Python", "SQL"]  # trimmed, de-duplicated case-insensitively
    assert body["questions"] == [] and body["eligible_question_count"] == 0
    assert {i["field"] for i in body["issues"]} == {"questions"}
    listed = call(client, "GET", BASE, admin, 200)
    assert listed[0]["id"] == body["id"] and listed[0]["primary_question_count"] == 0


@pytest.mark.parametrize(
    "bad",
    [
        {"interview_type": "ROBOTIC"},
        {"difficulty": "PHD"},
        {"duration_minutes": 0},
        {"duration_minutes": 181},
        {"question_count": 0},
        {"question_count": 31},
        {"max_follow_ups": -1},
        {"max_follow_ups": 4},  # more than question_count (3)
        {"title": "  "},
        {"topics": ["x" * 61]},
        {"topics": [f"t{n}" for n in range(13)]},
        {"status": "PUBLISHED"},  # not a request field
        {"created_by_id": str(uuid.uuid4())},
    ],
)
def test_invalid_configuration_is_rejected(client, admin, bad):
    call(client, "POST", BASE, admin, 422, {**CONFIG, **bad})


def test_an_update_changes_only_what_was_sent_and_keeps_the_budget_valid(client, admin):
    interview = create(client, admin)
    body = call(
        client, "PATCH", f"{BASE}/{interview['id']}", admin, 200, {"title": "Renamed", "description": None}
    )
    assert body["title"] == "Renamed" and body["description"] is None and body["topics"] == ["Python", "SQL"]
    call(client, "PATCH", f"{BASE}/{interview['id']}", admin, 422, {"question_count": 1})  # budget 2 > 1
    call(client, "PATCH", f"{BASE}/{interview['id']}", admin, 422, {"title": None})
    call(client, "PATCH", f"{BASE}/{interview['id']}", admin, 422, {"status": "PUBLISHED"})


# -- questions --------------------------------------------------------------------------------------


def test_questions_carry_metadata_and_must_use_an_approved_topic(client, admin):
    interview = create(client, admin)
    q = add_question(client, admin, interview["id"], topic="python", competency="Systems thinking")
    assert q["topic"] == "Python"  # stored in the interview's spelling
    assert q["expected_concepts"] == QUESTION["expected_concepts"] and q["kind"] == "PRIMARY"
    add_question(client, admin, interview["id"], expect=422, topic="Kubernetes")
    add_question(client, admin, interview["id"], expect=422, question_type="ESSAY")
    add_question(client, admin, interview["id"], expect=422, difficulty="EXTREME")
    add_question(client, admin, interview["id"], expect=422, text="")
    add_question(client, admin, interview["id"], expect=422, text="x" * 2001)
    add_question(client, admin, interview["id"], expect=422, time_limit_seconds=5)
    add_question(client, admin, interview["id"], expect=422, expected_concepts=["c"] * 21)
    add_question(client, admin, interview["id"], expect=422, kind="FOLLOW_UP")


def test_a_follow_up_inherits_from_its_primary_and_is_limited_to_one(client, admin):
    interview = create(client, admin)
    primary = add_question(
        client, admin, interview["id"], topic="SQL", difficulty="MEDIUM", question_type="SCENARIO"
    )
    follow = add_follow_up(client, admin, interview["id"], primary["id"])
    assert follow["kind"] == "FOLLOW_UP" and follow["parent_question_id"] == primary["id"]
    assert (follow["topic"], follow["difficulty"], follow["question_type"]) == ("SQL", "MEDIUM", "SCENARIO")
    add_follow_up(client, admin, interview["id"], primary["id"], expect=409)  # at most one
    add_follow_up(client, admin, interview["id"], follow["id"], expect=422)  # never a follow-up's follow-up
    add_follow_up(client, admin, interview["id"], str(uuid.uuid4()), expect=404)
    add_follow_up(client, admin, interview["id"], primary["id"], expect=422, topic="SQL")  # not a field

    # Editing the primary keeps the follow-up's inherited fields in step; the follow-up's own are fixed.
    call(
        client,
        "PATCH",
        f"{BASE}/{interview['id']}/questions/{primary['id']}",
        admin,
        200,
        {"difficulty": "EASY"},
    )
    detail = call(client, "GET", f"{BASE}/{interview['id']}", admin, 200)
    assert next(q for q in detail["questions"] if q["id"] == follow["id"])["difficulty"] == "EASY"
    url = f"{BASE}/{interview['id']}/questions/{follow['id']}"
    call(client, "PATCH", url, admin, 422, {"topic": "Python"})
    assert (
        call(client, "PATCH", url, admin, 200, {"text": "Reworded follow-up?"})["text"]
        == "Reworded follow-up?"
    )

    # Deleting a primary removes its follow-up too.
    call(client, "DELETE", f"{BASE}/{interview['id']}/questions/{primary['id']}", admin, 204)
    assert call(client, "GET", f"{BASE}/{interview['id']}", admin, 200)["questions"] == []


def test_another_interviews_question_cannot_be_reached_through_this_one(client, admin):
    mine, other = create(client, admin), create(client, admin, title="Other")
    foreign = add_question(client, admin, other["id"])
    call(client, "PATCH", f"{BASE}/{mine['id']}/questions/{foreign['id']}", admin, 404, {"text": "Hijacked?"})
    call(client, "DELETE", f"{BASE}/{mine['id']}/questions/{foreign['id']}", admin, 404)
    add_follow_up(client, admin, mine["id"], foreign["id"], expect=404)


def test_reordering_sets_the_order_sessions_ask_in(client, admin):
    interview = create(client, admin)
    a, b, c = (add_question(client, admin, interview["id"], text=f"Q{n}?") for n in "abc")
    add_follow_up(client, admin, interview["id"], a["id"])
    body = call(
        client,
        "POST",
        f"{BASE}/{interview['id']}/questions/reorder",
        admin,
        200,
        {"question_ids": [c["id"], a["id"], b["id"]]},
    )
    primaries = [q for q in body if q["kind"] == "PRIMARY"]
    assert [q["id"] for q in sorted(primaries, key=lambda q: q["position"])] == [c["id"], a["id"], b["id"]]
    url = f"{BASE}/{interview['id']}/questions/reorder"
    call(client, "POST", url, admin, 422, {"question_ids": [a["id"], b["id"]]})  # missing one
    call(client, "POST", url, admin, 422, {"question_ids": [a["id"], a["id"], b["id"], c["id"]]})


# -- publishing -------------------------------------------------------------------------------------


def test_publishing_requires_enough_eligible_questions_and_then_locks(client, admin):
    interview = create(client, admin)
    add_question(client, admin, interview["id"])
    add_question(client, admin, interview["id"], difficulty="HARD")  # above the MEDIUM ceiling
    error = call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 422)
    assert "only 1 active primary" in error["error"]["details"][0]["message"]

    add_question(client, admin, interview["id"])
    add_question(client, admin, interview["id"], question_type="CONCEPTUAL", topic="SQL")
    body = call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 200)
    assert body["status"] == "PUBLISHED" and body["published_at"] and body["issues"] == []

    for method, url, json in [
        ("PATCH", f"{BASE}/{interview['id']}", {"title": "Changed"}),
        ("POST", f"{BASE}/{interview['id']}/questions", QUESTION),
        ("PATCH", f"{BASE}/{interview['id']}/questions/{body['questions'][0]['id']}", {"text": "Changed?"}),
        ("DELETE", f"{BASE}/{interview['id']}/questions/{body['questions'][0]['id']}", None),
        ("DELETE", f"{BASE}/{interview['id']}", None),
    ]:
        assert call(client, method, url, admin, 409, json)["error"]["code"] == "interview_locked"


def test_follow_ups_enabled_with_no_budget_cannot_be_published(client, admin):
    interview = create(client, admin, question_count=1, max_follow_ups=0)
    add_question(client, admin, interview["id"])
    error = call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 422)
    assert error["error"]["details"][0]["field"] == "max_follow_ups"


def test_unpublishing_is_refused_while_anyone_is_assigned(client, admin, users):
    ctx = published_interview(client, admin)
    assign(client, admin, ctx["id"], users["candidate"].id)
    call(client, "POST", f"{BASE}/{ctx['id']}/unpublish", admin, 409)
    call(client, "DELETE", f"{BASE}/{ctx['id']}/assignments/{users['candidate'].id}", admin, 204)
    assert call(client, "POST", f"{BASE}/{ctx['id']}/unpublish", admin, 200)["status"] == "DRAFT"
    call(client, "DELETE", f"{BASE}/{ctx['id']}", admin, 204)
    call(client, "GET", f"{BASE}/{ctx['id']}", admin, 404)


# -- assignment -------------------------------------------------------------------------------------


def test_only_published_interviews_are_assigned_to_active_candidates(client, admin, users):
    draft = create(client, admin)
    assign(client, admin, draft["id"], users["candidate"].id, expect=422)
    ctx = published_interview(client, admin)
    assign(client, admin, ctx["id"], users["admin"].id, expect=422)  # not a candidate
    assign(client, admin, ctx["id"], users["inactive"].id, expect=422)
    assign(client, admin, ctx["id"], uuid.uuid4(), expect=404)
    first = assign(client, admin, ctx["id"], users["candidate"].id)
    again = assign(client, admin, ctx["id"], users["candidate"].id)
    assert (
        first["assigned"] == [str(users["candidate"].id)] and again["already_assigned"] == first["assigned"]
    )

    [row] = call(client, "GET", f"{BASE}/{ctx['id']}/assignments", admin, 200)
    assert (
        row["session_status"] == "NOT_STARTED" and row["primary_total"] == 3 and row["primary_answered"] == 0
    )
    assert "answers" not in row and "answer_text" not in str(row)


# -- audit and access -------------------------------------------------------------------------------


def test_configuration_changes_are_audited_without_question_text(client, db, admin, users):
    ctx = published_interview(client, admin, questions=3, follow_ups=(0,))
    assign(client, admin, ctx["id"], users["candidate"].id)
    actions = audit_actions(db, ctx["id"])
    assert actions[0] == "INTERVIEW_CREATED"
    assert actions.count("INTERVIEW_QUESTION_CREATED") == 4
    assert actions[-2:] == ["INTERVIEW_PUBLISHED", "INTERVIEW_ASSIGNED"]
    rows = db.scalars(select(AuditLog).where(AuditLog.interview_id == uuid.UUID(ctx["id"]))).all()
    assert "Primary question" not in str([r.details for r in rows])
    assert {r.actor_id for r in rows} == {users["admin"].id}


def test_candidates_and_anonymous_callers_cannot_configure_interviews(client, helpers: Helpers, admin, users):
    ctx = published_interview(client, admin)
    question_id = ctx["primaries"][0]["id"]
    candidate = candidate_headers(helpers)
    routes = [
        ("GET", BASE, None),
        ("POST", BASE, CONFIG),
        ("GET", f"{BASE}/{ctx['id']}", None),
        ("PATCH", f"{BASE}/{ctx['id']}", {"title": "Mine now"}),
        ("DELETE", f"{BASE}/{ctx['id']}", None),
        ("POST", f"{BASE}/{ctx['id']}/publish", None),
        ("POST", f"{BASE}/{ctx['id']}/unpublish", None),
        ("POST", f"{BASE}/{ctx['id']}/questions", QUESTION),
        ("PATCH", f"{BASE}/{ctx['id']}/questions/{question_id}", {"text": "x?"}),
        ("DELETE", f"{BASE}/{ctx['id']}/questions/{question_id}", None),
        ("POST", f"{BASE}/{ctx['id']}/questions/{question_id}/follow-up", {"text": "x?"}),
        ("POST", f"{BASE}/{ctx['id']}/questions/reorder", {"question_ids": [question_id]}),
        ("GET", f"{BASE}/{ctx['id']}/assignments", None),
        ("POST", f"{BASE}/{ctx['id']}/assignments", {"candidate_ids": [str(users["candidate"].id)]}),
        ("DELETE", f"{BASE}/{ctx['id']}/assignments/{users['candidate'].id}", None),
    ]
    for method, url, json in routes:
        call(client, method, url, candidate, 403, json)
        call(client, method, url, None, 401, json)
    assert call(client, "GET", f"{BASE}/{ctx['id']}", admin, 200)["title"] == CONFIG["title"]


def test_malformed_and_unknown_ids(client, admin):
    call(client, "GET", f"{BASE}/not-a-uuid", admin, 422)
    call(client, "GET", f"{BASE}/{uuid.uuid4()}", admin, 404)
    call(client, "POST", f"{BASE}/{uuid.uuid4()}/publish", admin, 404)

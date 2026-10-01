"""Phase 6C: the human review API — authorization, lifecycle, decisions, audit and separation.

What is asserted: only administrators can read or change a review (candidates 403 on every route, for
their own attempt and anyone else's; anonymous 401; a deactivated admin is refused); a review is
reached only through its attempt and an evidence id from another attempt is 404 (no IDOR/BOLA); the
reviewer, author and every time come from the server, and a request naming them is rejected; the
lifecycle only moves UNREVIEWED → IN_REVIEW → REVIEWED, an outcome needs a finished attempt, an
outcome and a rationale; a stale `expected_version` is 409 and nothing is overwritten; a completed
review changes only by a new revision that keeps the old one; notes are immutable; every action is
audited in the same transaction, the audit log is append-only and never holds note text; and the
review reads 6A/6B — recording their basis — without changing either. Risk never decides: a HIGH-risk
attempt can be CLEARED and a NORMAL one FLAGGED.
"""

import logging
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.attempt import AssessmentAttempt
from app.models.audit_log import AuditLog
from app.models.base import utcnow
from app.models.proctoring_event import ProctoringEvent, ProctoringEventType
from app.models.review import AttemptReview, ReviewDecision
from app.models.user import UserRole
from app.services.users import UserService
from tests.conftest import ADMIN_PASSWORD, Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, intruder, proctored_exam, unproctored_exam
from tests.test_risk_api import add_rows, count_queries

E = ProctoringEventType
QUEUE = "/api/v1/admin/attempts"
REVIEW = "/api/v1/admin/attempts/{}/review"
OUTCOMES = ["NO_ACTION", "CLEARED", "FLAGGED", "INVALIDATED"]


@pytest.fixture
def active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers, "id": attempt["id"]}


@pytest.fixture
def finished(client, active):
    submit(client, active["headers"], active["id"])
    return active


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


@pytest.fixture
def other_admin(db, helpers: Helpers, users):
    user = UserService(db).create(
        name="Bea Admin",
        email="admin2@test.local",
        password=ADMIN_PASSWORD,
        role=UserRole.ADMIN,
        username="bea",
    )
    db.flush()
    response = helpers.login_admin("admin2@test.local", ADMIN_PASSWORD, username="bea")
    assert response.status_code == 200, response.text
    return {"user": user, "headers": helpers.bearer(response.json()["token"])}


def call(client, method: str, url: str, headers, expect: int, json=None) -> dict:
    response = client.request(method, url, headers=headers, json=json)
    assert response.status_code == expect, response.text
    return response.json() if response.content else {}


def begin(client, headers, attempt_id: str, expect: int = 201) -> dict:
    return call(client, "POST", REVIEW.format(attempt_id), headers, expect)


def decide(
    client, headers, attempt_id: str, outcome: str, version: int, *, verb="complete", expect=200, **extra
):
    body = {
        "outcome": outcome,
        "rationale": "Reviewed the timeline and the source events.",
        "expected_version": version,
    }
    return call(client, "POST", REVIEW.format(attempt_id) + f"/{verb}", headers, expect, {**body, **extra})


def audit_rows(db, attempt_id: str) -> list[AuditLog]:
    return list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.attempt_id == uuid.UUID(attempt_id))
            .order_by(AuditLog.occurred_at)
        )
    )


def evidence_ids(client, headers, attempt_id: str) -> list[str]:
    timeline = call(client, "GET", f"/api/v1/admin/attempts/{attempt_id}/evidence", headers, 200)
    return [item["evidence_id"] for item in timeline["items"]]


def seed_high_risk(db, active) -> None:
    """Three sustained multiple-face episodes: comfortably HIGH under policy 6A-v1."""
    rows = []
    for start_ago in (200, 170, 140):
        eid = str(uuid.uuid4())
        rows += [
            (E.MULTIPLE_FACES_DETECTED, start_ago, {"phase": "started", "episode_id": eid, "face_count": 2}),
            (
                E.MULTIPLE_FACES_DETECTED,
                start_ago - 25,
                {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"},
            ),
        ]
    add_rows(db, active, rows)


# -- reading ----------------------------------------------------------------------------------------


def test_an_admin_opens_an_unreviewed_attempt_with_its_context(client, admin, active, users):
    body = call(client, "GET", REVIEW.format(active["id"]), admin, 200)

    assert body["status"] == "UNREVIEWED"
    assert body["version"] is None and body["outcome"] is None and body["decisions"] == []
    ctx = body["context"]
    assert ctx["attempt_id"] == active["id"]
    assert ctx["assessment_title"] == active["exam"]["title"]
    assert ctx["candidate_name"] == users["candidate"].name
    assert ctx["candidate_roll_number"] == users["candidate"].roll_number
    assert "candidate_email" not in ctx and "email" not in str(body)
    assert body["can_complete"] is False  # still in progress
    assert [o["outcome"] for o in body["outcome_options"]] == OUTCOMES
    assert "do not determine the outcome" in body["interpretation"]


def test_unknown_unproctored_and_malformed_attempts(client, admin, helpers: Helpers, users):
    call(client, "GET", REVIEW.format(uuid.uuid4()), admin, 404)
    call(client, "POST", REVIEW.format(uuid.uuid4()), admin, 404)
    exam = unproctored_exam(client, helpers, users)
    plain = start(client, candidate_headers(helpers), exam["id"])
    call(client, "GET", REVIEW.format(plain["id"]), admin, 404)
    call(client, "POST", REVIEW.format(plain["id"]), admin, 404)
    call(client, "GET", REVIEW.format("not-a-uuid"), admin, 422)
    call(client, "POST", REVIEW.format("123") + "/complete", admin, 422, {"outcome": "CLEARED"})


# -- authorization ----------------------------------------------------------------------------------


def _every_route(attempt_id: str, evidence_id: str):
    base = REVIEW.format(attempt_id)
    decision = {"outcome": "CLEARED", "rationale": "x", "expected_version": 1}
    return [
        ("GET", QUEUE, None),
        ("GET", base, None),
        ("POST", base, None),
        ("POST", base + "/notes", {"body": "x"}),
        ("PUT", base + f"/marks/{evidence_id}", {"mark": "DISMISSED"}),
        ("POST", base + "/complete", decision),
        ("POST", base + "/revise", decision),
    ]


def test_candidates_are_refused_every_review_route_for_any_attempt(
    client, db, helpers: Helpers, admin, finished
):
    add_rows(db, finished, [(E.PASTE_ATTEMPT, 30, {"shortcut": "CTRL+V"})])
    begin(client, admin, finished["id"])
    evidence = evidence_ids(client, admin, finished["id"])[0]
    other = intruder(client, helpers, finished["exam"])

    for headers in (finished["headers"], other):  # the candidate's own attempt, and someone else's
        for method, url, json in _every_route(finished["id"], evidence):
            call(client, method, url, headers, 403, json)
    for method, url, json in _every_route(finished["id"], evidence):
        call(client, method, url, None, 401, json)

    review = call(client, "GET", REVIEW.format(finished["id"]), admin, 200)
    assert review["status"] == "IN_REVIEW" and review["notes"] == [] and review["marks"] == []
    assert [h["action"] for h in review["history"]] == ["REVIEW_STARTED"]


def test_a_deactivated_admin_is_refused(client, db, other_admin, finished):
    other_admin["user"].is_active = False
    db.flush()
    response = client.post(REVIEW.format(finished["id"]), headers=other_admin["headers"])
    assert response.status_code in (401, 403)
    assert db.scalar(select(func.count()).select_from(AttemptReview)) == 0


def test_candidate_endpoints_never_expose_the_review(client, admin, finished):
    begin(client, admin, finished["id"])
    call(
        client,
        "POST",
        REVIEW.format(finished["id"]) + "/notes",
        admin,
        201,
        {"body": "Private admin reasoning."},
    )
    decide(client, admin, finished["id"], "INVALIDATED", 1)

    headers = finished["headers"]
    for url in (f"{ME}/attempts/{finished['id']}", f"{ME}/attempts/{finished['id']}/result", f"{ME}/results"):
        body = client.get(url, headers=headers).text
        assert "Private admin reasoning" not in body
        assert "INVALIDATED" not in body and "review" not in body.lower()


# -- lifecycle --------------------------------------------------------------------------------------


def test_starting_is_server_attributed_and_idempotent(client, db, admin, other_admin, active, users):
    before = utcnow()
    first = begin(client, admin, active["id"])
    assert first["status"] == "IN_REVIEW" and first["version"] == 1 and first["outcome"] is None
    assert first["started_by"] == {"id": str(users["admin"].id), "name": users["admin"].name}
    assert first["started_at"] >= before.isoformat().replace("+00:00", "")[:19]

    again = begin(client, other_admin["headers"], active["id"], expect=200)  # already started
    assert again["started_by"]["id"] == str(users["admin"].id) and again["version"] == 1
    assert db.scalar(select(func.count()).select_from(AttemptReview)) == 1
    assert [r.action.value for r in audit_rows(db, active["id"])] == ["REVIEW_STARTED"]


def test_nothing_is_recorded_before_a_review_is_started(client, db, admin, finished):
    base = REVIEW.format(finished["id"])
    add_rows(db, finished, [(E.PASTE_ATTEMPT, 30, {"shortcut": "CTRL+V"})])
    evidence = evidence_ids(client, admin, finished["id"])[0]
    for method, url, json in [
        ("POST", base + "/notes", {"body": "x"}),
        ("PUT", base + f"/marks/{evidence}", {"mark": "CONFIRMED"}),
        ("POST", base + "/complete", {"outcome": "CLEARED", "rationale": "x", "expected_version": 1}),
        ("POST", base + "/revise", {"outcome": "CLEARED", "rationale": "x", "expected_version": 1}),
    ]:
        assert call(client, method, url, admin, 409, json)["error"]["code"] == "review_not_started"
    assert audit_rows(db, finished["id"]) == []


def test_an_outcome_needs_a_finished_attempt(client, admin, active):
    begin(client, admin, active["id"])
    error = decide(client, admin, active["id"], "CLEARED", 1, expect=409)
    assert error["error"]["code"] == "attempt_in_progress"

    submit(client, active["headers"], active["id"])
    assert decide(client, admin, active["id"], "CLEARED", 1)["status"] == "REVIEWED"


def test_completing_settles_an_attempt_whose_time_ran_out(client, db, admin, active):
    begin(client, admin, active["id"])
    attempt = db.get(AssessmentAttempt, uuid.UUID(active["id"]))
    attempt.expires_at = utcnow() - timedelta(minutes=1)
    db.flush()

    body = decide(client, admin, active["id"], "NO_ACTION", 1)
    assert body["context"]["attempt_status"] == "TIME_EXPIRED" and body["status"] == "REVIEWED"


def test_completion_records_a_human_outcome_with_server_identity_and_time(client, db, admin, finished, users):
    begin(client, admin, finished["id"])
    before = utcnow()
    body = decide(client, admin, finished["id"], "FLAGGED", 1)
    after = utcnow()

    assert body["status"] == "REVIEWED" and body["outcome"] == "FLAGGED" and body["version"] == 2
    assert body["completed_by"]["id"] == str(users["admin"].id)
    review = db.scalar(select(AttemptReview))
    assert before <= review.completed_at <= after
    [decision] = body["decisions"]
    assert decision["revision"] == 1 and decision["authored_by"] == "HUMAN"
    assert decision["decided_by"]["id"] == str(users["admin"].id)
    assert decision["rationale"] == "Reviewed the timeline and the source events."
    assert "follow-up" in decision["outcome_description"]


@pytest.mark.parametrize(
    "forged",
    [
        {"reviewer_id": str(uuid.uuid4())},
        {"decided_by_id": str(uuid.uuid4())},
        {"completed_by": "someone"},
        {"completed_at": "2020-01-01T00:00:00Z"},
        {"status": "REVIEWED"},
        {"risk_score": 0},
    ],
)
def test_a_request_cannot_name_the_reviewer_time_or_state(client, db, admin, finished, forged):
    begin(client, admin, finished["id"])
    decide(client, admin, finished["id"], "CLEARED", 1, expect=422, **forged)
    note = {"body": "x", "author_id": str(uuid.uuid4())}
    call(client, "POST", REVIEW.format(finished["id"]) + "/notes", admin, 422, note)
    assert db.scalar(select(AttemptReview)).status.value == "IN_REVIEW"


@pytest.mark.parametrize(
    "body",
    [
        {"outcome": "CHEATED", "rationale": "x", "expected_version": 1},
        {"outcome": "AI_CONFIRMED_CHEATING", "rationale": "x", "expected_version": 1},
        {"outcome": "cleared", "rationale": "x", "expected_version": 1},
        {"rationale": "x", "expected_version": 1},
        {"outcome": "CLEARED", "expected_version": 1},
        {"outcome": "CLEARED", "rationale": "   ", "expected_version": 1},
        {"outcome": "CLEARED", "rationale": "x" * 4001, "expected_version": 1},
        {"outcome": "CLEARED", "rationale": "x"},
        {"outcome": "CLEARED", "rationale": "x", "expected_version": 0},
        {"outcome": None, "rationale": "x", "expected_version": 1},
    ],
)
def test_invalid_or_incomplete_decisions_are_rejected(client, db, admin, finished, body):
    begin(client, admin, finished["id"])
    call(client, "POST", REVIEW.format(finished["id"]) + "/complete", admin, 422, body)
    assert db.scalar(select(AttemptReview)).status.value == "IN_REVIEW"
    assert db.scalar(select(func.count()).select_from(ReviewDecision)) == 0


def test_malformed_bodies_are_rejected(client, admin, finished):
    begin(client, admin, finished["id"])
    url = REVIEW.format(finished["id"]) + "/complete"
    response = client.post(url, headers={**admin, "Content-Type": "application/json"}, content=b"{not json")
    assert response.status_code == 422
    call(client, "POST", url, admin, 422, ["CLEARED"])
    call(client, "POST", REVIEW.format(finished["id"]) + "/notes", admin, 422, {"body": ""})
    call(client, "POST", REVIEW.format(finished["id"]) + "/notes", admin, 422, {"body": "x" * 4001})


# -- concurrency and immutability -------------------------------------------------------------------


def test_a_stale_decision_never_overwrites_another_admins(client, db, admin, other_admin, finished, users):
    begin(client, admin, finished["id"])
    seen = call(client, "GET", REVIEW.format(finished["id"]), other_admin["headers"], 200)["version"]

    decide(client, admin, finished["id"], "CLEARED", 1)  # admin A completes first
    error = decide(client, other_admin["headers"], finished["id"], "INVALIDATED", seen, expect=409)

    assert error["error"]["code"] == "review_conflict"
    assert error["error"]["details"]["outcome"] == "CLEARED"
    assert error["error"]["details"]["completed_by"] == users["admin"].name
    review = call(client, "GET", REVIEW.format(finished["id"]), admin, 200)
    assert review["outcome"] == "CLEARED" and len(review["decisions"]) == 1
    assert [r.action.value for r in audit_rows(db, finished["id"])] == ["REVIEW_STARTED", "REVIEW_COMPLETED"]


def test_a_completed_review_changes_only_by_an_audited_revision(
    client, db, admin, other_admin, finished, users
):
    begin(client, admin, finished["id"])
    decide(client, admin, finished["id"], "FLAGGED", 1)
    decide(client, admin, finished["id"], "CLEARED", 2, expect=409)  # completing again: refused

    error = decide(client, other_admin["headers"], finished["id"], "FLAGGED", 2, verb="revise", expect=422)
    assert error["error"]["details"][0]["field"] == "outcome"  # same outcome: a note, not a revision
    decide(client, other_admin["headers"], finished["id"], "CLEARED", 1, verb="revise", expect=409)  # stale

    body = decide(client, other_admin["headers"], finished["id"], "CLEARED", 2, verb="revise")
    assert body["outcome"] == "CLEARED" and body["version"] == 3 and body["status"] == "REVIEWED"
    assert [d["revision"] for d in body["decisions"]] == [2, 1]
    assert [d["outcome"] for d in body["decisions"]] == ["CLEARED", "FLAGGED"]  # v1 preserved
    assert body["decisions"][1]["decided_by"]["id"] == str(users["admin"].id)
    assert body["completed_by"]["id"] == str(other_admin["user"].id)

    revised = audit_rows(db, finished["id"])[-1]
    assert revised.action.value == "REVIEW_REVISED" and revised.actor_id == other_admin["user"].id
    assert revised.details["previous_outcome"] == "FLAGGED" and revised.details["outcome"] == "CLEARED"


def test_revising_an_open_review_is_refused(client, admin, finished):
    begin(client, admin, finished["id"])
    assert decide(client, admin, finished["id"], "CLEARED", 1, verb="revise", expect=409)["error"][
        "code"
    ] == ("review_conflict")


# -- notes ------------------------------------------------------------------------------------------


def test_notes_are_human_authored_immutable_and_never_logged(
    client, db, admin, other_admin, finished, caplog
):
    begin(client, admin, finished["id"])
    secret = "The multiple-face episode looks like a family member walking past."
    with caplog.at_level(logging.INFO, logger="assessx.review"):
        body = call(
            client,
            "POST",
            REVIEW.format(finished["id"]) + "/notes",
            other_admin["headers"],
            201,
            {"body": secret},
        )
    [note] = body["notes"]
    assert note["authored_by"] == "HUMAN" and note["body"] == secret
    assert note["author"]["id"] == str(other_admin["user"].id)

    for method in ("PATCH", "PUT", "DELETE"):
        assert (
            client.request(method, REVIEW.format(finished["id"]) + "/notes", headers=admin).status_code == 405
        )
        url = REVIEW.format(finished["id"]) + f"/notes/{note['note_id']}"
        assert client.request(method, url, headers=admin, json={"body": "edited"}).status_code in (404, 405)

    decide(client, admin, finished["id"], "NO_ACTION", 1)
    after = call(client, "POST", REVIEW.format(finished["id"]) + "/notes", admin, 201, {"body": "Follow-up."})
    assert [n["body"] for n in after["notes"]] == [secret, "Follow-up."]  # allowed after completion

    [added] = [r for r in audit_rows(db, finished["id"]) if r.action.value == "REVIEW_NOTE_ADDED"][:1]
    assert added.details == {"note_id": note["note_id"], "length": len(secret)}
    assert secret not in caplog.text and secret not in str(
        [r.details for r in audit_rows(db, finished["id"])]
    )


# -- evidence marks ---------------------------------------------------------------------------------


def test_marks_annotate_this_attempts_evidence_only(client, db, helpers: Helpers, admin, users, finished):
    add_rows(
        db,
        finished,
        [(E.PASTE_ATTEMPT, 60, {"shortcut": "CTRL+V"}), (E.COPY_ATTEMPT, 20, {"shortcut": "CTRL+C"})],
    )
    first, second = evidence_ids(client, admin, finished["id"])
    begin(client, admin, finished["id"])
    url = REVIEW.format(finished["id"]) + "/marks/{}"

    call(client, "PUT", url.format(first), admin, 200, {"mark": "CONFIRMED"})
    call(client, "PUT", url.format(first), admin, 200, {"mark": "CONFIRMED"})  # unchanged: no new record
    body = call(client, "PUT", url.format(first), admin, 200, {"mark": "DISMISSED"})
    assert [(m["evidence_id"], m["mark"]) for m in body["marks"]] == [(first, "DISMISSED")]

    # Another attempt's evidence id, an unknown id, a malformed id and an invalid mark.
    other_exam = proctored_exam(client, helpers, users)
    other = start(client, finished["headers"], other_exam["id"])
    activate(client, finished["headers"], other["id"])
    add_rows(db, {"attempt": other}, [(E.PASTE_ATTEMPT, 5, {"shortcut": "CTRL+V"})])
    foreign = evidence_ids(client, admin, other["id"])[0]
    call(client, "PUT", url.format(foreign), admin, 404, {"mark": "CONFIRMED"})
    call(client, "PUT", url.format(uuid.uuid4()), admin, 404, {"mark": "CONFIRMED"})
    call(client, "PUT", url.format("nope"), admin, 422, {"mark": "CONFIRMED"})
    call(client, "PUT", url.format(second), admin, 422, {"mark": "CHEATING"})

    marked = [r for r in audit_rows(db, finished["id"]) if r.action.value == "REVIEW_EVIDENCE_MARKED"]
    assert [(r.details["mark"], r.details.get("previous_mark")) for r in marked] == [
        ("CONFIRMED", None),
        ("DISMISSED", "CONFIRMED"),
    ]

    decide(client, admin, finished["id"], "CLEARED", 1)
    error = call(client, "PUT", url.format(second), admin, 409, {"mark": "CONFIRMED"})
    assert error["error"]["code"] == "review_conflict"  # marks are frozen once the outcome is recorded


# -- separation: 6A risk, 6B evidence, 6C decision --------------------------------------------------


def _stable(body: dict) -> dict:
    return {k: v for k, v in body.items() if k != "calculated_at"}


def test_the_review_reads_risk_and_evidence_and_changes_neither(client, db, admin, active):
    seed_high_risk(db, active)
    add_rows(db, active, [(E.PASTE_ATTEMPT, 100, {"shortcut": "CTRL+V"})])
    submit(client, active["headers"], active["id"])
    risk_url = f"/api/v1/admin/attempts/{active['id']}/risk"
    evidence_url = f"/api/v1/admin/attempts/{active['id']}/evidence"
    risk_before = call(client, "GET", risk_url, admin, 200)
    evidence_before = call(client, "GET", evidence_url, admin, 200)
    events_before = db.scalar(select(func.count()).select_from(ProctoringEvent))

    begin(client, admin, active["id"])
    first = evidence_before["items"][0]["evidence_id"]
    call(client, "PUT", REVIEW.format(active["id"]) + f"/marks/{first}", admin, 200, {"mark": "DISMISSED"})
    call(client, "POST", REVIEW.format(active["id"]) + "/notes", admin, 201, {"body": "Checked."})
    body = decide(client, admin, active["id"], "CLEARED", 1)

    basis = body["decisions"][0]["basis"]
    assert basis["risk_score"] == risk_before["current_score"] and basis["risk_level"] == risk_before["level"]
    assert (
        basis["peak_score"] == risk_before["peak_score"] and basis["peak_level"] == risk_before["peak_level"]
    )
    assert basis["policy_version"] == risk_before["policy_version"] == "6A-v1"
    assert basis["evidence_version"] == evidence_before["evidence_version"]
    assert basis["evidence_count"] == evidence_before["total"]
    assert basis["signal_count"] == risk_before["signal_count"]

    # A dismissed mark and a CLEARED outcome change nothing upstream.
    assert _stable(call(client, "GET", risk_url, admin, 200)) == _stable(risk_before)
    assert _stable(call(client, "GET", evidence_url, admin, 200)) == _stable(evidence_before)
    assert db.scalar(select(func.count()).select_from(ProctoringEvent)) == events_before


@pytest.mark.parametrize("outcome", OUTCOMES)
def test_a_high_risk_attempt_can_receive_any_outcome(client, db, admin, active, outcome):
    seed_high_risk(db, active)
    submit(client, active["headers"], active["id"])
    begin(client, admin, active["id"])
    body = decide(client, admin, active["id"], outcome, 1)
    assert body["decisions"][0]["basis"]["risk_level"] == "HIGH"
    assert body["outcome"] == outcome


@pytest.mark.parametrize("outcome", OUTCOMES)
def test_a_normal_risk_attempt_can_receive_any_outcome(client, admin, finished, outcome):
    begin(client, admin, finished["id"])
    body = decide(client, admin, finished["id"], outcome, 1)
    assert body["decisions"][0]["basis"]["risk_level"] == "NORMAL"
    assert body["outcome"] == outcome


def test_high_risk_alone_never_produces_an_outcome(client, db, admin, active):
    seed_high_risk(db, active)
    submit(client, active["headers"], active["id"])
    assert call(client, "GET", f"/api/v1/admin/attempts/{active['id']}/risk", admin, 200)["level"] == "HIGH"
    body = call(client, "GET", REVIEW.format(active["id"]), admin, 200)
    assert body["status"] == "UNREVIEWED" and body["outcome"] is None
    assert begin(client, admin, active["id"])["outcome"] is None
    assert db.scalar(select(func.count()).select_from(ReviewDecision)) == 0
    attempt = db.get(AssessmentAttempt, uuid.UUID(active["id"]))
    assert attempt.status.value == "SUBMITTED"  # an outcome never touches the attempt either


def test_invalidated_is_recorded_only(client, db, admin, finished):
    result_before = client.get(f"{ME}/attempts/{finished['id']}/result", headers=finished["headers"]).json()
    begin(client, admin, finished["id"])
    decide(client, admin, finished["id"], "INVALIDATED", 1)
    attempt = db.get(AssessmentAttempt, uuid.UUID(finished["id"]))
    assert attempt.status.value == "SUBMITTED"
    assert (
        client.get(f"{ME}/attempts/{finished['id']}/result", headers=finished["headers"]).json()
        == result_before
    )


# -- audit ------------------------------------------------------------------------------------------


def test_every_action_is_audited_with_allow_listed_details(client, db, admin, finished, users):
    add_rows(db, finished, [(E.PASTE_ATTEMPT, 30, {"shortcut": "CTRL+V"})])
    evidence = evidence_ids(client, admin, finished["id"])[0]
    begin(client, admin, finished["id"])
    call(client, "POST", REVIEW.format(finished["id"]) + "/notes", admin, 201, {"body": "Looked at it."})
    call(
        client, "PUT", REVIEW.format(finished["id"]) + f"/marks/{evidence}", admin, 200, {"mark": "CONFIRMED"}
    )
    decide(client, admin, finished["id"], "FLAGGED", 1)

    rows = audit_rows(db, finished["id"])
    assert [r.action.value for r in rows] == [
        "REVIEW_STARTED",
        "REVIEW_NOTE_ADDED",
        "REVIEW_EVIDENCE_MARKED",
        "REVIEW_COMPLETED",
    ]
    assert {r.actor_id for r in rows} == {users["admin"].id}
    assert {r.assessment_id for r in rows} == {uuid.UUID(finished["exam"]["id"])}
    completed = rows[-1].details
    assert completed["from_status"] == "IN_REVIEW" and completed["to_status"] == "REVIEWED"
    assert completed["outcome"] == "FLAGGED" and completed["revision"] == 1 and completed["version"] == 2
    allowed = {
        "to_status", "from_status", "version", "note_id", "length", "evidence_id", "mark", "previous_mark",
        "outcome", "previous_outcome", "revision", "risk_level", "risk_score", "policy_version",
    }  # fmt: skip
    assert all(set(r.details) <= allowed for r in rows)

    history = call(client, "GET", REVIEW.format(finished["id"]), admin, 200)["history"]
    assert [h["action"] for h in history] == [r.action.value for r in rows]
    assert history[0]["actor"] == {"id": str(users["admin"].id), "name": users["admin"].name}


def test_the_audit_log_is_append_only_at_the_database(client, db, admin, finished):
    begin(client, admin, finished["id"])
    row = audit_rows(db, finished["id"])[0]
    for statement in (
        "UPDATE audit_logs SET action = 'REVIEW_COMPLETED' WHERE id = :id",
        "DELETE FROM audit_logs WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match="append-only"), db.begin_nested():
            db.execute(text(statement), {"id": row.id})
    assert len(audit_rows(db, finished["id"])) == 1


def test_the_audit_record_survives_the_attempt_being_deleted(client, db, admin, finished):
    begin(client, admin, finished["id"])
    decide(client, admin, finished["id"], "FLAGGED", 1)
    call(client, "DELETE", f"/api/v1/assessments/{finished['exam']['id']}", admin, 204)
    db.expire_all()

    assert db.get(AssessmentAttempt, uuid.UUID(finished["id"])) is None
    assert db.scalar(select(func.count()).select_from(AttemptReview)) == 0
    rows = audit_rows(db, finished["id"])
    assert [r.action.value for r in rows] == ["REVIEW_STARTED", "REVIEW_COMPLETED"]
    assert rows[-1].details["outcome"] == "FLAGGED"


# -- database constraints ---------------------------------------------------------------------------


def _insert_review(db, attempt_id: str, admin_id, **columns) -> None:
    values = {
        "id": uuid.uuid4(),
        "attempt_id": uuid.UUID(attempt_id),
        "status": "IN_REVIEW",
        "outcome": None,
        "version": 1,
        "started_by_id": admin_id,
        "started_at": utcnow(),
        "completed_by_id": None,
        "completed_at": None,
        "created_at": utcnow(),
        "updated_at": utcnow(),
        **columns,
    }
    db.execute(
        text(
            "INSERT INTO attempt_reviews (id, attempt_id, status, outcome, version, started_by_id, "
            "started_at, completed_by_id, completed_at, created_at, updated_at) VALUES (:id, :attempt_id, "
            ":status, :outcome, :version, :started_by_id, :started_at, :completed_by_id, :completed_at, "
            ":created_at, :updated_at)"
        ),
        values,
    )


@pytest.mark.parametrize(
    "columns",
    [
        {"status": "UNREVIEWED"},
        {"status": "REVIEWED"},  # no outcome, no completer
        {"outcome": "CLEARED"},  # an outcome on an open review
        {"status": "REVIEWED", "outcome": "CHEATED"},
        {"version": 0},
        {"started_by_id": uuid.uuid4()},
    ],
)
def test_the_database_enforces_valid_review_states(db, users, finished, columns):
    with pytest.raises(IntegrityError), db.begin_nested():
        _insert_review(db, finished["id"], users["admin"].id, **columns)


def test_the_database_allows_one_review_per_attempt_and_unique_revisions(client, db, users, admin, finished):
    begin(client, admin, finished["id"])
    with pytest.raises(IntegrityError), db.begin_nested():
        _insert_review(db, finished["id"], users["admin"].id)
    decide(client, admin, finished["id"], "CLEARED", 1)
    review = db.scalar(select(AttemptReview))
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO review_decisions (id, review_id, revision, outcome, rationale, decided_by_id, "
                "decided_at, policy_version, evidence_version, risk_as_of, risk_score, risk_level, "
                "peak_score, peak_level, signal_count, evidence_count, episode_count) VALUES (:id, :rid, 1, "
                "'FLAGGED', 'x', :uid, now(), '6A-v1', '6B-v1', now(), 0, 'NORMAL', 0, 'NORMAL', 0, 0, 0)"
            ),
            {"id": uuid.uuid4(), "rid": review.id, "uid": users["admin"].id},
        )
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO review_notes (id, review_id, author_id, body, created_at) "
                "VALUES (:id, :rid, :uid, '', now())"
            ),
            {"id": uuid.uuid4(), "rid": review.id, "uid": users["admin"].id},
        )


# -- the queue --------------------------------------------------------------------------------------


def _another_finished_attempt(client, db, helpers: Helpers, users, headers) -> dict:
    exam = proctored_exam(client, helpers, users)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    submit(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "id": attempt["id"]}


def test_the_queue_lists_proctored_attempts_with_risk_and_review_side_by_side(
    client, db, helpers: Helpers, users, admin, active
):
    seed_high_risk(db, active)
    submit(client, active["headers"], active["id"])
    second = _another_finished_attempt(client, db, helpers, users, active["headers"])
    third = _another_finished_attempt(client, db, helpers, users, active["headers"])
    unproctored = unproctored_exam(client, helpers, users)
    start(client, active["headers"], unproctored["id"])

    begin(client, admin, second["id"])
    begin(client, admin, active["id"])
    decide(client, admin, active["id"], "CLEARED", 1)

    body = call(client, "GET", QUEUE, admin, 200)
    assert body["counts"] == {"UNREVIEWED": 1, "IN_REVIEW": 1, "REVIEWED": 1}
    by_id = {item["attempt_id"]: item for item in body["items"]}
    assert set(by_id) == {active["id"], second["id"], third["id"]}  # unproctored attempts are not listed
    high = by_id[active["id"]]
    assert (
        high["risk_level"] == "HIGH" and high["review_status"] == "REVIEWED" and high["outcome"] == "CLEARED"
    )
    assert high["reviewed_by"]["id"] == str(users["admin"].id)
    assert by_id[third["id"]]["review_status"] == "UNREVIEWED" and by_id[third["id"]]["outcome"] is None
    assert "email" not in str(body)

    only = call(client, "GET", QUEUE + "?review_status=UNREVIEWED", admin, 200)
    assert [i["attempt_id"] for i in only["items"]] == [third["id"]]
    assert only["counts"] == body["counts"]  # counts ignore the status filter
    by_exam = call(client, "GET", QUEUE + f"?assessment_id={second['exam']['id']}", admin, 200)
    assert [i["attempt_id"] for i in by_exam["items"]] == [second["id"]]
    assert by_exam["counts"] == {"UNREVIEWED": 0, "IN_REVIEW": 1, "REVIEWED": 0}
    future = (utcnow() + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    assert (
        call(client, "GET", QUEUE, admin, 200, None)
        and client.get(QUEUE, params={"finished_from": future}, headers=admin).json()["items"] == []
    )
    call(client, "GET", QUEUE + "?review_status=CHEATED", admin, 422)
    call(client, "GET", QUEUE + "?limit=51", admin, 422)
    call(client, "GET", QUEUE + "?cursor=%21%21", admin, 422)


def test_the_queue_pages_completely_without_n_plus_one(client, db, helpers: Helpers, users, admin, active):
    submit(client, active["headers"], active["id"])
    ids = {active["id"]}
    for _ in range(3):
        ids.add(_another_finished_attempt(client, db, helpers, users, active["headers"])["id"])

    seen, cursor = [], None
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = client.get(QUEUE, params=params, headers=admin).json()
        seen += [i["attempt_id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 4 and set(seen) == ids

    statements, stop = count_queries(db)
    client.get(QUEUE, params={"limit": 1}, headers=admin)
    one = len(statements)
    statements.clear()
    client.get(QUEUE, params={"limit": 4}, headers=admin)
    stop()
    assert len(statements) == one  # one events query for the whole page

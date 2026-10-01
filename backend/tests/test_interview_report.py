# ruff: noqa: F811 — pytest fixtures are imported from tests.test_interview_adaptive_api
"""Phase 7C: the interview report — built from stored data only, never re-evaluated, never invented.

What is asserted: the aggregation policy (half-up means, percentages, the evaluation state); a complete
report's figures equal the stored 7B evaluations (one authoritative scoring policy), with follow-ups shown
but excluded from the AI score; NOT_ANSWERED, ANSWERED_NOT_EVALUATED, EVALUATION_PENDING and EVALUATED
are distinct; a failed or unavailable evaluation is excluded, never counted as zero, and the score is
marked partial; completion is a completion figure, not a score; the adaptive timeline shows the policy's
recorded decisions; building a report never calls the evaluator; the queue is filtered, paginated, never
ordered by score, and its query count does not grow with the page; and nobody but an administrator can
read any of it.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.interview_evaluation import EvaluationStatus, InterviewEvaluation
from app.services.interview.llm import StubProvider
from app.services.interview.report import evaluation_state, mean_half_up, percent
from tests.test_interview_adaptive_api import (  # noqa: F401 — fixtures
    Failing,
    Recording,
    Stuck,
    admin,
    answer,
    candidate,
    install,
    interview,
    read,
    start,
)
from tests.test_interview_config import BASE, ME, call
from tests.test_risk_api import count_queries

SESSIONS = f"{ME}/interview-sessions"
S = EvaluationStatus


def report_url(interview_id, session_id) -> str:
    return f"{BASE}/{interview_id}/sessions/{session_id}/report"


def get_report(client, admin, interview_id, state) -> dict:
    return call(client, "GET", report_url(interview_id, state["session_id"]), admin, 200)


def finish(client, candidate, state, *texts) -> dict:
    """Answer the given texts in turn (reading the state after each, so evaluations land)."""
    for text in texts:
        answer(client, candidate, state, text=text)
        state = read(client, candidate, state)
    return state


# -- the aggregation policy (pure) ---------------------------------------------------------------------


def test_the_aggregation_policy_is_exact():
    assert mean_half_up([]) is None
    assert mean_half_up([70, 75]) == 73  # 72.5 → 73 (half up)
    assert mean_half_up([90, 20, 60]) == 57  # 56.67
    assert percent(8, 10) == 80 and percent(2, 3) == 67 and percent(0, 0) == 0
    assert evaluation_state([]) == "NONE"
    assert evaluation_state([S.COMPLETED, S.COMPLETED]) == "COMPLETE"
    assert evaluation_state([S.COMPLETED, S.FAILED]) == "PARTIAL"
    assert evaluation_state([S.FAILED, S.UNAVAILABLE, None]) == "NONE"
    assert evaluation_state([S.COMPLETED, S.PENDING]) == "PENDING"


# -- a complete report ---------------------------------------------------------------------------------


def test_a_complete_report_is_the_stored_data_and_follow_ups_are_not_averaged(
    client,
    db,
    admin,
    candidate,
    users,
    install,
):
    install()
    ctx = interview(
        client, admin, users, adaptive=True, follow_up_on=("EASY1", "EASY2", "MEDIUM1", "MEDIUM2", "HARD1")
    )
    state = start(client, candidate, ctx["id"])
    state = finish(
        client,
        candidate,
        state,
        "[[stub:strong]] Strong answer.",  # MEDIUM1 → 90, harder next, no follow-up
        "[[stub:weak]] Weak answer.",  # HARD → 20, follow-up asked, easier next
        "[[stub:strong]] Strong follow-up answer.",  # the follow-up → 90 (shown, not averaged)
        "Middling answer.",  # MEDIUM → 60, follow-up (60 < 70)
        "Middling follow-up.",
    )
    assert state["status"] == "COMPLETED"
    report = get_report(client, admin, ctx["id"], state)

    summary = report["summary"]
    assert summary["planned_primaries"] == 3 and summary["answered_primaries"] == 3
    assert summary["follow_ups_asked"] == 2 and summary["follow_ups_answered"] == 2
    assert summary["evaluation_state"] == "COMPLETE" and summary["ai_score_partial"] is False
    assert summary["ai_score"] == mean_half_up([90, 20, 60]) == 57  # primaries only
    assert summary["completion_percent"] == 100 and summary["source"] == "AI"
    assert "does not make hiring decisions" in summary["note"]
    assert summary["models"] == ["stub/stub"] and summary["rubric_versions"] == ["technical-v1"]
    assert summary["dimension_means"]["technical-v1"]["correctness"] == pytest.approx(
        (9 + 2 + 6) / 3, abs=0.05
    )

    # One authoritative policy: every per-question score is the stored 7B value.
    stored = {e.item_id: e.overall_score for e in db.scalars(select(InterviewEvaluation))}
    for q in report["questions"]:
        assert q["answer_state"] == "EVALUATED"
        assert q["evaluation"]["overall_score"] == stored[uuid.UUID(q["item_id"])]
    kinds = [(q["kind"], q["number"]) for q in report["questions"]]
    assert kinds == [("PRIMARY", 1), ("PRIMARY", 2), ("FOLLOW_UP", 2), ("PRIMARY", 3), ("FOLLOW_UP", 3)]
    assert report["questions"][0]["expected_concepts"]  # admin report shows the rubric context

    # The adaptive timeline: the policy's recorded decisions, not AI reasoning.
    timeline = report["timeline"]
    assert (
        timeline[0]["decision"]["difficulty_change"] == 1
        and timeline[0]["decision"]["reason"] == "strong_answer"
    )
    assert timeline[1]["decision"]["follow_up"] is True and timeline[1]["decision"]["difficulty_change"] == -1
    assert [t["selected_by"] for t in timeline] == ["PLAN", "ADAPTIVE", "ADAPTIVE", "ADAPTIVE", "ADAPTIVE"]

    [topic] = report["topics"]
    assert topic["topic"] == "Python" and topic["asked"] == 3 and topic["ai_score"] == 57
    assert (
        report["candidate"]["name"] == users["candidate"].name and report["proctoring"]["applicable"] is False
    )
    assert report["review"]["status"] == "UNREVIEWED" and report["review"]["blocked_reason"] is None


def test_unanswered_and_unevaluated_answers_are_distinct_and_never_zero(
    client,
    db,
    admin,
    candidate,
    users,
    install,
):
    install(Failing())  # every evaluation fails
    ctx = interview(client, admin, users, adaptive=False, question_count=3)
    state = start(client, candidate, ctx["id"])
    state = finish(client, candidate, state, "Answer one.")
    ended = call(client, "POST", f"{SESSIONS}/{state['session_id']}/complete", candidate, 200)
    report = get_report(client, admin, ctx["id"], ended)

    states = [q["answer_state"] for q in report["questions"]]
    assert states == ["ANSWERED_NOT_EVALUATED", "NOT_ANSWERED"]
    assert report["questions"][0]["evaluation"]["status"] == "FAILED"
    assert report["questions"][0]["evaluation"]["overall_score"] is None
    summary = report["summary"]
    assert summary["ai_score"] is None and summary["evaluation_state"] == "NONE"  # not 0
    assert summary["answered_primaries"] == 1 and summary["planned_primaries"] == 3
    assert summary["completion_percent"] == 33  # completion — not a score
    assert report["session"]["completion_reason"] == "ENDED_BY_CANDIDATE"


def test_a_partial_evaluation_is_labelled_partial(client, db, admin, candidate, users, install):
    install()
    ctx = interview(client, admin, users, adaptive=False, question_count=2)
    state = start(client, candidate, ctx["id"])
    state = finish(client, candidate, state, "[[stub:strong]] Good.", "[[stub:invalid]] Bad output.")
    report = get_report(client, admin, ctx["id"], state)
    s = report["summary"]
    assert s["evaluation_state"] == "PARTIAL" and s["ai_score_partial"] is True
    assert s["ai_score"] == 90 and s["evaluated_primaries"] == 1 and s["answered_primaries"] == 2


def test_pending_evaluations_are_shown_and_block_the_outcome(client, db, admin, candidate, users, install):
    install(runner_cls=Stuck)
    ctx = interview(
        client, admin, users, adaptive=False, question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    report = get_report(client, admin, ctx["id"], state)
    assert report["questions"][0]["answer_state"] == "EVALUATION_PENDING"
    assert report["summary"]["evaluation_state"] == "PENDING"


def test_without_an_evaluator_the_report_has_no_ai_score(client, admin, candidate, users):
    ctx = interview(
        client, admin, users, adaptive=False, question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    state = start(client, candidate, ctx["id"])
    answer(client, candidate, state)
    report = get_report(client, admin, ctx["id"], read(client, candidate, state))
    assert report["summary"]["ai_score"] is None and report["summary"]["evaluation_state"] == "NONE"
    assert report["questions"][0]["evaluation"]["status"] == "UNAVAILABLE"


def test_building_a_report_never_calls_the_evaluator(client, db, admin, candidate, users, install):
    runner = install(Recording(StubProvider()))
    ctx = interview(
        client, admin, users, adaptive=False, question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    state = start(client, candidate, ctx["id"])
    state = finish(client, candidate, state, "An answer.")
    calls = len(runner.provider.requests)
    for _ in range(3):
        get_report(client, admin, ctx["id"], state)
    assert len(runner.provider.requests) == calls
    assert db.scalar(select(func.count()).select_from(InterviewEvaluation)) == 1


# -- access ----------------------------------------------------------------------------------------------


def test_only_administrators_can_read_reports_and_ids_are_checked(
    client,
    admin,
    candidate,
    users,
    install,
):
    install()
    ctx = interview(
        client, admin, users, adaptive=False, question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    other = interview(
        client,
        admin,
        users,
        adaptive=False,
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
        title="Other",
    )
    state = start(client, candidate, ctx["id"])
    call(client, "GET", report_url(ctx["id"], state["session_id"]), candidate, 403)
    call(client, "GET", report_url(ctx["id"], state["session_id"]), None, 401)
    call(client, "GET", f"{BASE}/reports", candidate, 403)
    call(client, "GET", report_url(other["id"], state["session_id"]), admin, 404)  # wrong interview
    call(client, "GET", report_url(ctx["id"], uuid.uuid4()), admin, 404)
    call(client, "GET", report_url(ctx["id"], "not-a-uuid"), admin, 422)
    # Candidate endpoints never carry report or review material.
    body = str(read(client, candidate, state)) + str(call(client, "GET", f"{ME}/interviews", candidate, 200))
    for hidden in ("ai_score", "review", "outcome", "expected_concepts", "note"):
        assert hidden not in body


# -- the queue ---------------------------------------------------------------------------------------


def test_the_queue_filters_pages_and_is_never_ranked(client, db, admin, candidate, users, install):
    install()
    first = interview(
        client,
        admin,
        users,
        adaptive=False,
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
        title="First",
    )
    second = interview(
        client,
        admin,
        users,
        adaptive=False,
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
        title="Second",
    )
    s1 = finish(client, candidate, start(client, candidate, first["id"]), "[[stub:weak]] a")
    s2 = start(client, candidate, second["id"])

    body = call(client, "GET", f"{BASE}/reports", admin, 200)
    assert [i["session_id"] for i in body["items"]] == [s2["session_id"], s1["session_id"]]  # newest first
    assert body["counts"] == {"UNREVIEWED": 2, "IN_REVIEW": 0, "REVIEWED": 0}
    row = next(i for i in body["items"] if i["session_id"] == s1["session_id"])
    assert (
        row["ai_score"] == 20
        and row["evaluation_state"] == "COMPLETE"
        and row["review_status"] == "UNREVIEWED"
    )
    assert "never ranked" in body["note"]

    def only(**params):
        items = client.get(f"{BASE}/reports", params=params, headers=admin).json()["items"]
        return [i["session_id"] for i in items]

    assert only(session_status="ACTIVE") == [s2["session_id"]]
    assert only(evaluation_state="COMPLETE") == [s1["session_id"]]
    assert only(evaluation_state="NONE") == [s2["session_id"]]
    assert only(interview_id=first["id"]) == [s1["session_id"]]
    assert only(review_status="REVIEWED") == []
    page = client.get(f"{BASE}/reports", params={"limit": 1}, headers=admin).json()
    rest = client.get(
        f"{BASE}/reports", params={"limit": 1, "cursor": page["next_cursor"]}, headers=admin
    ).json()
    assert [i["session_id"] for i in page["items"] + rest["items"]] == [s2["session_id"], s1["session_id"]]
    call(client, "GET", f"{BASE}/reports?limit=51", admin, 422)
    call(client, "GET", f"{BASE}/reports?cursor=%21%21", admin, 422)
    call(client, "GET", f"{BASE}/reports?review_status=HIRED", admin, 422)

    statements, stop = count_queries(db)
    client.get(f"{BASE}/reports", params={"limit": 1}, headers=admin)
    one = len(statements)
    statements.clear()
    client.get(f"{BASE}/reports", params={"limit": 2}, headers=admin)
    stop()
    assert len(statements) == one  # the page's scores come from one query, not one per row

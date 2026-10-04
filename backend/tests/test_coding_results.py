"""Coding assessments, stage C4: scoring, results, coding activity events, analytics, the paste policy.

What is asserted:
* **Scoring.** A coding question scores from its best judged submission. With partial scoring the
  marks are `floor(marks × passed weight / total weight)` — never rounded up; without it, only an
  accepted submission scores. An accepted submission is full marks whatever came after it.
* **Sections.** Results carry MCQ and coding totals (None for a kind the exam does not have), and each
  coding question's tests passed / total, verdict and language — never which tests, never the code.
* **Being evaluated.** An exam that ends with a submission still being judged has no result yet: the
  candidate sees "being evaluated", and the result is produced when the runner reports. A submission
  that is never judged is failed as a system error after the wait and the result produced without it.
* **Events.** Runs, submissions and language changes are recorded by the server on a proctored attempt;
  the client may report only opening a problem and pasting into the editor. These are facts on the
  timeline, never risk signals.
* **Analytics.** Administrators only; computed from stored rows; candidates listed by name, never ranked.
* **Paste policy.** An assessment setting (off by default) that the attempt carries to the app.
"""

# ruff: noqa: F811 — pytest fixtures imported from another test module

import uuid
from datetime import timedelta
from types import SimpleNamespace

from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import get_settings
from app.models.attempt import AssessmentAttempt
from app.models.code_execution import CodeExecution
from app.models.coding import CodingProblemVersion
from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent
from app.services.evaluation import AnswerOutcome, CodingBest, coding_marks, score_coding
from app.services.risk import policy
from tests.conftest import Helpers
from tests.test_assessments import candidate_headers, create_assessment
from tests.test_attempts import ME, start
from tests.test_code_execution import RUNNER, SOURCE, admin, claim, report  # noqa: F401
from tests.test_coding_problems import HIDDEN_INPUT, HIDDEN_OUTPUT, call, published
from tests.test_proctoring import activate
from tests.test_questions import MCQ, add_question


def exam(client, helpers: Helpers, users, admin, monkeypatch, *, mixed=False, proctored=False) -> dict:
    """A published coding (or mixed: one 2-mark MCQ, then the problem) assessment with results shown,
    started by the candidate."""
    _, version = published(client, admin)
    monkeypatch.setattr(get_settings(), "runner_token", SecretStr("test-runner-token-0123456789-abcdefghij"))
    monkeypatch.setattr(get_settings(), "coding_execution_enabled", True)
    assessment = create_assessment(
        client,
        admin,
        assessment_type="MIXED" if mixed else "CODING",
        total_marks=12 if mixed else 10,
        passing_marks=5,
    )
    aid = assessment["id"]
    if mixed:
        add_question(client, admin, aid, MCQ)
    question = call(
        client,
        "POST",
        f"/api/v1/assessments/{aid}/coding-questions",
        admin,
        201,
        {"problem_version_id": version},
    )
    call(
        client,
        "PATCH",
        f"/api/v1/assessments/{aid}",
        admin,
        200,
        {"show_results": True, "proctoring_required": proctored},
    )
    call(client, "POST", f"/api/v1/assessments/{aid}/ready", admin, 200)
    call(client, "POST", f"/api/v1/assessments/{aid}/publish", admin, 200)
    call(
        client,
        "POST",
        f"/api/v1/assessments/{aid}/assignments",
        admin,
        201,
        {"candidate_ids": [str(users["candidate"].id)]},
    )
    candidate = candidate_headers(helpers)
    attempt = start(client, candidate, aid)
    if proctored:
        activate(client, candidate, attempt["id"])
    return {
        "assessment": assessment,
        "version": version,
        "attempt": attempt,
        "question": question,
        "base": f"{ME}/attempts/{attempt['id']}/coding/{question['id']}",
        "candidate": candidate,
    }


def submit_code(client, ctx, **body) -> dict:
    return call(
        client,
        "POST",
        f"{ctx['base']}/submissions",
        ctx["candidate"],
        201,
        {"language": "python", "source": SOURCE, **body},
    )


def judged(client, ctx, *, public_ok=True, hidden_ok=True, **body) -> dict:
    """Submits and has the runner report: each test passes or prints a wrong answer."""
    queued = submit_code(client, ctx, **body)
    job = claim(client)
    assert job["id"] == queued["id"]
    hidden = next(t["id"] for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    public = next(t["id"] for t in job["tests"] if t["id"] != hidden)
    report(
        client,
        job,
        {public: "3\n" if public_ok else "wrong", hidden: HIDDEN_OUTPUT if hidden_ok else "wrong"},
    )
    return queued


def finish(client, ctx) -> dict:
    return call(client, "POST", f"{ME}/attempts/{ctx['attempt']['id']}/submit", ctx["candidate"], 200)


def result(client, ctx) -> dict:
    return call(client, "GET", f"{ME}/attempts/{ctx['attempt']['id']}/result", ctx["candidate"], 200)


# -- the arithmetic -----------------------------------------------------------------------------------------


def best(verdict="WRONG_ANSWER", passed_weight=0, total_weight=4, language="python") -> CodingBest:
    return CodingBest(uuid.uuid4(), verdict, passed_weight, 2, passed_weight, total_weight, language)


def question(marks=10, partial=True):
    return SimpleNamespace(
        id=uuid.uuid4(), position=0, marks=marks, coding_version=SimpleNamespace(partial_scoring=partial)
    )


def test_partial_marks_are_proportional_to_the_weight_passed_and_rounded_down():
    assert coding_marks(10, True, best(passed_weight=3)) == 7  # 7.5 → 7, never over-awarded
    assert coding_marks(10, True, best(passed_weight=1)) == 2
    assert coding_marks(10, True, best(passed_weight=0)) == 0
    assert coding_marks(10, True, best(verdict="ACCEPTED", passed_weight=4)) == 10
    assert coding_marks(10, True, best(passed_weight=0, total_weight=0)) == 0  # nothing to divide
    assert coding_marks(10, False, best(passed_weight=3)) == 0  # all-or-nothing
    assert coding_marks(10, False, best(verdict="ACCEPTED", passed_weight=4)) == 10


def test_a_coding_question_scores_from_its_best_submission():
    q = question()
    accepted = best(verdict="ACCEPTED", passed_weight=4)
    outcome = score_coding(q, [best(passed_weight=1), accepted, best(passed_weight=3)])
    assert (
        outcome.marks_awarded == 10
        and outcome.outcome is AnswerOutcome.CORRECT
        and outcome.coding is accepted
    )
    partial = score_coding(q, [best(passed_weight=1), best(passed_weight=3)])
    assert partial.marks_awarded == 7 and partial.outcome is AnswerOutcome.PARTIAL
    assert score_coding(question(partial=False), [best(passed_weight=3)]).outcome is AnswerOutcome.INCORRECT
    none = score_coding(q, [])
    assert none.outcome is AnswerOutcome.UNANSWERED and none.question_type == "CODING" and none.coding is None
    # Ties go to the earliest submission.
    first, second = best(passed_weight=3), best(passed_weight=3)
    assert score_coding(q, [first, second]).coding is first


def test_coding_activity_is_never_a_risk_signal():
    for name in (
        "CODING_QUESTION_OPENED",
        "CODE_PASTED",
        "CODE_RUN_REQUESTED",
        "CODE_SUBMITTED",
        "CODE_LANGUAGE_CHANGED",
    ):
        assert any(t.value == name for t in policy.EXCLUDED)


# -- results ------------------------------------------------------------------------------------------------


def test_a_partial_submission_scores_partial_marks_and_the_best_one_counts(
    client, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    judged(client, ctx, public_ok=False)  # the hidden test (weight 3 of 4) passes
    judged(client, ctx, public_ok=False, hidden_ok=False)  # a worse one later changes nothing
    finish(client, ctx)
    body = result(client, ctx)
    assert body["evaluating"] is False and (body["score"], body["maximum_score"]) == (7, 10)
    assert (body["coding_score"], body["coding_maximum"]) == (7, 10)
    assert body["mcq_score"] is None and body["mcq_maximum"] is None and body["partial_count"] == 1
    [line] = body["questions"]
    assert line["kind"] == "CODING" and line["outcome"] == "PARTIAL" and line["marks_awarded"] == 7
    assert (line["tests_passed"], line["tests_total"], line["verdict"], line["language"]) == (
        1,
        2,
        "WRONG_ANSWER",
        "python",
    )
    text = str(body)
    assert SOURCE not in text and HIDDEN_INPUT not in text and HIDDEN_OUTPUT not in text


def test_without_partial_scoring_only_an_accepted_submission_scores(
    client, db, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    db.get(CodingProblemVersion, uuid.UUID(ctx["version"])).partial_scoring = False
    db.flush()
    judged(client, ctx, public_ok=False)
    finish(client, ctx)
    body = result(client, ctx)
    assert (
        body["score"] == 0 and body["questions"][0]["outcome"] == "INCORRECT" and body["partial_count"] == 0
    )


def test_a_mixed_exam_reports_mcq_and_coding_sections(client, helpers: Helpers, users, admin, monkeypatch):
    ctx = exam(client, helpers, users, admin, monkeypatch, mixed=True)
    mcq = next(q for q in ctx["attempt"]["questions"] if q["type"] == "MCQ")
    call(
        client,
        "PUT",
        f"{ME}/attempts/{ctx['attempt']['id']}/answers/{mcq['id']}",
        ctx["candidate"],
        200,
        {"selected_option_ids": [mcq["options"][1]["id"]]},
    )
    judged(client, ctx)
    finish(client, ctx)
    body = result(client, ctx)
    assert (body["score"], body["maximum_score"]) == (12, 12)
    assert (body["mcq_score"], body["mcq_maximum"], body["coding_score"], body["coding_maximum"]) == (
        2,
        2,
        10,
        10,
    )
    assert [q["kind"] for q in body["questions"]] == ["OBJECTIVE", "CODING"]
    assert body["questions"][0]["verdict"] is None and body["questions"][1]["verdict"] == "ACCEPTED"

    summary = call(client, "GET", f"{ME}/results", ctx["candidate"], 200)[0]
    assert (summary["mcq_score"], summary["coding_score"]) == (2, 10)
    admin_view = call(client, "GET", f"/api/v1/assessments/{ctx['assessment']['id']}/results", admin, 200)
    row = next(r for r in admin_view["results"] if r["attempt_id"] == ctx["attempt"]["id"])
    assert (row["mcq_score"], row["mcq_maximum"], row["coding_score"], row["coding_maximum"]) == (
        2,
        2,
        10,
        10,
    )


def test_an_unattempted_coding_question_is_unanswered(client, helpers: Helpers, users, admin, monkeypatch):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    finish(client, ctx)
    body = result(client, ctx)
    assert body["score"] == 0 and body["unanswered_count"] == 1
    assert body["questions"][0]["kind"] == "CODING" and body["questions"][0]["tests_total"] is None


# -- being evaluated ----------------------------------------------------------------------------------------


def test_a_result_waits_for_a_submission_still_being_judged(
    client, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    queued = submit_code(client, ctx)
    finish(client, ctx)
    waiting = result(client, ctx)
    assert waiting["evaluating"] is True and waiting["score"] is None and waiting["questions"] == []
    admin_view = call(client, "GET", f"/api/v1/assessments/{ctx['assessment']['id']}/results", admin, 200)
    assert all(r["attempt_id"] != ctx["attempt"]["id"] for r in admin_view["results"])

    job = claim(client)  # the runner still judges a submission made before the exam ended
    assert job["id"] == queued["id"]
    hidden = next(t["id"] for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    assert report(client, job, {hidden: HIDDEN_OUTPUT}).status_code == 204
    done = result(client, ctx)
    assert (
        done["evaluating"] is False and done["score"] == 10 and done["questions"][0]["verdict"] == "ACCEPTED"
    )


def test_a_submission_never_judged_is_failed_after_the_wait(
    client, db, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    queued = submit_code(client, ctx)
    finish(client, ctx)
    attempt = db.get(AssessmentAttempt, uuid.UUID(ctx["attempt"]["id"]))
    attempt.finalized_at = attempt.finalized_at - timedelta(minutes=11)
    db.flush()
    body = result(client, ctx)
    assert body["evaluating"] is False and body["score"] == 0  # never the candidate's fault, never a pass
    row = db.get(CodeExecution, uuid.UUID(queued["id"]))
    assert row.status.value == "FAILED" and row.verdict.value == "SYSTEM_ERROR"


# -- coding activity events ---------------------------------------------------------------------------------


def coding_events(db, ctx) -> list[ProctoringEvent]:
    session = db.scalar(
        select(ProctoringSession).where(ProctoringSession.attempt_id == uuid.UUID(ctx["attempt"]["id"]))
    )
    return list(
        db.scalars(
            select(ProctoringEvent)
            .where(ProctoringEvent.session_id == session.id, ProctoringEvent.category == "CODING")
            .order_by(ProctoringEvent.recorded_at)
        )
    )


def post_event(client, ctx, event_type: str, metadata: dict, expect: int = 201):
    response = client.post(
        f"{ME}/attempts/{ctx['attempt']['id']}/proctoring/events",
        json={"client_event_id": str(uuid.uuid4()), "event_type": event_type, "metadata": metadata},
        headers=ctx["candidate"],
    )
    assert response.status_code == expect, response.text


def test_runs_submissions_and_language_changes_are_recorded_by_the_server(
    client, db, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch, proctored=True)
    call(client, "PUT", f"{ctx['base']}/draft", ctx["candidate"], 200, {"language": "python", "source": "x"})
    call(
        client,
        "PUT",
        f"{ctx['base']}/draft",
        ctx["candidate"],
        200,
        {"language": "cpp", "source": "int main(){}", "base_revision": 1},
    )
    call(
        client, "POST", f"{ctx['base']}/runs", ctx["candidate"], 201, {"language": "python", "source": SOURCE}
    )
    report(client, claim(client))
    submit_code(client, ctx, language="java")
    events = [(e.event_type.value, e.details, e.source.value) for e in coding_events(db, ctx)]
    assert events == [
        (
            "CODE_LANGUAGE_CHANGED",
            {"question_number": 1, "language": "cpp", "previous_language": "python"},
            "SERVER",
        ),
        ("CODE_RUN_REQUESTED", {"question_number": 1, "language": "python", "custom_input": False}, "SERVER"),
        ("CODE_SUBMITTED", {"question_number": 1, "language": "java"}, "SERVER"),
    ]
    assert SOURCE not in str(events)  # the code itself is never an event


def test_the_client_reports_only_opening_a_problem_and_pasting(
    client, db, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch, proctored=True)
    post_event(client, ctx, "CODING_QUESTION_OPENED", {"question_number": 1})
    post_event(client, ctx, "CODE_PASTED", {"question_number": 1, "length": 42})
    post_event(client, ctx, "CODE_PASTED", {"question_number": 1, "text": "pasted code"}, expect=422)
    for server_only in ("CODE_SUBMITTED", "CODE_RUN_REQUESTED", "CODE_LANGUAGE_CHANGED"):
        post_event(client, ctx, server_only, {"question_number": 1}, expect=422)
    assert [e.event_type.value for e in coding_events(db, ctx)] == ["CODING_QUESTION_OPENED", "CODE_PASTED"]


def test_an_unproctored_attempt_records_no_coding_events(
    client, db, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    submit_code(client, ctx)
    events = db.scalars(
        select(ProctoringEvent)
        .join(ProctoringSession, ProctoringEvent.session_id == ProctoringSession.id)
        .where(ProctoringSession.attempt_id == uuid.UUID(ctx["attempt"]["id"]))
    ).all()
    assert events == []


# -- analytics ----------------------------------------------------------------------------------------------


def test_coding_analytics_are_facts_for_administrators_only(
    client, helpers: Helpers, users, admin, monkeypatch
):
    ctx = exam(client, helpers, users, admin, monkeypatch)
    judged(client, ctx, public_ok=False)
    judged(client, ctx)
    finish(client, ctx)
    path = f"/api/v1/assessments/{ctx['assessment']['id']}/coding-analytics"
    call(client, "GET", path, ctx["candidate"], 403)
    body = call(client, "GET", path, admin, 200)

    [q] = body["questions"]
    assert (q["number"], q["coding_number"], q["candidates_attempted"], q["submissions"]) == (1, 1, 1, 2)
    assert q["acceptance_rate"] == "50.00" and q["solved_rate"] == "100.00" and q["average_score"] == "10.00"
    assert q["languages"] == {"python": 2} and q["common_failure"] == "WRONG_ANSWER"
    [c] = body["candidates"]
    assert c["submissions"] == 2 and c["pass_rate"] == "50.00" and c["languages"] == ["python"]
    assert (c["coding_score"], c["coding_maximum"]) == (10, 10)
    assert c["problems"][0]["best_verdict"] == "ACCEPTED" and c["problems"][0]["marks"] == 10
    assert body["summary"]["results"] == 1 and body["summary"]["coding_average"] == "10.00"
    text = str(body)
    assert SOURCE not in text and HIDDEN_INPUT not in text and HIDDEN_OUTPUT not in text
    call(client, "GET", f"/api/v1/assessments/{uuid.uuid4()}/coding-analytics", admin, 404)


# -- the paste policy ---------------------------------------------------------------------------------------


def test_the_paste_policy_is_an_assessment_setting_the_attempt_carries(
    client, helpers: Helpers, users, admin, monkeypatch
):
    assessment = create_assessment(client, admin, assessment_type="CODING")
    path = f"/api/v1/assessments/{assessment['id']}"
    assert call(client, "GET", path, admin, 200)["settings"]["coding_allow_paste"] is False
    assert (
        call(client, "PATCH", path, admin, 200, {"coding_allow_paste": True})["settings"][
            "coding_allow_paste"
        ]
        is True
    )
    call(client, "PATCH", path, admin, 422, {"coding_allow_paste": "sometimes"})

    ctx = exam(client, helpers, users, admin, monkeypatch)
    assert ctx["attempt"]["coding_allow_paste"] is False

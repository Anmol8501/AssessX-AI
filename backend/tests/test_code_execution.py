"""Coding assessments, stage C2: Run / Submit / Validate, the runner protocol, and judging.

What is asserted:
* **Judging is the server's.** Outputs are compared after normalising trailing whitespace. Runner outcomes
  map to verdicts. A missing test result is a system error, never a pass. A compile error stops
  everything.
* **Candidate requests.**
  * Only the candidate's own open attempt, and a coding question of its assessment; anything else is 404.
  * Not while the exam is on hold or finished.
  * Only a language enabled on the problem. Custom input only when the assessment allows it.
  * One job in flight per question; per-attempt rate limits; the submission limit.
  * The same idempotency key returns the original execution.
* **The runner.**
  * Its routes need the runner token (404 when none is configured, 401 when wrong), never a user's
    session.
  * A claim hands over test *inputs* but never expected outputs.
  * Only the claiming runner can report; an expired lease is reclaimed; too many claims fail the job.
* **What candidates see.** Sample tests in full; hidden tests only as counts, never their input, output
  or error text; never the reference solution.
* **Validate.** Admin-only. Marks the version validated only when the reference passes everything, and is
  then required to publish a version that has a reference solution.
"""

import uuid
from datetime import timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import get_settings
from app.models.base import utcnow
from app.models.code_execution import CodeExecution
from app.services.coding.execution import JudgeTest, judge, normalize
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers, create_assessment
from tests.test_attempts import ME, start
from tests.test_coding_problems import BASE as CODING
from tests.test_coding_problems import HIDDEN_INPUT, HIDDEN_OUTPUT, call, published
from tests.test_publishing import create_candidate

TOKEN = "test-runner-token-0123456789-abcdefghij"
RUNNER = {"X-Runner-Token": TOKEN}
CLAIM = "/api/v1/internal/runner/claim"
SOURCE = "a, b = map(int, input().split())\nprint(a + b)\n"


@pytest.fixture
def runner_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "runner_token", SecretStr(TOKEN))
    monkeypatch.setattr(get_settings(), "coding_execution_enabled", True)


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


@pytest.fixture
def coding(client, helpers: Helpers, users, admin, monkeypatch):
    """A published coding assessment with one problem, assigned and started by the candidate. The
    problem is published before the runner is switched on, so it needs no validation run."""
    problem, version = published(client, admin)
    monkeypatch.setattr(get_settings(), "runner_token", SecretStr(TOKEN))
    monkeypatch.setattr(get_settings(), "coding_execution_enabled", True)
    assessment = create_assessment(client, admin, assessment_type="CODING", total_marks=10, passing_marks=5)
    question = call(
        client,
        "POST",
        f"/api/v1/assessments/{assessment['id']}/coding-questions",
        admin,
        201,
        {"problem_version_id": version},
    )
    call(client, "POST", f"/api/v1/assessments/{assessment['id']}/ready", admin, 200)
    call(client, "POST", f"/api/v1/assessments/{assessment['id']}/publish", admin, 200)
    call(
        client,
        "POST",
        f"/api/v1/assessments/{assessment['id']}/assignments",
        admin,
        201,
        {"candidate_ids": [str(users["candidate"].id)]},
    )
    candidate = candidate_headers(helpers)
    attempt = start(client, candidate, assessment["id"])
    base = f"{ME}/attempts/{attempt['id']}/coding/{question['id']}"
    return {
        "problem": problem,
        "version": version,
        "assessment": assessment,
        "attempt": attempt,
        "question": question,
        "base": base,
        "candidate": candidate,
    }


def run(client, ctx, expect=201, **body):
    return call(
        client,
        "POST",
        f"{ctx['base']}/runs",
        ctx["candidate"],
        expect,
        {"language": "python", "source": SOURCE, **body},
    )


def submit(client, ctx, expect=201, **body):
    return call(
        client,
        "POST",
        f"{ctx['base']}/submissions",
        ctx["candidate"],
        expect,
        {"language": "python", "source": SOURCE, **body},
    )


def claim(client, runner_id="runner-1"):
    response = client.post(CLAIM, json={"runner_id": runner_id}, headers=RUNNER)
    assert response.status_code in (200, 204), response.text
    return response.json() if response.status_code == 200 else None


def report(client, job, outputs: dict[str, str] | None = None, runner_id="runner-1", **extra):
    tests = [
        {
            "id": t["id"],
            "outcome": "OK",
            "exit_code": 0,
            "runtime_ms": 40,
            "stdout": (outputs or {}).get(t["id"], "3\n"),
            "stderr": "",
        }
        for t in job["tests"]
    ]
    body = {"runner_id": runner_id, "compile": None, "tests": tests, "memory_kb": 9000, **extra}
    response = client.post(f"/api/v1/internal/runner/jobs/{job['id']}/result", json=body, headers=RUNNER)
    return response


# -- judging -----------------------------------------------------------------------------------------------


def test_outputs_are_compared_after_normalising_trailing_whitespace():
    assert normalize("3  \r\n4\n\n\n") == "3\n4"
    assert normalize("3\n 4") != normalize("3\n4")


def test_runner_outcomes_become_verdicts_and_the_first_failure_wins():
    tests = [
        JudgeTest("a", 1, "PUBLIC", "1", 1),
        JudgeTest("b", 2, "HIDDEN", "2", 3),
        JudgeTest("c", 3, "HIDDEN", "3", 1),
    ]
    result = judge(
        tests,
        {
            "compile": None,
            "tests": [
                {"id": "a", "outcome": "OK", "stdout": "1\n"},
                {"id": "b", "outcome": "OK", "stdout": "wrong"},
                {"id": "c", "outcome": "TIME_LIMIT"},
            ],
        },
    )
    assert result.verdict.value == "WRONG_ANSWER" and (result.passed, result.total) == (1, 3)
    assert (result.passed_weight, result.total_weight) == (1, 5)
    assert [r["verdict"] for r in result.results] == ["ACCEPTED", "WRONG_ANSWER", "TIME_LIMIT_EXCEEDED"]
    missing = judge(tests, {"tests": [{"id": "a", "outcome": "OK", "stdout": "1"}]})
    assert (
        missing.verdict.value == "SYSTEM_ERROR" and missing.passed == 1
    )  # never a pass for a missing result
    compile_error = judge(tests, {"compile": {"ok": False, "output": "error: x undeclared"}})
    assert (
        compile_error.verdict.value == "COMPILATION_ERROR"
        and compile_error.compile_output == "error: x undeclared"
    )
    custom = judge(
        [JudgeTest("custom", 1, "CUSTOM", None, 1)],
        {"tests": [{"id": "custom", "outcome": "OK", "stdout": "hi"}]},
    )
    assert custom.verdict.value == "COMPLETED"


# -- the full round trip ------------------------------------------------------------------------------------


def test_a_submission_round_trip_shows_hidden_tests_only_as_counts(client, db, coding):
    queued = submit(client, coding, idempotency_key="key-00000001")
    assert queued["status"] == "QUEUED" and queued["verdict"] is None

    job = claim(client)
    assert job["id"] == queued["id"] and job["language"] == "python" and job["image"] == "python:3.12-slim"
    assert job["time_limit_ms"] == 4000 and job["memory_limit_mb"] == 256  # Python's 2x time factor
    assert {t["input"] for t in job["tests"]} == {"1 2", HIDDEN_INPUT}
    assert HIDDEN_OUTPUT not in str(job) and "expected" not in str(job)  # the runner never gets answers
    assert claim(client, "runner-2") is None  # nothing else waiting

    hidden_id = next(t["id"] for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    assert report(client, job, {hidden_id: HIDDEN_OUTPUT + "  \n"}).status_code == 204
    done = call(client, "GET", f"{coding['base']}/executions/{queued['id']}", coding["candidate"], 200)
    assert (
        done["status"] == "COMPLETED"
        and done["verdict"] == "ACCEPTED"
        and (done["passed"], done["total"]) == (2, 2)
    )
    assert (done["hidden_passed"], done["hidden_total"]) == (1, 1)
    assert done["hidden_results"] == [{"number": 1, "verdict": "ACCEPTED"}]  # a verdict, nothing else
    assert [t["visibility"] for t in done["tests"]] == ["PUBLIC"] and done["tests"][0][
        "expected_output"
    ] == "3"
    text = str(done)
    assert HIDDEN_INPUT not in text and HIDDEN_OUTPUT not in text and "reference-solution-marker" not in text

    history = call(client, "GET", f"{coding['base']}/submissions", coding["candidate"], 200)
    assert [(h["number"], h["verdict"], h["passed"]) for h in history] == [(1, "ACCEPTED", 2)]
    # A retry with the same key returns the same submission instead of a new one.
    assert submit(client, coding, expect=200, idempotency_key="key-00000001")["id"] == queued["id"]
    assert (
        db.scalar(select(CodeExecution).where(CodeExecution.id == uuid.UUID(queued["id"]))).claim_count == 1
    )


def test_hidden_failures_never_show_their_output_or_errors(client, coding):
    queued = submit(client, coding)
    job = claim(client)
    hidden = next(t for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    body = {
        "runner_id": "runner-1",
        "tests": [
            {"id": t["id"], "outcome": "OK", "stdout": "3\n"}
            if t is not hidden
            else {
                "id": t["id"],
                "outcome": "RUNTIME_ERROR",
                "exit_code": 1,
                "stdout": "partial",
                "stderr": f"Traceback: {HIDDEN_INPUT}",
            }
            for t in job["tests"]
        ],
    }
    assert (
        client.post(f"/api/v1/internal/runner/jobs/{job['id']}/result", json=body, headers=RUNNER).status_code
        == 204
    )
    done = call(client, "GET", f"{coding['base']}/executions/{queued['id']}", coding["candidate"], 200)
    assert done["verdict"] == "RUNTIME_ERROR" and (done["hidden_passed"], done["hidden_total"]) == (0, 1)
    assert done["hidden_results"] == [{"number": 1, "verdict": "RUNTIME_ERROR"}]
    assert HIDDEN_INPUT not in str(done) and "Traceback" not in str(done) and "partial" not in str(done)


def test_each_hidden_test_shows_only_its_verdict(client, coding):
    queued = submit(client, coding)
    job = claim(client)
    hidden = next(t for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    body = {
        "runner_id": "runner-1",
        "tests": [
            {"id": t["id"], "outcome": "OK", "stdout": "3", "runtime_ms": 12}
            if t is not hidden
            else {
                "id": t["id"],
                "outcome": "TIME_LIMIT",
                "stdout": "leaked " + HIDDEN_INPUT,
                "runtime_ms": 4000,
            }
            for t in job["tests"]
        ],
    }
    client.post(f"/api/v1/internal/runner/jobs/{job['id']}/result", json=body, headers=RUNNER)
    done = call(client, "GET", f"{coding['base']}/executions/{queued['id']}", coding["candidate"], 200)
    assert done["verdict"] == "TIME_LIMIT_EXCEEDED"
    assert done["hidden_results"] == [{"number": 1, "verdict": "TIME_LIMIT_EXCEEDED"}]
    assert [t["visibility"] for t in done["tests"]] == ["PUBLIC"]  # the sample, in full
    assert HIDDEN_INPUT not in str(done) and "leaked" not in str(done)
    # A run checks the samples only, so it has no hidden results at all.
    queued_run = run(client, coding)
    report(client, claim(client))
    ran = call(client, "GET", f"{coding['base']}/executions/{queued_run['id']}", coding["candidate"], 200)
    assert ran["hidden_results"] == [] and ran["hidden_total"] is None


def test_a_run_uses_only_the_sample_tests_and_custom_input_needs_the_policy(client, db, coding):
    queued = run(client, coding)
    job = claim(client)
    assert [t["input"] for t in job["tests"]] == ["1 2"]
    report(client, job)
    done = call(client, "GET", f"{coding['base']}/executions/{queued['id']}", coding["candidate"], 200)
    assert (
        done["verdict"] == "ACCEPTED" and done["hidden_total"] is None and done["tests"][0]["stdout"] == "3\n"
    )

    run(client, coding, expect=422, custom_input="5 6")  # not allowed by default
    db.get(type(db.get(CodeExecution, uuid.UUID(queued["id"])).problem_version), uuid.UUID(coding["version"]))
    from app.models.assessment import Assessment

    db.get(Assessment, uuid.UUID(coding["assessment"]["id"])).coding_allow_custom_input = True
    db.flush()
    custom = run(client, coding, custom_input="5 6")
    job = claim(client)
    assert job["tests"] == [{"id": "custom", "input": "5 6"}]
    report(client, job, {"custom": "11\n"})
    done = call(client, "GET", f"{coding['base']}/executions/{custom['id']}", coding["candidate"], 200)
    assert (
        done["verdict"] == "COMPLETED"
        and done["tests"][0]["visibility"] == "CUSTOM"
        and done["tests"][0]["stdout"] == "11\n"
    )


# -- the rules on requests ----------------------------------------------------------------------------------


def test_requests_are_checked_against_the_problem_and_the_attempt(
    client, db, helpers: Helpers, admin, coding
):
    run(client, coding, expect=422, language="rust")
    run(client, coding, expect=422, source="")
    run(client, coding, expect=422, extra_field=1)
    run(client, coding, expect=422, idempotency_key="short")
    other_question = f"{ME}/attempts/{coding['attempt']['id']}/coding/{uuid.uuid4()}"
    call(
        client,
        "POST",
        f"{other_question}/runs",
        coding["candidate"],
        404,
        {"language": "python", "source": SOURCE},
    )

    intruder_info = create_candidate(
        client, admin, email="x@demo.local", roll_number="X1", initial_password="Other-pass-123"
    )
    assert intruder_info["id"]
    intruder = helpers.bearer(helpers.token_for_candidate("x@demo.local", "Other-pass-123", "X1"))
    call(client, "POST", f"{coding['base']}/runs", intruder, 404, {"language": "python", "source": SOURCE})
    queued = run(client, coding)
    call(client, "GET", f"{coding['base']}/executions/{queued['id']}", intruder, 404)
    assert call(client, "GET", f"{coding['base']}/submissions", intruder, 200) == []
    call(client, "GET", f"{coding['base']}/executions/{queued['id']}", admin, 403)


def test_one_job_in_flight_rate_limits_and_the_submission_limit(client, db, coding):
    first = run(client, coding)
    error = run(client, coding, expect=409)
    assert error["error"]["code"] == "execution_in_progress"
    job = claim(client)
    report(client, job)
    for _ in range(9):  # 10 runs per minute in total
        claim_and_finish(client, run(client, coding))
    assert run(client, coding, expect=429)["error"]["code"] == "execution_rate_limited"
    assert first["id"]

    from app.models.assessment import Assessment

    db.get(Assessment, uuid.UUID(coding["assessment"]["id"])).coding_max_submissions = 2
    db.flush()
    for _ in range(2):
        claim_and_finish(client, submit(client, coding))
    assert submit(client, coding, expect=409)["error"]["code"] == "submission_limit"


def claim_and_finish(client, queued):
    job = claim(client)
    assert job["id"] == queued["id"]
    report(client, job)


def test_no_runs_while_the_exam_is_on_hold_or_after_it_ends(client, admin, coding):
    call(client, "POST", f"/api/v1/admin/attempts/{coding['attempt']['id']}/hold", admin, 200, {})
    assert run(client, coding, expect=409)["error"]["code"] == "attempt_on_hold"
    call(client, "POST", f"/api/v1/admin/attempts/{coding['attempt']['id']}/end", admin, 200)
    assert run(client, coding, expect=409)["error"]["code"] == "attempt_locked"


# -- the runner protocol ------------------------------------------------------------------------------------


def test_the_runner_routes_need_the_runner_token(client, helpers: Helpers, admin, monkeypatch):
    assert client.post(CLAIM, json={"runner_id": "r"}).status_code == 404  # no runner configured: hidden
    monkeypatch.setattr(get_settings(), "runner_token", SecretStr(TOKEN))
    assert client.post(CLAIM, json={"runner_id": "r"}).status_code == 401
    assert client.post(CLAIM, json={"runner_id": "r"}, headers={"X-Runner-Token": "wrong"}).status_code == 401
    assert (
        client.post(CLAIM, json={"runner_id": "r"}, headers=admin).status_code == 401
    )  # a user session is not a runner
    assert client.post(CLAIM, json={"runner_id": "bad id!"}, headers=RUNNER).status_code == 422
    assert client.post(CLAIM, json={"runner_id": "r"}, headers=RUNNER).status_code == 204


def test_only_the_claiming_runner_reports_and_expired_leases_are_reclaimed(client, db, coding):
    queued = run(client, coding)
    job = claim(client, "runner-a")
    assert report(client, job, runner_id="runner-b").status_code == 409
    row = db.get(CodeExecution, uuid.UUID(queued["id"]))
    row.lease_expires_at = utcnow() - timedelta(seconds=1)
    db.flush()
    again = claim(client, "runner-b")
    assert again["id"] == queued["id"]
    assert report(client, job, runner_id="runner-a").status_code == 409  # its lease is gone
    assert report(client, again, runner_id="runner-b").status_code == 204
    assert db.get(CodeExecution, uuid.UUID(queued["id"])).claim_count == 2


def test_a_job_that_keeps_failing_to_finish_becomes_a_system_error(client, db, coding):
    queued = run(client, coding)
    row = None
    for _ in range(get_settings().runner_max_claims):
        assert claim(client)["id"] == queued["id"]
        row = db.get(CodeExecution, uuid.UUID(queued["id"]))
        row.lease_expires_at = utcnow() - timedelta(seconds=1)
        db.flush()
    assert claim(client) is None
    db.expire_all()
    done = call(client, "GET", f"{coding['base']}/executions/{queued['id']}", coding["candidate"], 200)
    assert done["status"] == "FAILED" and done["verdict"] == "SYSTEM_ERROR"


def test_a_runner_failure_is_recorded_as_a_system_error(client, coding):
    queued = run(client, coding)
    job = claim(client)
    response = client.post(
        f"/api/v1/internal/runner/jobs/{job['id']}/fail",
        json={"runner_id": "runner-1", "reason": "docker down"},
        headers=RUNNER,
    )
    assert response.status_code == 204
    done = call(client, "GET", f"{coding['base']}/executions/{queued['id']}", coding["candidate"], 200)
    assert done["verdict"] == "SYSTEM_ERROR"


# -- validation ---------------------------------------------------------------------------------------------


def test_validation_marks_the_version_and_is_required_to_publish(client, db, admin, runner_on):
    from tests.test_coding_problems import complete, new_problem

    problem = new_problem(client, admin, title="Validated Problem")
    vid = complete(client, admin, problem)
    path = f"{CODING}/{problem['id']}/versions/{vid}"
    error = call(client, "POST", f"{path}/publish", admin, 422)
    assert any("Validate the test cases" in d["message"] for d in error["error"]["details"])

    started = call(client, "POST", f"{path}/validate", admin, 202)
    job = claim(client)
    assert job["id"] == started["id"] and job["source"].startswith("print(sum(")
    hidden = next(t["id"] for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    report(client, job, {hidden: "wrong"})
    failed = call(client, "GET", f"{path}/validation", admin, 200)
    assert failed["verdict"] == "WRONG_ANSWER" and any(
        r["visibility"] == "HIDDEN" for r in failed["results"]
    )  # admins see all
    assert call(client, "GET", path, admin, 200)["validated_at"] is None

    call(client, "POST", f"{path}/validate", admin, 202)
    job = claim(client)
    report(client, job, {hidden: HIDDEN_OUTPUT})
    assert call(client, "GET", path, admin, 200)["validated_at"] is not None
    assert call(client, "POST", f"{path}/publish", admin, 200)["status"] == "PUBLISHED"


def test_only_administrators_validate(client, helpers: Helpers, admin, monkeypatch):
    problem, vid = published(client, admin)
    monkeypatch.setattr(get_settings(), "runner_token", SecretStr(TOKEN))
    response = client.post(
        f"{CODING}/{problem['id']}/versions/{vid}/validate", headers=candidate_headers(helpers)
    )
    assert response.status_code == 403


def test_coding_policies_are_assessment_settings(client, admin):
    assessment = create_assessment(client, admin, assessment_type="CODING")
    settings = call(client, "GET", f"/api/v1/assessments/{assessment['id']}", admin, 200)["settings"]
    assert settings["coding_allow_custom_input"] is False and settings["coding_max_submissions"] == 20
    updated = call(
        client,
        "PATCH",
        f"/api/v1/assessments/{assessment['id']}",
        admin,
        200,
        {"coding_allow_custom_input": True, "coding_max_submissions": 5},
    )
    assert (
        updated["settings"]["coding_allow_custom_input"] is True
        and updated["settings"]["coding_max_submissions"] == 5
    )
    call(
        client, "PATCH", f"/api/v1/assessments/{assessment['id']}", admin, 422, {"coding_max_submissions": 0}
    )

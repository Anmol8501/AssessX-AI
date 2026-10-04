"""Coding assessments, stage C5: hardening.

What is asserted:
* **Production configuration.** Coding execution cannot be switched on without a runner token, and the
  runner token cannot reuse SECRET_KEY.
* **The runner's allow-list matches the registry.** The runner refuses any job that does not match its
  own language profiles exactly, so those profiles must be the API's registry — this catches drift.
* **A runner cannot fake a pass.** Reports for tests that are not in the job, a missing test, or an
  "OK" with the wrong output are never accepted; only the server's comparison decides.
* **No hidden data reaches a candidate.** Every candidate coding endpoint — the problem, the draft, a
  run, a submission, the history, the progress, the attempt and the result — is swept for the hidden
  test's input and output and the reference solution.
* **Sizes are bounded.** Oversized source and custom input are refused before anything is queued.
"""

# ruff: noqa: F811 — pytest fixtures imported from another test module

import importlib.util
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.assessment import Assessment
from app.schemas.coding import MAX_SOURCE, MAX_TEST_DATA
from app.services.coding.languages import LANGUAGES
from tests.test_attempts import ME
from tests.test_code_execution import RUNNER, SOURCE, admin, claim, coding, report, submit  # noqa: F401
from tests.test_coding_problems import HIDDEN_INPUT, HIDDEN_OUTPUT, call
from tests.test_deployment import STRONG_SECRET, production

REFERENCE_MARKER = "reference-solution-marker"
RUNNER_POLICY = Path(__file__).resolve().parents[2] / "runner" / "assessx_runner" / "policy.py"


# -- production configuration ------------------------------------------------------------------------------


def test_production_refuses_coding_execution_without_a_runner_token():
    with pytest.raises(ValidationError, match="CODING_EXECUTION_ENABLED needs RUNNER_TOKEN"):
        production(coding_execution_enabled=True)
    assert production(coding_execution_enabled=True, runner_token="r" * 48).coding_execution_enabled


def test_production_refuses_a_runner_token_that_reuses_the_secret_key():
    with pytest.raises(ValidationError, match="must not reuse SECRET_KEY"):
        production(runner_token=STRONG_SECRET)


# -- the runner's allow-list --------------------------------------------------------------------------------


@pytest.mark.skipif(not RUNNER_POLICY.exists(), reason="the runner is not in this checkout")
def test_the_runners_language_profiles_match_the_registry_exactly():
    spec = importlib.util.spec_from_file_location("runner_policy", RUNNER_POLICY)
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    registry = {
        lang.id: (lang.image, lang.source_file, lang.compile, lang.run) for lang in LANGUAGES.values()
    }
    profiles = {lang: (p.image, p.source_file, p.compile, p.run) for lang, p in policy.PROFILES.items()}
    assert profiles == registry


# -- a runner cannot fake a pass ----------------------------------------------------------------------------


def _report(client, job, tests: list[dict]):
    body = {"runner_id": "runner-1", "tests": tests}
    return client.post(f"/api/v1/internal/runner/jobs/{job['id']}/result", json=body, headers=RUNNER)


def _outcome(client, ctx, execution_id: str) -> dict:
    return call(client, "GET", f"{ctx['base']}/executions/{execution_id}", ctx["candidate"], 200)


def test_reports_for_tests_that_are_not_in_the_job_never_pass(client, coding):
    queued = submit(client, coding)
    job = claim(client)
    forged = [{"id": f"forged-{i}", "outcome": "OK", "stdout": HIDDEN_OUTPUT} for i in range(2)]
    assert _report(client, job, forged).status_code == 204
    done = _outcome(client, coding, queued["id"])
    assert done["verdict"] == "SYSTEM_ERROR" and done["passed"] == 0


def test_a_missing_test_result_is_never_a_pass(client, coding):
    queued = submit(client, coding)
    job = claim(client)
    public = next(t for t in job["tests"] if t["input"] != HIDDEN_INPUT)
    assert _report(client, job, [{"id": public["id"], "outcome": "OK", "stdout": "3"}]).status_code == 204
    done = _outcome(client, coding, queued["id"])
    assert done["verdict"] == "SYSTEM_ERROR" and done["passed"] == 1 and done["total"] == 2


def test_ok_with_the_wrong_output_is_a_wrong_answer(client, coding):
    queued = submit(client, coding)
    job = claim(client)
    assert (
        _report(
            client, job, [{"id": t["id"], "outcome": "OK", "stdout": "3"} for t in job["tests"]]
        ).status_code
        == 204
    )
    done = _outcome(client, coding, queued["id"])
    assert done["verdict"] == "WRONG_ANSWER" and done["passed"] == 1


def test_a_report_cannot_carry_a_verdict_or_unbounded_output(client, coding):
    submit(client, coding)
    job = claim(client)
    test_id = job["tests"][0]["id"]
    assert _report(client, job, [{"id": test_id, "outcome": "ACCEPTED", "stdout": "3"}]).status_code == 422
    assert _report(client, job, [{"id": test_id, "outcome": "OK", "stdout": "x" * 70_001}]).status_code == 422
    assert _report(client, job, [{"id": test_id, "outcome": "OK", "verdict": "ACCEPTED"}]).status_code == 422


# -- no hidden data reaches a candidate ---------------------------------------------------------------------


def test_no_candidate_coding_endpoint_reveals_hidden_tests_or_the_reference(client, db, coding):
    from uuid import UUID

    db.get(Assessment, UUID(coding["assessment"]["id"])).show_results = True
    db.flush()
    seen: list[str] = []
    candidate = coding["candidate"]
    attempt = coding["attempt"]["id"]

    def get(path: str) -> None:
        seen.append(str(call(client, "GET", path, candidate, 200)))

    get(coding["base"])
    seen.append(
        str(
            call(
                client,
                "PUT",
                f"{coding['base']}/draft",
                candidate,
                200,
                {"language": "python", "source": SOURCE},
            )
        )
    )
    queued = submit(client, coding)
    seen.append(str(queued))
    job = claim(client)
    hidden = next(t["id"] for t in job["tests"] if t["input"] == HIDDEN_INPUT)
    # The program prints the hidden input and fails, as if trying to leak it into its output.
    report(client, job, {hidden: f"{HIDDEN_INPUT}\n{HIDDEN_OUTPUT}-almost"})
    get(f"{coding['base']}/executions/{queued['id']}")
    get(f"{coding['base']}/submissions")
    get(f"{ME}/attempts/{attempt}/coding-progress")
    get(f"{ME}/attempts/{attempt}")
    call(client, "POST", f"{ME}/attempts/{attempt}/submit", candidate, 200)
    get(f"{ME}/attempts/{attempt}/result")
    get(f"{ME}/results")

    everything = "\n".join(seen)
    assert HIDDEN_INPUT not in everything
    assert HIDDEN_OUTPUT not in everything
    assert REFERENCE_MARKER not in everything
    assert "expected_output" not in everything.replace("'expected_output': '3'", "")  # samples only


# -- bounded sizes ------------------------------------------------------------------------------------------


def test_oversized_source_and_custom_input_are_refused_before_queueing(client, db, coding):
    from uuid import UUID

    db.get(Assessment, UUID(coding["assessment"]["id"])).coding_allow_custom_input = True
    db.flush()
    body = {"language": "python", "source": "x" * (MAX_SOURCE + 1)}
    call(client, "POST", f"{coding['base']}/runs", coding["candidate"], 422, body)
    call(client, "POST", f"{coding['base']}/submissions", coding["candidate"], 422, body)
    call(client, "PUT", f"{coding['base']}/draft", coding["candidate"], 422, body)
    big_input = {"language": "python", "source": SOURCE, "custom_input": "1" * (MAX_TEST_DATA + 1)}
    call(client, "POST", f"{coding['base']}/runs", coding["candidate"], 422, big_input)
    assert claim(client) is None  # nothing was queued

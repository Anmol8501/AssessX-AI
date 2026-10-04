"""Coding assessments, stage C3: autosaved drafts and coding progress.

What is asserted:
* **Revisions.** A draft is saved with the revision it started from: the first save is revision 1, and
  each save moves it on. A save based on an old revision (another window saved first) is refused with
  409 `draft_conflict` and the current revision, so newer code is never overwritten. The problem view
  restores the latest draft.
* **Checks.** The language must be enabled; the source is size-bounded (empty is allowed).
* **Access.** Only the candidate's own open attempt can save: another candidate gets 404, an
  administrator 403, and nothing can be saved while the exam is on hold or after it ends.
* **Progress.** Each coding question goes: not started → in progress (a draft) → pending (a submission
  being judged) → not passed or passed. The attempt view carries the assessment type and this progress.
"""

# ruff: noqa: F811 — pytest fixtures imported from another test module

from tests.conftest import Helpers
from tests.test_attempts import ME
from tests.test_code_execution import admin, claim, coding, report, submit  # noqa: F401
from tests.test_coding_problems import HIDDEN_INPUT, HIDDEN_OUTPUT, call
from tests.test_publishing import create_candidate


def save(client, ctx, expect=200, **body):
    return call(
        client,
        "PUT",
        f"{ctx['base']}/draft",
        ctx["candidate"],
        expect,
        {"language": "python", "source": "print(1)\n", **body},
    )


def progress(client, ctx) -> dict:
    [row] = call(
        client, "GET", f"{ME}/attempts/{ctx['attempt']['id']}/coding-progress", ctx["candidate"], 200
    )
    return row


def test_drafts_move_by_revision_and_a_stale_save_is_refused(client, coding):
    assert call(client, "GET", coding["base"], coding["candidate"], 200)["draft"] is None
    first = save(client, coding)
    assert first["revision"] == 1 and first["language"] == "python"
    second = save(client, coding, source="print(2)\n", base_revision=1)
    assert second["revision"] == 2
    error = save(client, coding, expect=409, source="older tab", base_revision=1)
    assert error["error"]["code"] == "draft_conflict" and error["error"]["details"]["revision"] == 2
    restored = call(client, "GET", coding["base"], coding["candidate"], 200)["draft"]
    assert restored["source"] == "print(2)\n" and restored["revision"] == 2
    assert save(client, coding, expect=409, base_revision=7)["error"]["code"] == "draft_conflict"


def test_drafts_are_checked_like_runs(client, coding):
    save(client, coding, expect=422, language="rust")
    save(client, coding, expect=422, source="x" * 65_537)
    save(client, coding, expect=422, owner="someone-else")
    assert save(client, coding, source="")["revision"] == 1  # clearing the editor is a valid save


def test_only_the_candidates_own_open_attempt_saves(client, helpers: Helpers, admin, coding):
    create_candidate(client, admin, email="d@demo.local", roll_number="D1", initial_password="Other-pass-123")
    intruder = helpers.bearer(helpers.token_for_candidate("d@demo.local", "Other-pass-123", "D1"))
    call(client, "PUT", f"{coding['base']}/draft", intruder, 404, {"language": "python", "source": "x"})
    call(client, "GET", coding["base"], intruder, 404)
    call(client, "PUT", f"{coding['base']}/draft", admin, 403, {"language": "python", "source": "x"})

    call(client, "POST", f"/api/v1/admin/attempts/{coding['attempt']['id']}/hold", admin, 200, {})
    assert save(client, coding, expect=409)["error"]["code"] == "attempt_on_hold"
    call(client, "POST", f"/api/v1/admin/attempts/{coding['attempt']['id']}/end", admin, 200)
    assert save(client, coding, expect=409)["error"]["code"] == "attempt_locked"


def test_progress_follows_the_candidates_work(client, coding):
    assert progress(client, coding)["status"] == "NOT_STARTED"
    save(client, coding)
    assert progress(client, coding)["status"] == "IN_PROGRESS"

    queued = submit(client, coding)
    assert progress(client, coding)["status"] == "PENDING"
    job = claim(client)
    report(client, job, {t["id"]: "wrong" for t in job["tests"]})
    row = progress(client, coding)
    assert (row["status"], row["submissions"], row["best_passed"], row["total"]) == ("NOT_PASSED", 1, 0, 2)
    assert queued["id"]

    submit(client, coding)  # a second submission (3 a minute are allowed)
    job = claim(client)
    outputs = {t["id"]: (HIDDEN_OUTPUT if t["input"] == HIDDEN_INPUT else "3") for t in job["tests"]}
    report(client, job, outputs)
    row = progress(client, coding)
    assert (row["status"], row["submissions"], row["best_passed"]) == ("PASSED", 2, 2)

    detail = call(client, "GET", f"{ME}/attempts/{coding['attempt']['id']}", coding["candidate"], 200)
    assert detail["assessment_type"] == "CODING" and detail["coding"][0]["status"] == "PASSED"
    assert detail["questions"][0]["type"] == "CODING" and detail["questions"][0]["options"] == []

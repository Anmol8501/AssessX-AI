"""Coding assessments, stage C1: the coding-problem library.

What is asserted: a new problem starts as a v1 draft with every registered language and its starter code;
requests are strict (unknown fields, unsupported languages, malformed slugs are refused); a draft cannot
be published until it is complete (statement, a language, a public and a hidden test, a reference
solution in an enabled language); a published version never changes again — editing starts the next
draft as a copy, test cases included, and the earlier version is untouched; the candidate preview carries
no hidden test data and no reference solution; a problem used by an assessment cannot be deleted; only
administrators can reach the library; creating, versioning, publishing and deleting are audited.
"""

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditAction, AuditLog
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers

BASE = "/api/v1/coding-problems"
HIDDEN_INPUT = "999999 secret-hidden-input"
HIDDEN_OUTPUT = "424242 secret-hidden-output"
REFERENCE = "print(sum(map(int, input().split())))  # reference-solution-marker"


def call(client, method: str, path: str, headers, expect: int, body: dict | None = None):
    response = client.request(method, path, json=body, headers=headers)
    assert response.status_code == expect, response.text
    return response.json() if response.content else None


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


def new_problem(client, admin, **overrides) -> dict:
    return call(client, "POST", BASE, admin, 201, {"title": "Sum of Two Numbers", **overrides})


def draft_of(problem: dict) -> str:
    return problem["draft"]["id"]


def complete(client, admin, problem: dict) -> str:
    """Fills the draft so it can be published; returns the version id."""
    pid, vid = problem["id"], draft_of(problem)
    call(
        client,
        "PATCH",
        f"{BASE}/{pid}/versions/{vid}",
        admin,
        200,
        {
            "statement": "Read two integers and print their sum.",
            "constraints": "-10^9 <= a, b <= 10^9",
            "examples": [{"input": "1 2", "output": "3", "explanation": "1 + 2 = 3"}],
            "reference_language": "python",
            "reference_solution": REFERENCE,
        },
    )
    call(
        client,
        "POST",
        f"{BASE}/{pid}/versions/{vid}/test-cases",
        admin,
        201,
        {"visibility": "PUBLIC", "input": "1 2", "expected_output": "3"},
    )
    call(
        client,
        "POST",
        f"{BASE}/{pid}/versions/{vid}/test-cases",
        admin,
        201,
        {"visibility": "HIDDEN", "input": HIDDEN_INPUT, "expected_output": HIDDEN_OUTPUT, "weight": 3},
    )
    return vid


def published(client, admin, **overrides) -> tuple[dict, str]:
    problem = new_problem(client, admin, **overrides)
    vid = complete(client, admin, problem)
    call(client, "POST", f"{BASE}/{problem['id']}/versions/{vid}/publish", admin, 200)
    return problem, vid


def test_a_new_problem_is_a_draft_with_every_language_and_its_starter_code(client, admin):
    problem = new_problem(client, admin, difficulty="MEDIUM", tags=["Arrays", "arrays", "Hashing"])
    assert problem["slug"] == "sum-of-two-numbers" and problem["latest"] is None
    assert problem["draft"]["version"] == 1 and problem["draft"]["tags"] == ["Arrays", "Hashing"]
    version = call(client, "GET", f"{BASE}/{problem['id']}/versions/{draft_of(problem)}", admin, 200)
    assert version["status"] == "DRAFT" and version["difficulty"] == "MEDIUM"
    assert version["languages"] == ["python", "c", "cpp", "java"]
    assert "public class Main" in version["starter_code"]["java"]
    assert version["time_limit_ms"] == 2000 and version["memory_limit_mb"] == 256
    assert "Write the problem statement." in version["issues"]
    # A second problem with the same title gets its own slug.
    assert new_problem(client, admin)["slug"] == "sum-of-two-numbers-2"
    call(client, "POST", BASE, admin, 409, {"title": "Another", "slug": "sum-of-two-numbers"})


@pytest.mark.parametrize(
    "body",
    [
        {"title": "Valid title", "unexpected": True},
        {"title": "Valid title", "slug": "Bad Slug!"},
        {"title": "ab"},
        {"title": "Valid title", "tags": ["x"] * 11},
    ],
)
def test_problem_requests_are_strict(client, admin, body):
    call(client, "POST", BASE, admin, 422, body)


def test_draft_edits_are_validated_against_the_language_registry(client, admin):
    problem = new_problem(client, admin)
    path = f"{BASE}/{problem['id']}/versions/{draft_of(problem)}"
    call(client, "PATCH", path, admin, 422, {"languages": ["python", "brainfuck"]})
    call(client, "PATCH", path, admin, 422, {"starter_code": {"rust": "fn main() {}"}})
    call(client, "PATCH", path, admin, 422, {"time_limit_ms": 50})
    call(client, "PATCH", path, admin, 422, {"memory_limit_mb": 4096})
    call(client, "PATCH", path, admin, 422, {"reference_solution": "x", "status": "PUBLISHED"})
    # Switching languages keeps the starter code in step: only enabled languages keep a template.
    version = call(client, "PATCH", path, admin, 200, {"languages": ["python", "cpp"]})
    assert sorted(version["starter_code"]) == ["cpp", "python"]


def test_a_draft_cannot_be_published_until_it_is_complete(client, admin):
    problem = new_problem(client, admin)
    pid, vid = problem["id"], draft_of(problem)
    error = call(client, "POST", f"{BASE}/{pid}/versions/{vid}/publish", admin, 422)
    messages = [d["message"] for d in error["error"]["details"]]
    assert "Write the problem statement." in messages
    assert "Add at least one public (sample) test case." in messages
    assert "Add at least one hidden test case." in messages

    complete(client, admin, problem)
    call(
        client, "PATCH", f"{BASE}/{pid}/versions/{vid}", admin, 200, {"languages": ["c"]}
    )  # reference is Python
    error = call(client, "POST", f"{BASE}/{pid}/versions/{vid}/publish", admin, 422)
    assert any("reference solution's language" in d["message"] for d in error["error"]["details"])
    call(client, "PATCH", f"{BASE}/{pid}/versions/{vid}", admin, 200, {"languages": ["c", "python"]})
    version = call(client, "POST", f"{BASE}/{pid}/versions/{vid}/publish", admin, 200)
    assert version["status"] == "PUBLISHED" and version["published_at"] and version["issues"] == []


def test_a_published_version_never_changes_and_editing_starts_the_next_draft(client, admin):
    problem, v1 = published(client, admin)
    pid = problem["id"]
    tests = call(client, "GET", f"{BASE}/{pid}/versions/{v1}", admin, 200)["test_cases"]
    call(client, "PATCH", f"{BASE}/{pid}/versions/{v1}", admin, 409, {"statement": "changed"})
    call(
        client,
        "POST",
        f"{BASE}/{pid}/versions/{v1}/test-cases",
        admin,
        409,
        {"visibility": "HIDDEN", "expected_output": "1"},
    )
    call(
        client, "PATCH", f"{BASE}/{pid}/versions/{v1}/test-cases/{tests[0]['id']}", admin, 409, {"weight": 5}
    )
    call(client, "DELETE", f"{BASE}/{pid}/versions/{v1}/test-cases/{tests[0]['id']}", admin, 409)

    v2 = call(client, "POST", f"{BASE}/{pid}/versions", admin, 201)
    assert v2["version"] == 2 and v2["status"] == "DRAFT"
    assert [(t["visibility"], t["input"]) for t in v2["test_cases"]] == [
        (t["visibility"], t["input"]) for t in tests
    ]
    call(client, "POST", f"{BASE}/{pid}/versions", admin, 409)  # one draft at a time
    call(
        client,
        "PATCH",
        f"{BASE}/{pid}/versions/{v2['id']}",
        admin,
        200,
        {"statement": "A clearer statement."},
    )
    call(client, "POST", f"{BASE}/{pid}/versions/{v2['id']}/publish", admin, 200)

    original = call(client, "GET", f"{BASE}/{pid}/versions/{v1}", admin, 200)
    assert original["statement"] == "Read two integers and print their sum."
    detail = call(client, "GET", f"{BASE}/{pid}", admin, 200)
    assert detail["latest"]["version"] == 2 and detail["draft"] is None and len(detail["versions"]) == 2


def test_the_candidate_preview_carries_no_hidden_data_and_no_reference(client, admin):
    problem, vid = published(client, admin)
    preview = call(client, "GET", f"{BASE}/{problem['id']}/versions/{vid}/preview", admin, 200)
    text = str(preview)
    assert HIDDEN_INPUT not in text and HIDDEN_OUTPUT not in text and "reference-solution-marker" not in text
    assert "reference_solution" not in preview and "test_cases" not in preview
    assert preview["sample_tests"] == [{"number": 1, "input": "1 2", "expected_output": "3"}]
    assert preview["hidden_test_count"] == 1
    assert [lang["id"] for lang in preview["languages"]] == ["python", "c", "cpp", "java"]


def test_test_cases_are_bounded_and_kept_in_order(client, admin):
    problem = new_problem(client, admin)
    path = f"{BASE}/{problem['id']}/versions/{draft_of(problem)}/test-cases"
    call(client, "POST", path, admin, 422, {"visibility": "SECRET", "expected_output": "1"})
    call(client, "POST", path, admin, 422, {"visibility": "HIDDEN", "expected_output": "1", "weight": 0})
    call(client, "POST", path, admin, 422, {"visibility": "HIDDEN", "expected_output": "x" * 65_537})
    ids = [
        call(client, "POST", path, admin, 201, {"visibility": "HIDDEN", "expected_output": str(i)})["id"]
        for i in range(3)
    ]
    call(client, "DELETE", f"{path}/{ids[1]}", admin, 204)
    version = call(client, "GET", f"{BASE}/{problem['id']}/versions/{draft_of(problem)}", admin, 200)
    assert [(t["position"], t["expected_output"]) for t in version["test_cases"]] == [(0, "0"), (1, "2")]


def test_filters_and_the_library_list(client, admin):
    published(client, admin, title="Two Sum Hashing", difficulty="EASY", tags=["Hashing"])
    new_problem(client, admin, title="Graph Paths", difficulty="HARD", tags=["Graph"])
    rows = call(client, "GET", BASE, admin, 200)
    assert {r["slug"] for r in rows} >= {"two-sum-hashing", "graph-paths"}
    assert [r["slug"] for r in call(client, "GET", f"{BASE}?published_only=true", admin, 200)] == [
        "two-sum-hashing"
    ]
    assert [r["slug"] for r in call(client, "GET", f"{BASE}?difficulty=HARD", admin, 200)] == ["graph-paths"]
    assert [r["slug"] for r in call(client, "GET", f"{BASE}?tag=hashing", admin, 200)] == ["two-sum-hashing"]
    assert [r["slug"] for r in call(client, "GET", f"{BASE}?search=graph", admin, 200)] == ["graph-paths"]


def test_deleting_and_discarding(client, admin):
    unused = new_problem(client, admin, title="Unused Problem")
    call(
        client, "DELETE", f"{BASE}/{unused['id']}/versions/{draft_of(unused)}", admin, 409
    )  # its only version
    call(client, "DELETE", f"{BASE}/{unused['id']}", admin, 204)
    call(client, "GET", f"{BASE}/{unused['id']}", admin, 404)

    problem, _ = published(client, admin)
    draft = call(client, "POST", f"{BASE}/{problem['id']}/versions", admin, 201)
    call(client, "DELETE", f"{BASE}/{problem['id']}/versions/{draft['id']}", admin, 204)
    assert call(client, "GET", f"{BASE}/{problem['id']}", admin, 200)["draft"] is None


def test_only_administrators_reach_the_library(client, helpers: Helpers, admin):
    problem, vid = published(client, admin)
    candidate = candidate_headers(helpers)
    for method, path in [
        ("GET", BASE),
        ("POST", BASE),
        ("GET", f"{BASE}/{problem['id']}"),
        ("GET", f"{BASE}/{problem['id']}/versions/{vid}"),
        ("GET", f"{BASE}/{problem['id']}/versions/{vid}/preview"),
        ("POST", f"{BASE}/{problem['id']}/versions"),
        ("DELETE", f"{BASE}/{problem['id']}"),
        ("GET", f"{BASE}/languages"),
    ]:
        assert client.request(method, path, json={}, headers=candidate).status_code == 403, path
        assert client.request(method, path, json={}).status_code == 401, path


def test_library_changes_are_audited_without_content(client, db, admin):
    problem, _ = published(client, admin)
    call(client, "POST", f"{BASE}/{problem['id']}/versions", admin, 201)
    rows = list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.action.in_([a for a in AuditAction if a.value.startswith("CODING_")]))
            .order_by(AuditLog.occurred_at)
        )
    )
    assert [r.action.value for r in rows] == [
        "CODING_PROBLEM_CREATED",
        "CODING_VERSION_PUBLISHED",
        "CODING_VERSION_CREATED",
    ]
    assert HIDDEN_INPUT not in str([r.details for r in rows]) and "reference" not in str(
        [r.details for r in rows]
    )

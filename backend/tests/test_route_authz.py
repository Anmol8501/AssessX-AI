"""Every route checks who is calling (Phase 8A, AX-21).

Generated from the application's real route table, so a new route that forgets its role guard fails
here without anyone having to remember to write a test for it:

* without a token, every non-public route answers 401;
* a candidate gets 403 from every administrator route;
* an administrator gets 403 from every candidate route (`/candidates/me…`).

Path parameters are filled with random UUIDs: authorization is decided before any lookup, so the answer
must be 401/403, never 404 or 422 (which would mean the request got past the guard).
"""

import re
import uuid

import pytest

from app.main import create_app
from tests.test_assessments import admin_headers, candidate_headers

#: Reachable without signing in, by design.
PUBLIC = {
    ("GET", "/health"),
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/auth/challenge"),
    ("POST", "/api/v1/auth/login/candidate"),
    ("POST", "/api/v1/auth/login/admin"),
    ("POST", "/api/v1/auth/password-reset"),
}
#: Routes any signed-in user may call (their own account and session, ICE servers, socket tickets).
ANY_SIGNED_IN = {
    ("GET", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/auth/logout-all"),
    ("POST", "/api/v1/auth/password"),
    ("GET", "/api/v1/auth/mfa"),
    ("GET", "/api/v1/realtime/ice-servers"),
    ("POST", "/api/v1/realtime/ws-ticket"),
}


def _routes() -> list[tuple[str, str]]:
    # Read from the OpenAPI schema rather than `app.routes`: it is the public description of every HTTP
    # route and does not depend on how a FastAPI version nests included routers internally. Only
    # /health and the runner's internal routes are left out of the schema, and neither belongs here.
    schema = create_app().openapi()
    found = []
    for path, operations in schema["paths"].items():
        if path.startswith(("/api/v1/dev/", "/api/v1/internal/")):
            continue  # dev routes: non-production only; the runner has its own token (tested separately)
        for method in sorted(m.upper() for m in operations if m.upper() not in {"HEAD", "OPTIONS"}):
            found.append((method, path))
    return found


ROUTES = _routes()


def _url(path: str) -> str:
    return re.sub(r"\{[^}]+\}", lambda _: str(uuid.uuid4()), path)


def _call(client, method: str, path: str, headers: dict | None = None):
    return client.request(method, _url(path), json={}, headers=headers or {})


def test_the_route_table_is_covered():
    assert len(ROUTES) > 120  # sanity: the whole API, not an empty list


@pytest.mark.parametrize(("method", "path"), [r for r in ROUTES if r not in PUBLIC])
def test_every_protected_route_requires_a_token(client, method, path):
    assert _call(client, method, path).status_code == 401, f"{method} {path} answered without a token"


def test_role_guards_on_every_route(client, helpers, users):
    candidate = candidate_headers(helpers)
    admin = admin_headers(helpers)
    leaks = []
    for method, path in ROUTES:
        if (method, path) in PUBLIC or (method, path) in ANY_SIGNED_IN:
            continue
        if path.startswith("/api/v1/candidates/me"):
            status = _call(client, method, path, admin).status_code
            if status != 403:
                leaks.append(f"admin → {method} {path}: {status}")
        else:
            status = _call(client, method, path, candidate).status_code
            if status != 403:
                leaks.append(f"candidate → {method} {path}: {status}")
    assert leaks == []

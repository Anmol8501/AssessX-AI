"""The code runner's routes (coding assessments, stage C2). Not for people.

Authenticated only by the runner's shared secret in the `X-Runner-Token` header (compared in constant
time); a user's session token is never accepted here. When no `RUNNER_TOKEN` is configured, the routes
answer 404 as if they did not exist.

* `POST /claim` — the next job (or 204). The payload carries what to run and test *inputs*; it never
  carries an expected output, so the runner cannot judge, and a compromised runner cannot learn answers.
* `POST /jobs/{id}/result` — raw results; the API judges them.
* `POST /jobs/{id}/fail` — the runner could not run the job (an infrastructure fault, never scored).
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.api.deps import DbSession
from app.core.errors import NotFound, Unauthorized
from app.schemas.coding import ClaimRequest, RunnerId, RunnerReport
from app.services.coding.execution import ExecutionService

router = APIRouter(prefix="/internal/runner", tags=["runner"], include_in_schema=False)


def _authorize(token: str | None) -> None:
    ok = ExecutionService.runner_token_ok(token)
    if ok is None:
        raise NotFound("Not found.")
    if not ok:
        raise Unauthorized("Runner authentication failed.")


class FailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runner_id: RunnerId
    reason: Annotated[str, StringConstraints(max_length=500)]


@router.post("/claim", response_model=None)
def claim(
    payload: ClaimRequest, db: DbSession, x_runner_token: Annotated[str | None, Header()] = None
) -> dict[str, Any] | Response:
    _authorize(x_runner_token)
    job = ExecutionService(db).claim(payload.runner_id)
    if job is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return job


@router.post("/jobs/{job_id}/result", status_code=status.HTTP_204_NO_CONTENT)
def result(
    job_id: uuid.UUID,
    payload: RunnerReport,
    db: DbSession,
    x_runner_token: Annotated[str | None, Header()] = None,
) -> Response:
    _authorize(x_runner_token)
    ExecutionService(db).complete(job_id, payload.runner_id, payload.model_dump())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/jobs/{job_id}/fail", status_code=status.HTTP_204_NO_CONTENT)
def fail(
    job_id: uuid.UUID,
    payload: FailRequest,
    db: DbSession,
    x_runner_token: Annotated[str | None, Header()] = None,
) -> Response:
    _authorize(x_runner_token)
    ExecutionService(db).fail(job_id, payload.runner_id, payload.reason)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

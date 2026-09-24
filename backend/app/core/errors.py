"""Application error types and the handlers that turn them into one JSON shape.

Every error response is ``{"error": {"code": "...", "message": "...", "details"?: ...}}`` so the
desktop client can branch on ``code`` instead of parsing prose.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("assessx.errors")


class AppError(Exception):
    status_code = 500
    code = "internal_error"
    message = "Something went wrong."
    headers: dict[str, str] | None = None

    def __init__(self, message: str | None = None, *, details: Any = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        self.details = details


class ValidationFailed(AppError):
    """Raised by services for rules Pydantic cannot express (cross-field, cross-row)."""

    status_code = 422
    code = "validation_error"
    message = "The request is invalid."


class Unauthorized(AppError):
    """Missing, invalid or expired authentication."""

    status_code = 401
    code = "unauthorized"
    message = "Authentication is required."
    headers = {"WWW-Authenticate": "Bearer"}


class InvalidCredentials(Unauthorized):
    code = "invalid_credentials"
    message = "Invalid email or password."


class AccountInactive(AppError):
    status_code = 403
    code = "account_inactive"
    message = "This account is inactive. Contact your administrator."


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"
    message = "You do not have permission to do that."


class NotFound(AppError):
    status_code = 404
    code = "not_found"
    message = "Not found."


class Conflict(AppError):
    status_code = 409
    code = "conflict"
    message = "That conflicts with existing data."


class AttemptLocked(Conflict):
    """The exam attempt has been submitted or has run out of time, so it can no longer change.

    Its own code because the desktop client reacts to it rather than just reporting it: the exam
    screen re-reads the attempt and shows the finished state instead of leaving the candidate
    typing into a exam the server has already closed.
    """

    code = "attempt_locked"
    message = "This attempt has been finalized and can no longer be changed."


class DatabaseUnavailable(AppError):
    status_code = 503
    code = "database_unavailable"
    message = "The service is temporarily unavailable. Please try again shortly."


class ChallengeInvalid(AppError):
    status_code = 400
    code = "challenge_invalid"
    message = "The security check did not match. Please try the new code."


def _payload(code: str, message: str, details: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(exc.code, exc.message, exc.details),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422, content=_payload("validation_error", "The request is invalid.", details)
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(codes.get(exc.status_code, "http_error"), str(exc.detail)),
            headers=exc.headers,
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        # Constraint violations are a client-side conflict, not a server fault. Details stay in the log.
        log.warning("Integrity error", extra={"detail": str(exc.orig)[:200]})
        return JSONResponse(status_code=409, content=_payload(Conflict.code, Conflict.message))

    @app.exception_handler(OperationalError)
    async def _operational(_: Request, exc: OperationalError) -> JSONResponse:
        log.error("Database unavailable", exc_info=exc)
        return JSONResponse(
            status_code=503, content=_payload(DatabaseUnavailable.code, DatabaseUnavailable.message)
        )

    @app.exception_handler(SQLAlchemyError)
    async def _sqlalchemy(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        log.exception("Database error", exc_info=exc)
        return JSONResponse(status_code=500, content=_payload("internal_error", "Something went wrong."))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content=_payload("internal_error", "Something went wrong."))

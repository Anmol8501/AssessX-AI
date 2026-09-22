"""Application logging.

Two output formats, chosen by `LOG_FORMAT`:

* ``console`` — one readable line per event (development default)
* ``json``    — one JSON object per line for log shippers (production default)

Every record carries the current request id (see `RequestContextMiddleware`) when one exists.
Nothing here or in the call sites logs passwords, hashes or tokens; see `SENSITIVE_KEYS`.
"""

import contextvars
import json
import logging
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from starlette.requests import Request

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

# Keys that must never appear in structured log fields, whatever a caller passes.
SENSITIVE_KEYS = frozenset(
    {"password", "password_hash", "token", "authorization", "challenge_answer", "secret_key"}
)

# Attributes every LogRecord has; anything else in `record.__dict__` came from `extra=`.
_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


def _extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    return {
        key: value
        for key, value in record.__dict__.items()
        if key not in _STANDARD_ATTRS and key.lower() not in SENSITIVE_KEYS
    }


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        request_id = getattr(record, "request_id", "-")
        base = (
            f"{self.formatTime(record, '%H:%M:%S')} {record.levelname:<7} {record.name} "
            f"[{request_id}] {record.getMessage()}"
        )
        extras = _extra_fields(record)
        extras.pop("request_id", None)
        if extras:
            base += " " + " ".join(f"{k}={v}" for k, v in extras.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        payload.update(_extra_fields(record))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", log_format: str = "console") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if log_format == "json" else ConsoleFormatter())
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn's own access log duplicates our request log; keep its error channel.
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("uvicorn.error").propagate = True
    logging.getLogger("uvicorn.error").handlers.clear()


class RequestContextMiddleware:
    """Assigns a request id, echoes it in `X-Request-ID`, and logs one line per request."""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app
        self.log = logging.getLogger("assessx.http")

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = message.setdefault("headers", [])
                headers.append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            level = logging.WARNING if status_code >= 500 else logging.INFO
            self.log.log(
                level,
                "%s %s -> %s",
                request.method,
                request.url.path,
                status_code,
                extra={
                    "status": status_code,
                    "duration_ms": duration_ms,
                    "user_id": getattr(request.state, "user_id", None),
                },
            )
            request_id_var.reset(token)


__all__ = ["RequestContextMiddleware", "configure_logging", "request_id_var"]

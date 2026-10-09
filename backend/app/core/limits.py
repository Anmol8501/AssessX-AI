"""Request resource limits (Phase 8A, AX-02 / BX-15).

* `client_ip` — the client's address for rate limiting and security logs: the trusted proxy header
  named by `CLIENT_IP_HEADER` (e.g. Cloudflare's `CF-Connecting-IP`, which Cloudflare overwrites, so a
  client cannot forge it), else the connection's own address. `X-Forwarded-For` is never used for a
  security decision.
* `BodySizeLimitMiddleware` — refuses a request body larger than `MAX_REQUEST_BYTES` with 413, from
  `Content-Length` before anything is read, and while streaming for a body without one, so an
  unauthenticated client cannot make the server buffer an arbitrarily large body.
"""

import ipaddress
from typing import Any

from starlette.requests import HTTPConnection

from app.core.config import get_settings
from app.core.errors import AppError


class PayloadTooLarge(AppError):
    status_code = 413
    code = "payload_too_large"
    message = "The request is too large."


def _valid_ip(value: str) -> str | None:
    candidate = value.strip()
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def client_ip(connection: HTTPConnection) -> str:
    """The client's address as far as this deployment can trust it. Never raises."""
    header = get_settings().client_ip_header
    if header:
        value = connection.headers.get(header)
        if value:
            found = _valid_ip(value.split(",")[0])
            if found:
                return found
    peer = getattr(connection, "client", None)
    return peer.host if peer else "unknown"


class BodySizeLimitMiddleware:
    """Pure ASGI: bounds the request body. Applies to HTTP only (WebSocket frames are bounded by the
    server's `ws_max_size`)."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = get_settings().max_request_bytes
        declared = next((v for k, v in scope.get("headers", []) if k == b"content-length"), None)
        if declared is not None:
            try:
                if int(declared) > limit:
                    await _too_large(send)
                    return
            except ValueError:
                await _too_large(send, status=400, code="bad_request", message="Invalid Content-Length.")
                return

        if declared is None:
            # No declared length (chunked): read the body here, up to the limit, so an oversized one is
            # answered 413 before the application buffers or parses any of it; then replay it.
            buffered: list[dict[str, Any]] = []
            total = 0
            while True:
                message = await receive()
                if message["type"] != "http.request":
                    buffered.append(message)
                    break
                total += len(message.get("body", b""))
                if total > limit:
                    await _too_large(send)
                    return
                buffered.append(message)
                if not message.get("more_body", False):
                    break

            async def replay() -> dict[str, Any]:
                return buffered.pop(0) if buffered else await receive()

            await self.app(scope, replay, send)
            return

        received = 0

        async def bounded_receive() -> dict[str, Any]:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # More than the declared length: refuse rather than keep reading.
                    raise PayloadTooLarge()
            return message

        await self.app(scope, bounded_receive, send)


async def _too_large(
    send: Any, status: int = 413, code: str = "payload_too_large", message: str = ""
) -> None:
    import json

    body = json.dumps({"error": {"code": code, "message": message or PayloadTooLarge.message}}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})


class SecurityHeadersMiddleware:
    """Defensive headers on every HTTP response (Phase 8A, AX-11). The API serves JSON only, so the
    strictest policy fits: nothing may be framed, sniffed, cached or loaded from it. HSTS only in
    production (always HTTPS there). The development-only `/docs` page is left alone."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("path", "").startswith(("/docs", "/openapi.json")):
            await self.app(scope, receive, send)
            return
        production = get_settings().is_production

        async def with_headers(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                extra = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"cache-control", b"no-store"),
                    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
                    (b"cross-origin-resource-policy", b"cross-origin"),
                ]
                if production:
                    extra.append((b"strict-transport-security", b"max-age=31536000"))
                headers += [(k, v) for k, v in extra if k not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, with_headers)

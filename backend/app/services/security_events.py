"""Security events, alert rules and alert delivery (Phase 8 final: CX-02, CX-03, CX-13).

    something security-relevant happens ──▶ record(event)  (own short transaction: survives a failed request)
                                               │
                                               ▼
                         rules for that event type: count in a window (optionally distinct), per group
                                               │ threshold reached, no alert for this rule+group in cooldown
                                               ▼
                         security_alerts row ──▶ log line "SECURITY ALERT" ──▶ optional webhook (no secrets)

**Normal proctoring observations are never security events** (a face out of view, a focus change). Only
attacks, refusals, abuse, integrity and availability problems are. Nothing secret is recorded: no
password, token, key, URL, answer text or video; accounts appear as a user id or an HMAC.
The taxonomy below is the single source of truth; docs/SECURITY-OPERATIONS.md describes it.
"""

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import re
import threading
import urllib.request
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import client_ip_var, request_id_var
from app.models.base import utcnow
from app.models.security_event import SecurityAlert, SecurityEvent

log = logging.getLogger("assessx.security")

#: event type → (severity, category, what it means)
TAXONOMY: dict[str, tuple[str, str, str]] = {
    "sign_in_failed": ("LOW", "authentication", "A sign-in with wrong credentials"),
    "sign_in_throttled": ("HIGH", "authentication", "Sign-in throttling engaged for an account or address"),
    "authentication_failed": ("LOW", "authentication", "A request with an invalid, expired or revoked token"),
    "maintenance_auth_failed": ("HIGH", "authentication", "A maintenance call with a wrong token"),
    "mfa_failed": ("MEDIUM", "account", "A wrong admin second-factor code"),
    "mfa_recovery_used": ("HIGH", "account", "An admin signed in with a recovery code"),
    "mfa_reset": ("HIGH", "account", "An admin's second factor was reset"),
    "admin_new_ip": ("MEDIUM", "account", "An admin signed in from an address not seen in 30 days"),
    "sessions_revoked_bulk": ("HIGH", "account", "Many sessions of one account ended at once"),
    "exam_takeover": ("MEDIUM", "account", "An exam in progress moved to another sign-in"),
    "authorization_denied": ("MEDIUM", "authorization", "A signed-in user was refused a resource (403)"),
    "resource_probe": ("LOW", "authorization", "A signed-in user asked for an id that is not theirs (404)"),
    "rate_limited": ("LOW", "abuse", "A request was refused by a rate limit (429)"),
    "code_run_limited": ("LOW", "abuse", "A code run was refused by its limits"),
    "download_rate_limited": ("MEDIUM", "abuse", "A download was refused by its rate limit"),
    "websocket_auth_failed": ("LOW", "realtime", "A WebSocket without a valid ticket"),
    "websocket_abuse": ("HIGH", "realtime", "A WebSocket closed for flooding or oversized messages"),
    "websocket_connection_limit": ("MEDIUM", "realtime", "Too many WebSockets for one user"),
    "server_error": ("LOW", "availability", "The API answered 5xx"),
    "storage_failure": ("HIGH", "availability", "Evidence storage refused an operation"),
    "backup_failed": ("HIGH", "recovery", "A scheduled backup reported failure"),
    "backup_missing": ("HIGH", "recovery", "No successful backup within the expected interval"),
    "evidence_access_limited": ("HIGH", "evidence", "Evidence views refused by their rate limit"),
    "evidence_integrity_failed": ("CRITICAL", "integrity", "A stored clip no longer matches its hash"),
    "audit_integrity_failed": ("CRITICAL", "integrity", "The audit hash chain does not verify"),
    "ai_injection_suspected": ("MEDIUM", "ai", "An interview answer contains instruction-like text"),
}

SEVERITY_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


@dataclass(frozen=True)
class Rule:
    name: str
    event_types: tuple[str, ...]
    threshold: int
    window_seconds: int
    severity: str
    #: "actor" | "client" | "account" | "global"
    group_by: str
    #: count distinct values of this details key instead of rows (e.g. accounts in a spray)
    distinct: str | None = None
    cooldown_seconds: int = 1800


RULES: tuple[Rule, ...] = (
    Rule("sign_in_spray", ("sign_in_failed",), 10, 900, "CRITICAL", "global", distinct="account_key"),
    Rule("account_brute_force", ("sign_in_failed",), 5, 900, "MEDIUM", "account"),
    Rule("sign_in_throttled", ("sign_in_throttled",), 1, 900, "HIGH", "client"),
    Rule("repeated_authorization_denied", ("authorization_denied",), 5, 600, "HIGH", "actor"),
    Rule("cross_resource_probing", ("resource_probe",), 10, 600, "HIGH", "actor"),
    Rule(
        "mass_cross_candidate_access",
        ("resource_probe", "authorization_denied"),
        100,
        600,
        "CRITICAL",
        "global",
    ),
    Rule(
        "invalid_token_flood", ("authentication_failed", "websocket_auth_failed"), 20, 600, "MEDIUM", "client"
    ),
    Rule("websocket_abuse", ("websocket_abuse", "websocket_connection_limit"), 1, 1800, "HIGH", "actor"),
    Rule("error_spike", ("server_error",), 20, 300, "CRITICAL", "global"),
    Rule(
        "integrity_failure",
        ("evidence_integrity_failed", "audit_integrity_failed"),
        1,
        3600,
        "CRITICAL",
        "global",
    ),
    Rule("storage_failure", ("storage_failure",), 3, 1800, "HIGH", "global"),
    Rule("backup_problem", ("backup_failed", "backup_missing"), 1, 43200, "HIGH", "global"),
    Rule("evidence_access_abuse", ("evidence_access_limited",), 1, 1800, "HIGH", "actor"),
    Rule("ai_injection_abuse", ("ai_injection_suspected",), 3, 3600, "HIGH", "actor"),
    Rule("admin_new_ip", ("admin_new_ip",), 1, 3600, "MEDIUM", "actor"),
    Rule("admin_mfa_failures", ("mfa_failed",), 5, 900, "CRITICAL", "actor"),
    Rule(
        "admin_account_change",
        ("mfa_reset", "mfa_recovery_used", "sessions_revoked_bulk"),
        1,
        600,
        "HIGH",
        "actor",
    ),
    Rule(
        "abusive_requests",
        ("rate_limited", "code_run_limited", "download_rate_limited"),
        30,
        600,
        "MEDIUM",
        "client",
    ),
    Rule("maintenance_auth", ("maintenance_auth_failed",), 3, 3600, "HIGH", "client"),
    Rule("exam_takeovers", ("exam_takeover",), 3, 3600, "MEDIUM", "actor"),
)


# -- where events are written (patched in tests) -------------------------------------------------------------

_session_override: Session | None = None
_factory_override: Callable[[], Session] | None = None


def use_session(db: Session | None) -> None:
    """Tests: write events into the test transaction instead of a separate one."""
    global _session_override
    _session_override = db


def use_factory(factory: Callable[[], Session] | None) -> None:
    """Tests: open the separate transaction against the test database."""
    global _factory_override
    _factory_override = factory


@contextlib.contextmanager
def _session() -> Iterator[Session]:
    if _session_override is not None:
        yield _session_override
        _session_override.flush()
        return
    if _factory_override is not None:
        factory = _factory_override
    else:
        from app.core.database import SessionLocal

        factory = SessionLocal
    with factory() as db:
        yield db
        db.commit()


def account_key(account: str) -> str:
    """An account reference that can be correlated but not read (HMAC with SECRET_KEY)."""
    secret = get_settings().secret_key.encode()
    return hmac.new(secret, account.strip().lower().encode(), hashlib.sha256).hexdigest()[:24]


# -- recording -------------------------------------------------------------------------------------


def record(
    event_type: str,
    *,
    actor_id: uuid.UUID | str | None = None,
    client_ip: str | None = None,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    """Records one security event and evaluates its alert rules. Never raises."""
    try:
        severity, category, _ = TAXONOMY[event_type]
    except KeyError:
        log.error("Unknown security event type", extra={"event_type": event_type})
        return
    try:
        with _session() as db:
            event = SecurityEvent(
                occurred_at=utcnow(),
                event_type=event_type,
                severity=severity,
                category=category,
                request_id=(request_id or request_id_var.get() or None),
                actor_id=uuid.UUID(str(actor_id)) if actor_id else None,
                client_ip=(client_ip or client_ip_var.get() or None),
                target_type=target_type,
                target_id=str(target_id)[:64] if target_id else None,
                details=_safe(details or {}),
            )
            db.add(event)
            db.flush()
            log.log(
                logging.WARNING if SEVERITY_ORDER[severity] >= 2 else logging.INFO,
                "Security event",
                extra={"security_event": event_type, "severity": severity, "actor_id": str(actor_id or "")},
            )
            evaluate(db, event)
    except Exception:  # noqa: BLE001 — monitoring must never break the action it watches
        log.exception("Security event could not be recorded", extra={"security_event": event_type})


_SECRETISH = re.compile(r"(password|token|secret|key|authorization|cookie|signature)", re.IGNORECASE)


def _safe(details: dict[str, Any]) -> dict[str, Any]:
    """Drops anything that looks like a credential, and bounds every value."""
    clean: dict[str, Any] = {}
    for key, value in list(details.items())[:16]:
        if _SECRETISH.search(key) and key != "account_key":
            continue
        if isinstance(value, str):
            value = value[:200]
        elif not isinstance(value, int | float | bool) and value is not None:
            value = str(value)[:200]
        clean[str(key)[:40]] = value
    return clean


_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
#: 404s on these prefixes, for a signed-in user, are probes for someone else's resource.
_PROBE_PREFIXES = ("/api/v1/candidates/me/", "/api/v1/admin/", "/api/v1/assessments/", "/api/v1/interviews/")


def classify_response(*, path: str, status: int, user_id: str | None, had_credentials: bool) -> str | None:
    """Which security event (if any) an HTTP response represents."""
    if not path.startswith("/api/"):
        return None
    if status >= 500:
        return "server_error"
    if status == 401 and had_credentials and not path.startswith("/api/v1/auth/login"):
        return "authentication_failed"
    if status == 403 and user_id:
        return "authorization_denied"
    if status == 404 and user_id and _UUID.search(path) and path.startswith(_PROBE_PREFIXES):
        return "resource_probe"
    if status == 429:
        return "code_run_limited" if path.endswith(("/runs", "/submissions")) else "rate_limited"
    return None


async def observe_response(
    *,
    method: str,
    path: str,
    status: int,
    user_id: str | None,
    role: str | None,
    client: str | None,
    request_id: str,
    had_credentials: bool,
) -> None:
    event_type = classify_response(path=path, status=status, user_id=user_id, had_credentials=had_credentials)
    if event_type is None:
        return
    target = _UUID.search(path)
    await asyncio.to_thread(
        record,
        event_type,
        actor_id=user_id,
        client_ip=client,
        target_type="path",
        target_id=target.group(0) if target else None,
        details={"method": method, "path": _UUID.sub("{id}", path)[:200], "status": status, "role": role},
        request_id=request_id,
    )


# -- alerting --------------------------------------------------------------------------------------


def _group(rule: Rule, event: SecurityEvent) -> tuple[str, Any] | None:
    if rule.group_by == "global":
        return "global", None
    if rule.group_by == "actor":
        return (str(event.actor_id), SecurityEvent.actor_id == event.actor_id) if event.actor_id else None
    if rule.group_by == "client":
        return (event.client_ip, SecurityEvent.client_ip == event.client_ip) if event.client_ip else None
    if rule.group_by == "account":
        key = event.details.get("account_key")
        return (f"account:{key}", SecurityEvent.details["account_key"].astext == key) if key else None
    return None


def evaluate(db: Session, event: SecurityEvent, now: datetime | None = None) -> list[SecurityAlert]:
    now = now or event.occurred_at
    raised: list[SecurityAlert] = []
    for rule in RULES:
        if event.event_type not in rule.event_types:
            continue
        group = _group(rule, event)
        if group is None:
            continue
        group_key, predicate = group
        conditions = [
            SecurityEvent.event_type.in_(rule.event_types),
            SecurityEvent.occurred_at >= now - timedelta(seconds=rule.window_seconds),
        ]
        if predicate is not None:
            conditions.append(predicate)
        counted = (
            func.count(func.distinct(SecurityEvent.details[rule.distinct].astext))
            if rule.distinct
            else func.count()
        )
        count = db.scalar(select(counted).select_from(SecurityEvent).where(*conditions)) or 0
        if count < rule.threshold:
            continue
        recent = db.scalar(
            select(SecurityAlert.id).where(
                SecurityAlert.rule == rule.name,
                SecurityAlert.group_key == group_key[:80],
                SecurityAlert.created_at >= now - timedelta(seconds=rule.cooldown_seconds),
            )
        )
        if recent is not None:
            continue  # deduplicated: one alert per rule and group per cooldown
        types = "/".join(rule.event_types)
        summary = (
            f"[{rule.severity}] {rule.name}: {count} × {types} "
            f"in {rule.window_seconds // 60} min ({rule.group_by})"
        )
        alert = SecurityAlert(
            created_at=now,
            rule=rule.name,
            severity=rule.severity,
            group_key=group_key[:80],
            event_count=count,
            summary=summary[:300],
            delivery="webhook" if get_settings().alert_webhook_url else "logged",
        )
        db.add(alert)
        db.flush()
        raised.append(alert)
        log.error("SECURITY ALERT", extra={"rule": rule.name, "severity": rule.severity, "count": count})
        notify(alert)
    return raised


Transport = Callable[[str, bytes], None]


def _post(url: str, body: bytes) -> None:
    request = urllib.request.Request(  # noqa: S310 — operator-configured https URL
        url, data=body, method="POST", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310
        response.read()


_transport: Transport = _post


def use_transport(transport: Transport | None) -> None:
    global _transport
    _transport = transport or _post


def notify(alert: SecurityAlert) -> None:
    """Sends the alert to the configured webhook (Slack/Discord/ntfy-compatible JSON), in the background."""
    setting = get_settings().alert_webhook_url
    if not setting:
        return
    url = setting.get_secret_value()
    body = json.dumps(
        {
            # "text" (Slack, ntfy) and "content" (Discord) carry the same summary; no secrets, no ids.
            "text": f"AssessX security alert — {alert.summary}",
            "content": f"AssessX security alert — {alert.summary}",
            "severity": alert.severity,
            "rule": alert.rule,
            "count": alert.event_count,
            "at": alert.created_at.isoformat(),
        }
    ).encode()

    def send() -> None:
        try:
            _transport(url, body)
        except Exception as error:  # noqa: BLE001
            log.warning("Alert delivery failed", extra={"rule": alert.rule, "error": type(error).__name__})

    threading.Thread(target=send, daemon=True).start()

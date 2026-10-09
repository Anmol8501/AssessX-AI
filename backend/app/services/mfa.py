"""Admin two-factor authentication: TOTP (RFC 6238) with recovery codes (Phase 8 final, CX-07).

* **The secret is protected at rest.** 160 random bits, stored encrypted with keys derived from SECRET_KEY:
  an HMAC-SHA256 keystream (counter mode) and an HMAC-SHA256 tag over nonce + ciphertext (encrypt-then-MAC).
  It is shown once, during enrolment, and never logged. Rotating SECRET_KEY invalidates every enrolment
  (admins re-enrol; docs/INCIDENT-RESPONSE.md).
* **Codes are accepted once.** ±1 thirty-second step for clock drift, and never a step at or before the last
  accepted one (anti-replay).
* **Recovery codes** (10) are stored as HMACs and consumed on use; using one is audited and alerted.
* **Throttled.** Wrong codes count per admin; the 5th within 15 minutes locks verification for a while, and
  every failure is a security event (5 in 15 minutes raise a CRITICAL alert).
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
import urllib.parse
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError, Conflict, Forbidden, TooManyAttempts
from app.core.logging import request_id_var
from app.models.audit_log import AuditAction, AuditLog
from app.models.auth_session import AuthSession
from app.models.base import utcnow
from app.models.user import User, UserRole
from app.repositories.audit import AuditRepository
from app.services import security_events
from app.services.rate_limit import RateLimiter

PERIOD = 30
DIGITS = 6
RECOVERY_CODES = 10
MAX_FAILURES = 5
FAILURE_WINDOW = timedelta(minutes=15)
ISSUER = "AssessX"


class MfaInvalid(AppError):
    status_code = 400
    code = "mfa_invalid"
    message = "That code is not valid. Check your authenticator app and try again."


class MfaRequired(Forbidden):
    code = "mfa_required"
    message = "Finish signing in with your authenticator code."


# -- primitives ----------------------------------------------------------------------------------------------


def _keys(settings: Settings) -> tuple[bytes, bytes]:
    root = settings.secret_key.encode()
    return (
        hmac.new(root, b"assessx-mfa-enc-v1", hashlib.sha256).digest(),
        hmac.new(root, b"assessx-mfa-mac-v1", hashlib.sha256).digest(),
    )


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = b""
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + struct.pack(">I", counter), hashlib.sha256).digest()
        counter += 1
    return out[:length]


def seal(secret: str, settings: Settings) -> str:
    enc, mac = _keys(settings)
    nonce = secrets.token_bytes(16)
    plain = secret.encode()
    cipher = bytes(a ^ b for a, b in zip(plain, _keystream(enc, nonce, len(plain)), strict=True))
    tag = hmac.new(mac, nonce + cipher, hashlib.sha256).digest()[:16]
    return "v1:" + base64.urlsafe_b64encode(nonce + cipher + tag).decode()


def unseal(sealed: str, settings: Settings) -> str:
    if not sealed.startswith("v1:"):
        raise ValueError("unknown format")
    raw = base64.urlsafe_b64decode(sealed[3:])
    nonce, cipher, tag = raw[:16], raw[16:-16], raw[-16:]
    enc, mac = _keys(settings)
    if not hmac.compare_digest(tag, hmac.new(mac, nonce + cipher, hashlib.sha256).digest()[:16]):
        raise ValueError("tampered or wrong key")
    return bytes(a ^ b for a, b in zip(cipher, _keystream(enc, nonce, len(cipher)), strict=True)).decode()


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10**DIGITS).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) // PERIOD)


def otpauth_uri(secret: str, account: str) -> str:
    label = urllib.parse.quote(f"{ISSUER}:{account}")
    query = urllib.parse.urlencode({"secret": secret, "issuer": ISSUER, "digits": DIGITS, "period": PERIOD})
    return f"otpauth://totp/{label}?{query}"


def _recovery_hash(code: str, settings: Settings) -> str:
    normal = code.strip().lower().replace("-", "").replace(" ", "")
    return hmac.new(
        settings.secret_key.encode(), b"mfa-recovery:" + normal.encode(), hashlib.sha256
    ).hexdigest()


# -- the service --------------------------------------------------------------------------------------------


class MfaService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditRepository(db)
        self.limiter = RateLimiter(db, settings)

    def required_for(self, user: User) -> bool:
        return user.role is UserRole.ADMIN and (self.settings.mfa_required or user.mfa_enabled)

    @staticmethod
    def _admin(session: AuthSession) -> User:
        if session.user.role is not UserRole.ADMIN:
            raise Forbidden("Two-factor sign-in is for administrator accounts.")
        return session.user

    def begin_enrolment(self, session: AuthSession) -> tuple[str, str]:
        """A new secret for this admin (pending until confirmed with a code). Shown once."""
        user = self._admin(session)
        if user.mfa_enabled:
            raise Conflict("Two-factor sign-in is already set up for this account.")
        secret = new_secret()
        user.mfa_secret_enc = seal(secret, self.settings)
        user.mfa_last_step = None
        self.db.flush()
        return secret, otpauth_uri(secret, user.email)

    def confirm_enrolment(self, session: AuthSession, code: str, client: str | None) -> list[str]:
        user = self._admin(session)
        if user.mfa_enabled or not user.mfa_secret_enc:
            raise Conflict("Start the set-up first.")
        self._check_code(user, code, client)
        codes = [
            f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}"
            for _ in range(RECOVERY_CODES)
        ]
        user.mfa_recovery_hashes = [_recovery_hash(c, self.settings) for c in codes]
        user.mfa_enabled_at = utcnow()
        session.mfa_verified_at = utcnow()
        self.db.flush()
        self.audit.record(actor_id=user.id, action=AuditAction.MFA_ENABLED, details={})
        return codes

    def verify(
        self, session: AuthSession, code: str | None, recovery_code: str | None, client: str | None
    ) -> None:
        user = self._admin(session)
        if not user.mfa_enabled:
            raise Conflict("Two-factor sign-in is not set up for this account yet.")
        if recovery_code:
            self._use_recovery(user, recovery_code, client)
        else:
            self._check_code(user, code or "", client)
        session.mfa_verified_at = utcnow()
        self.db.flush()
        self.note_admin_address(user, client)

    def _throttle_key(self, user: User) -> str:
        return self.limiter.key("mfa", str(user.id))

    def _guard(self, user: User) -> None:
        key = self._throttle_key(user)
        if self.limiter.count("mfa", key, FAILURE_WINDOW) >= MAX_FAILURES:
            raise TooManyAttempts(self.limiter.retry_after("mfa", key, FAILURE_WINDOW))

    def _fail(self, user: User, client: str | None, kind: str) -> None:
        self.limiter.hit("mfa", self._throttle_key(user))
        security_events.record("mfa_failed", actor_id=user.id, client_ip=client, details={"kind": kind})
        raise MfaInvalid()

    def _check_code(self, user: User, code: str, client: str | None) -> None:
        self._guard(user)
        code = code.strip().replace(" ", "")
        if not (code.isdigit() and len(code) == DIGITS) or not user.mfa_secret_enc:
            self._fail(user, client, "format")
        try:
            secret = unseal(user.mfa_secret_enc, self.settings)
        except ValueError:
            # The stored secret cannot be read (SECRET_KEY changed, or the row was altered).
            security_events.record(
                "mfa_failed", actor_id=user.id, client_ip=client, details={"kind": "secret"}
            )
            raise MfaInvalid() from None
        now = current_step()
        for step in (now - 1, now, now + 1):
            if hmac.compare_digest(totp(secret, step), code):
                if user.mfa_last_step is not None and step <= user.mfa_last_step:
                    self._fail(user, client, "replay")
                user.mfa_last_step = step
                self.limiter.clear("mfa", self._throttle_key(user))
                return
        self._fail(user, client, "code")

    def _use_recovery(self, user: User, code: str, client: str | None) -> None:
        self._guard(user)
        hashed = _recovery_hash(code, self.settings)
        remaining = list(user.mfa_recovery_hashes or [])
        match = next((h for h in remaining if hmac.compare_digest(h, hashed)), None)
        if match is None:
            self._fail(user, client, "recovery")
        remaining.remove(match)
        user.mfa_recovery_hashes = remaining
        self.audit.record(
            actor_id=user.id, action=AuditAction.MFA_RECOVERY_USED, details={"left": len(remaining)}
        )
        security_events.record(
            "mfa_recovery_used", actor_id=user.id, client_ip=client, details={"left": len(remaining)}
        )

    def reset(self, target: User, actor: User) -> None:
        """Clears an admin's second factor (they re-enrol at next sign-in) and ends their sessions."""
        if target.role is not UserRole.ADMIN:
            raise Forbidden("Only administrator accounts have two-factor sign-in.")
        target.mfa_secret_enc = None
        target.mfa_enabled_at = None
        target.mfa_last_step = None
        target.mfa_recovery_hashes = None
        from app.repositories.auth_sessions import AuthSessionRepository

        ended = AuthSessionRepository(self.db).revoke_all(target.id, utcnow())
        self.db.flush()
        self.audit.record(
            actor_id=actor.id, action=AuditAction.MFA_RESET, details={"user_id": str(target.id)}
        )
        security_events.record(
            "mfa_reset",
            actor_id=actor.id,
            target_type="user",
            target_id=target.id,
            details={"sessions": ended},
        )

    def note_admin_address(self, user: User, client: str | None) -> None:
        """A security event when an admin signs in from an address not seen for them in 30 days."""
        if user.role is not UserRole.ADMIN or not client:
            return
        seen = self.db.scalar(
            select(AuditLog.id)
            .where(
                AuditLog.actor_id == user.id,
                AuditLog.action == AuditAction.SIGN_IN_SUCCEEDED,
                AuditLog.client_ip == client,
                AuditLog.occurred_at >= utcnow() - timedelta(days=30),
                AuditLog.request_id.is_distinct_from(request_id_var.get()),  # not this sign-in itself
            )
            .limit(1)
        )
        if seen is None:
            security_events.record("admin_new_ip", actor_id=user.id, client_ip=client, details={})

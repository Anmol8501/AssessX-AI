"""Authentication: credential verification and server-side sessions.

Route handlers call this service; it owns every rule about who may sign in and for how long.
"""

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import NoReturn

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import (
    AccountInactive,
    ChallengeInvalid,
    CurrentPasswordIncorrect,
    InvalidCredentials,
    NotFound,
    Unauthorized,
    ValidationFailed,
)
from app.core.security import generate_token, hash_password, hash_token, needs_rehash, verify_password
from app.models.audit_log import AuditAction
from app.models.auth_session import AuthSession
from app.models.base import utcnow
from app.models.security import PasswordResetCode
from app.models.user import User, UserRole
from app.repositories.audit import AuditRepository
from app.repositories.auth_sessions import AuthSessionRepository
from app.repositories.users import UserRepository
from app.services import security_events
from app.services.challenges import LoginChallengeService
from app.services.login_throttle import LoginThrottle

#: New passwords: at least this long (administrators: `ADMIN_PASSWORD_MIN_LENGTH`), at most 128.
PASSWORD_MIN_LENGTH = 8
ADMIN_PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128

log = logging.getLogger("assessx.auth")


def _same(stored: str | None, supplied: str) -> bool:
    """Case-insensitive, whitespace-tolerant identifier comparison in constant time."""
    if stored is None:
        return False
    return secrets.compare_digest(stored.strip().lower().encode(), supplied.strip().lower().encode())


# How often `last_seen_at` is written back; avoids a write on every request.
_TOUCH_INTERVAL = timedelta(minutes=5)


@dataclass(frozen=True)
class IssuedSession:
    token: str
    expires_at: datetime
    user: User


def _domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].strip().lower()[:100] if "@" in email else ""


#: Ending this many sessions of one account at once is worth a security event.
BULK_REVOCATION = 5


class AuthService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.users = UserRepository(db)
        self.sessions = AuthSessionRepository(db)
        self.challenges = LoginChallengeService(db, settings)
        self.throttle = LoginThrottle(db, settings)
        self.audit = AuditRepository(db)

    # -- sign in -------------------------------------------------------------------------

    def login_candidate(
        self,
        *,
        roll_number: str,
        email: str,
        password: str,
        challenge_id: uuid.UUID,
        challenge_answer: str,
        remember: bool,
        client: str = "unknown",
    ) -> IssuedSession:
        """Candidate sign-in: throttle, security check, then roll number + email + password must all match."""
        return self._login(
            form="candidate",
            email=email,
            password=password,
            challenge_id=challenge_id,
            challenge_answer=challenge_answer,
            remember=remember,
            client=client,
            matches=lambda user: user.role is UserRole.CANDIDATE and _same(user.roll_number, roll_number),
        )

    def login_admin(
        self,
        *,
        username: str,
        email: str,
        password: str,
        challenge_id: uuid.UUID,
        challenge_answer: str,
        remember: bool,
        client: str = "unknown",
    ) -> IssuedSession:
        """Administrator sign-in: throttle, security check, then username + email + password."""
        return self._login(
            form="admin",
            email=email,
            password=password,
            challenge_id=challenge_id,
            challenge_answer=challenge_answer,
            remember=remember,
            client=client,
            matches=lambda user: user.role is UserRole.ADMIN and _same(user.username, username),
        )

    def _login(
        self, *, form, email, password, challenge_id, challenge_answer, remember, client, matches
    ) -> IssuedSession:  # noqa: ANN001, PLR0913
        account = email.strip().lower()
        # 1. Throttle first: a throttled attempt spends no challenge and hashes no password.
        wait = self.throttle.blocked(account, client)
        if wait is not None:
            from app.core.errors import TooManyAttempts

            raise TooManyAttempts(wait)
        # 2. The challenge is checked (and spent) next, so a wrong code never leaks whether the
        #    credentials were right. A wrong code counts against the client only.
        if not self.challenges.consume(challenge_id, challenge_answer):
            self.throttle.client_failed(client)
            raise ChallengeInvalid()
        # 3. The credentials. verify_password runs against a dummy hash when the user is unknown, so
        #    timing is the same for "no such account" and "wrong password". Same error for both.
        user = self.users.get_by_email(email)
        if (
            not verify_password(user.password_hash if user else None, password)
            or user is None
            or not matches(user)
        ):
            self._fail(form, account, client)
        if not user.is_active:
            log.info("Sign-in refused for inactive account", extra={"user_id": str(user.id)})
            self._record(user.id, AuditAction.SIGN_IN_FAILED, form=form, reason="inactive", client=client)
            raise AccountInactive()
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        self.throttle.succeeded(account, client)
        issued = self._issue(user, remember)
        self._record(user.id, AuditAction.SIGN_IN_SUCCEEDED, form=form, remember=remember, client=client)
        if user.role is UserRole.ADMIN and not user.mfa_enabled:
            # Without a second factor, the password sign-in itself is the moment to check the address.
            from app.services.mfa import MfaService

            MfaService(self.db, self.settings).note_admin_address(user, client)
        return issued

    def _fail(self, form: str, account: str, client: str) -> NoReturn:
        log.info("Failed sign-in attempt", extra={"email_domain": _domain(account)})
        reached = self.throttle.failed(account, client)
        self._record(
            None,
            AuditAction.SIGN_IN_FAILED,
            form=form,
            reason="credentials",
            email_domain=_domain(account),
            client=client,
        )
        security_events.record(
            "sign_in_failed",
            client_ip=client,
            details={"form": form, "account_key": security_events.account_key(account)},
        )
        if reached:
            log.warning("Sign-in throttled", extra={"email_domain": _domain(account)})
            self._record(
                None, AuditAction.SIGN_IN_THROTTLED, form=form, email_domain=_domain(account), client=client
            )
            security_events.record(
                "sign_in_throttled",
                client_ip=client,
                details={"form": form, "account_key": security_events.account_key(account)},
            )
        raise InvalidCredentials()

    def _record(self, actor_id: uuid.UUID | None, action: AuditAction, **details: object) -> None:
        self.audit.record(
            actor_id=actor_id, action=action, details={k: v for k, v in details.items() if v is not None}
        )

    def _issue(self, user: User, remember: bool) -> IssuedSession:
        now = utcnow()
        if user.role is UserRole.ADMIN:
            # Admin sessions are short and never "remembered" (Phase 8 final, CX-07).
            remember = False
            ttl = timedelta(hours=min(self.settings.session_ttl_hours, self.settings.admin_session_ttl_hours))
        else:
            ttl = (
                timedelta(days=self.settings.session_remember_ttl_days)
                if remember
                else timedelta(hours=self.settings.session_ttl_hours)
            )
        token = generate_token()
        self.sessions.add(
            AuthSession(
                user_id=user.id,
                token_hash=hash_token(token, self.settings.secret_key),
                remember=remember,
                expires_at=now + ttl,
                last_seen_at=now,
            )
        )
        log.info("User signed in", extra={"user_id": str(user.id), "role": user.role.value})
        return IssuedSession(token=token, expires_at=now + ttl, user=user)

    # -- authenticated requests ------------------------------------------------------------

    def authenticate(self, token: str) -> AuthSession:
        """Resolves a bearer token to a live session, or raises Unauthorized."""
        session = self.sessions.get_by_token_hash(hash_token(token, self.settings.secret_key))
        now = utcnow()
        if session is None or not session.is_valid(now):
            raise Unauthorized("Your session has expired. Please sign in again.")
        if not session.user.is_active:
            raise AccountInactive()
        if now - session.last_seen_at > _TOUCH_INTERVAL:
            session.last_seen_at = now
        return session

    def logout(self, session: AuthSession) -> None:
        session.revoked_at = utcnow()
        self._record(session.user_id, AuditAction.SIGNED_OUT)
        log.info("User signed out", extra={"user_id": str(session.user_id)})

    # -- sessions and passwords (Phase 8A, AX-06) -----------------------------------------------------

    def revoke_all(self, user: User, *, actor: User, keep: AuthSession | None = None, reason: str) -> int:
        """Signs a user out everywhere (optionally keeping one session). Audited."""
        count = self.sessions.revoke_all(user.id, utcnow(), except_id=keep.id if keep else None)
        self._record(
            actor.id, AuditAction.SESSIONS_REVOKED, user_id=str(user.id), sessions=count, reason=reason
        )
        if count >= BULK_REVOCATION:
            security_events.record(
                "sessions_revoked_bulk",
                actor_id=actor.id,
                target_type="user",
                target_id=user.id,
                details={"sessions": count, "reason": reason},
            )
        return count

    @staticmethod
    def check_new_password(user: User, new_password: str) -> None:
        minimum = ADMIN_PASSWORD_MIN_LENGTH if user.role is UserRole.ADMIN else PASSWORD_MIN_LENGTH
        if not (minimum <= len(new_password) <= PASSWORD_MAX_LENGTH) or not new_password.strip():
            raise ValidationFailed(
                f"Use a password of {minimum} to {PASSWORD_MAX_LENGTH} characters.",
                details=[{"field": "new_password", "message": f"At least {minimum} characters."}],
            )

    def change_password(self, session: AuthSession, current_password: str, new_password: str) -> None:
        """The signed-in user changes their own password. Every other session of theirs ends."""
        user = session.user
        account = f"password:{user.id}"
        self.throttle.check(account, account)
        if not verify_password(user.password_hash, current_password):
            self.throttle.failed(account, account)
            raise CurrentPasswordIncorrect()
        self.check_new_password(user, new_password)
        if verify_password(user.password_hash, new_password):
            raise ValidationFailed(
                "Choose a password different from the current one.",
                details=[{"field": "new_password", "message": "Must differ from the current password."}],
            )
        user.password_hash = hash_password(new_password)
        self.throttle.succeeded(account, account)
        self.sessions.revoke_all(user.id, utcnow(), except_id=session.id)
        self._record(user.id, AuditAction.PASSWORD_CHANGED, other_sessions_ended=True)

    def set_active(self, target: User, active: bool, *, admin: User) -> User:
        """An administrator deactivates (signing them out everywhere) or reactivates a candidate."""
        if target.role is not UserRole.CANDIDATE:
            raise NotFound("Candidate not found.")
        if target.is_active != active:
            target.is_active = active
            if not active:
                self.sessions.revoke_all(target.id, utcnow())
            action = AuditAction.ACCOUNT_REACTIVATED if active else AuditAction.ACCOUNT_DEACTIVATED
            self._record(admin.id, action, user_id=str(target.id))
        self.db.flush()
        return target

    def issue_reset_code(self, target: User, *, admin: User) -> tuple[str, datetime]:
        """A one-time code the administrator hands to the candidate (no email delivery exists yet).
        Random, short-lived, single-use; only its HMAC is stored, and older unused codes are voided."""
        if target.role is not UserRole.CANDIDATE:
            raise NotFound("Candidate not found.")
        now = utcnow()
        for old in self.db.scalars(
            select(PasswordResetCode).where(
                PasswordResetCode.user_id == target.id, PasswordResetCode.used_at.is_(None)
            )
        ):
            old.used_at = now
        code = "-".join(secrets.token_hex(3).upper() for _ in range(3))  # e.g. 4F2A9C-1B7E03-D95A61 (72 bits)
        expires = now + timedelta(minutes=self.settings.password_reset_ttl_minutes)
        self.db.add(
            PasswordResetCode(
                user_id=target.id,
                code_hash=hash_token(code, self.settings.secret_key),
                created_by_id=admin.id,
                created_at=now,
                expires_at=expires,
            )
        )
        self.db.flush()
        self._record(admin.id, AuditAction.PASSWORD_RESET_ISSUED, user_id=str(target.id))
        return code, expires

    def redeem_reset_code(
        self,
        *,
        email: str,
        code: str,
        new_password: str,
        challenge_id: uuid.UUID,
        challenge_answer: str,
        client: str,
    ) -> None:
        """Sets a new password with a valid code. Every session of the account ends. One generic error
        for a wrong email, a wrong, used or expired code, so codes and accounts cannot be probed."""
        account = email.strip().lower()
        self.throttle.reset_check(account, client)
        if not self.challenges.consume(challenge_id, challenge_answer):
            self.throttle.client_failed(client)
            raise ChallengeInvalid()
        invalid = InvalidCredentials("That reset code is not valid or has expired.")
        user = self.users.get_by_email(email)
        now = utcnow()
        row = self.db.scalar(
            select(PasswordResetCode).where(
                PasswordResetCode.code_hash == hash_token(code.strip().upper(), self.settings.secret_key)
            )
        )
        if (
            user is None
            or row is None
            or row.user_id != user.id
            or row.used_at is not None
            or row.expires_at <= now
            or not user.is_active
        ):
            self.throttle.reset_failed(account, client)
            raise invalid
        self.check_new_password(user, new_password)
        user.password_hash = hash_password(new_password)
        row.used_at = now
        self.sessions.revoke_all(user.id, now)
        self._record(user.id, AuditAction.PASSWORD_RESET_COMPLETED, client=client)
        self.db.flush()

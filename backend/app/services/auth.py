"""Authentication: credential verification and server-side sessions.

Route handlers call this service; it owns every rule about who may sign in and for how long.
"""

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import NoReturn

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AccountInactive, ChallengeInvalid, InvalidCredentials, Unauthorized
from app.core.security import generate_token, hash_password, hash_token, needs_rehash, verify_password
from app.models.auth_session import AuthSession
from app.models.base import utcnow
from app.models.user import User, UserRole
from app.repositories.auth_sessions import AuthSessionRepository
from app.repositories.users import UserRepository
from app.services.challenges import LoginChallengeService

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


class AuthService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.users = UserRepository(db)
        self.sessions = AuthSessionRepository(db)
        self.challenges = LoginChallengeService(db, settings)

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
    ) -> IssuedSession:
        """Candidate sign-in: security check, then roll number + email + password must all match."""
        # The challenge is checked (and spent) first so a wrong code never leaks whether
        # the credentials were right.
        if not self.challenges.consume(challenge_id, challenge_answer):
            raise ChallengeInvalid()
        user = self._verify(email, password)
        if user.role is not UserRole.CANDIDATE or not _same(user.roll_number, roll_number):
            self._fail(email)
        return self._issue(user, remember)

    def login_admin(
        self,
        *,
        username: str,
        email: str,
        password: str,
        challenge_id: uuid.UUID,
        challenge_answer: str,
        remember: bool,
    ) -> IssuedSession:
        """Administrator sign-in: security check, then username + email + password must all match."""
        if not self.challenges.consume(challenge_id, challenge_answer):
            raise ChallengeInvalid()
        user = self._verify(email, password)
        if user.role is not UserRole.ADMIN or not _same(user.username, username):
            self._fail(email)
        return self._issue(user, remember)

    def _verify(self, email: str, password: str) -> User:
        user = self.users.get_by_email(email)
        # verify_password runs against a dummy hash when the user is unknown, so timing is
        # the same for "no such account" and "wrong password". Same error for both.
        if not verify_password(user.password_hash if user else None, password) or user is None:
            self._fail(email)
        if not user.is_active:
            log.info("Sign-in refused for inactive account", extra={"user_id": str(user.id)})
            raise AccountInactive()
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        return user

    @staticmethod
    def _fail(email: str) -> NoReturn:
        log.info("Failed sign-in attempt", extra={"email_domain": email.rsplit("@", 1)[-1]})
        raise InvalidCredentials()

    def _issue(self, user: User, remember: bool) -> IssuedSession:
        now = utcnow()
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
        log.info("User signed out", extra={"user_id": str(session.user_id)})

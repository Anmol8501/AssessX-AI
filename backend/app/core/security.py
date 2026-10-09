"""Password hashing and opaque session-token helpers.

Passwords: Argon2id with argon2-cffi's defaults (64 MiB memory, 3 iterations, 4 lanes), the
current OWASP recommendation. Tokens: 256-bit random values; only an HMAC of the token is
persisted, so a leaked database row cannot be replayed without the server secret.
"""

import hashlib
import hmac
import secrets
import threading
from collections.abc import Callable

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()


#: Argon2id needs 64 MiB per hash. Bounding how many run at once keeps a burst of sign-ins (or an
#: attack) from exhausting the server's memory; others wait up to `_HASH_WAIT_SECONDS` (Phase 8A, AX-02).
_HASH_WAIT_SECONDS = 15.0
_hash_slots: threading.BoundedSemaphore | None = None
_slots_lock = threading.Lock()


def _slots() -> threading.BoundedSemaphore:
    global _hash_slots
    with _slots_lock:
        if _hash_slots is None:
            from app.core.config import get_settings

            _hash_slots = threading.BoundedSemaphore(get_settings().password_hash_concurrency)
        return _hash_slots


def _bounded[T](work: Callable[[], T]) -> T:
    slots = _slots()
    if not slots.acquire(timeout=_HASH_WAIT_SECONDS):
        from app.core.errors import ServerBusy

        raise ServerBusy()
    try:
        return work()
    finally:
        slots.release()


# Verified against on unknown-user logins so response time does not reveal whether an email exists.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _bounded(lambda: _hasher.hash(password))


def verify_password(password_hash: str | None, password: str) -> bool:
    def verify() -> bool:
        try:
            return _hasher.verify(password_hash or _DUMMY_HASH, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    return _bounded(verify)


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str, secret_key: str) -> str:
    return hmac.new(secret_key.encode(), token.encode(), hashlib.sha256).hexdigest()

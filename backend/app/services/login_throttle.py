"""Sign-in throttling (Phase 8A, AX-01).

Failed sign-ins are counted in a sliding window under three keys, so that:

* one client cannot try many passwords on one account (`account+client`, default 5 per 15 min);
* one account cannot be attacked from many clients at once (`account`, default 20 per 15 min);
* one client cannot try one password on many accounts (`client`, default 30 per 15 min).

Reaching a limit refuses further attempts for that key — **before** the challenge is spent or a password
is hashed — until the oldest failure leaves the window. Nothing is ever locked permanently, and the
per-(account, client) limit is reached long before the per-account one, so a single attacker cannot keep a
legitimate user out of their own account from another machine.

**No account oracle.** The account key is the identifier *as typed* (email), not a user id, so an address
that has no account is throttled exactly like one that does, with the same message. A successful sign-in
clears that account's counters (including the attempts made from this client).
"""

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import TooManyAttempts
from app.services.rate_limit import RateLimiter

PAIR = "login_pair"
ACCOUNT = "login_account"
CLIENT = "login_client"
CHALLENGE = "challenge_client"
RESET = "reset_pair"


class LoginThrottle:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.limiter = RateLimiter(db, settings)
        self.settings = settings
        self.window = timedelta(seconds=settings.login_window_seconds)

    def _keys(self, account: str, client: str) -> list[tuple[str, str, int]]:
        s = self.settings
        return [
            (PAIR, self.limiter.key(account, client), s.login_max_failures_per_account_client),
            (ACCOUNT, self.limiter.key(account), s.login_max_failures_per_account),
            (CLIENT, self.limiter.key(client), s.login_max_failures_per_client),
        ]

    def blocked(self, account: str, client: str) -> int | None:
        """Seconds to wait when any limit is reached for this attempt, else None."""
        for bucket, key, limit in self._keys(account, client):
            if self.limiter.count(bucket, key, self.window) >= limit:
                return self.limiter.retry_after(bucket, key, self.window)
        return None

    def check(self, account: str, client: str) -> None:
        wait = self.blocked(account, client)
        if wait is not None:
            raise TooManyAttempts(wait)

    def failed(self, account: str, client: str) -> bool:
        """Counts a failure. True when this failure reached a limit (the moment worth an audit row)."""
        reached = False
        for bucket, key, limit in self._keys(account, client):
            self.limiter.hit(bucket, key)
            if self.limiter.count(bucket, key, self.window) == limit:
                reached = True
        return reached

    def client_failed(self, client: str) -> None:
        """A failure attributable to the client only (a wrong or reused challenge answer)."""
        self.limiter.hit(CLIENT, self.limiter.key(client))

    def succeeded(self, account: str, client: str) -> None:
        self.limiter.clear(PAIR, self.limiter.key(account, client))
        self.limiter.clear(ACCOUNT, self.limiter.key(account))

    # -- challenges ------------------------------------------------------------------------------------

    def challenge_issued(self, client: str) -> None:
        """Counts an issued challenge; refuses once a client has asked for too many in the window."""
        key = self.limiter.key(client)
        window = timedelta(seconds=self.settings.challenge_window_seconds)
        if self.limiter.count(CHALLENGE, key, window) >= self.settings.challenge_max_per_client:
            raise TooManyAttempts(self.limiter.retry_after(CHALLENGE, key, window))
        self.limiter.hit(CHALLENGE, key)

    # -- password-reset codes ----------------------------------------------------------------------------

    def reset_check(self, account: str, client: str) -> None:
        key = self.limiter.key("reset", account, client)
        if self.limiter.count(RESET, key, self.window) >= self.settings.login_max_failures_per_account_client:
            raise TooManyAttempts(self.limiter.retry_after(RESET, key, self.window))

    def reset_failed(self, account: str, client: str) -> None:
        self.limiter.hit(RESET, self.limiter.key("reset", account, client))
        self.limiter.hit(CLIENT, self.limiter.key(client))

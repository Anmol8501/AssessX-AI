"""Login security check: a server-drawn code image whose answer only the server knows."""

import hashlib
import random
import secrets
import uuid
from datetime import timedelta
from html import escape

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.base import utcnow
from app.models.login_challenge import LoginChallenge
from app.repositories.login_challenges import LoginChallengeRepository

# Ambiguous glyphs (0/O, 1/I/l) are excluded.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LENGTH = 6
WIDTH, HEIGHT = 152, 48

_rng = random.SystemRandom()


def answer_hash(answer: str) -> str:
    return hashlib.sha256(answer.strip().upper().encode()).hexdigest()


def render_svg(text: str) -> str:
    """Draws the code as SVG: grid background, noise curves, per-glyph rotation and jitter."""
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}">',
        '<defs><pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse">'
        '<path d="M12 0H0V12" fill="none" stroke="rgba(17,24,39,0.07)" stroke-width="1"/></pattern></defs>',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="#f7f9fc"/>',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#g)"/>',
    ]
    for i in range(5):
        color = "rgba(37,99,235,0.35)" if i % 2 else "rgba(17,24,39,0.25)"
        p = [(_rng.uniform(0, WIDTH), _rng.uniform(0, HEIGHT)) for _ in range(4)]
        parts.append(
            f'<path d="M{p[0][0]:.1f} {p[0][1]:.1f} C{p[1][0]:.1f} {p[1][1]:.1f} {p[2][0]:.1f} {p[2][1]:.1f} '
            f'{p[3][0]:.1f} {p[3][1]:.1f}" fill="none" stroke="{color}" stroke-width="1.2"/>'
        )
    cell = WIDTH / (len(text) + 1)
    for i, char in enumerate(text):
        x = cell * (i + 1)
        y = HEIGHT / 2 + _rng.uniform(-4, 4)
        rot = _rng.uniform(-15, 15)
        size = 22 + _rng.randint(0, 4)
        color = "#1d4ed8" if i % 2 else "#111827"
        parts.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-family="Inter Variable, Segoe UI, system-ui, sans-serif" '
            f'font-weight="600" font-size="{size}" fill="{color}" text-anchor="middle" '
            f'dominant-baseline="middle" '
            f'transform="rotate({rot:.1f} {x:.1f} {y:.1f})">{escape(char)}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


class LoginChallengeService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.repo = LoginChallengeRepository(db)
        self.settings = settings

    def issue(self) -> tuple[LoginChallenge, str]:
        """Creates a challenge and returns it with the rendered SVG (never the answer)."""
        answer = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
        now = utcnow()
        challenge = self.repo.add(
            LoginChallenge(
                answer_hash=answer_hash(answer),
                expires_at=now + timedelta(seconds=self.settings.login_challenge_ttl_seconds),
            )
        )
        # Opportunistic housekeeping; a scheduled job can take over later.
        self.repo.delete_expired(now - timedelta(hours=1))
        return challenge, render_svg(answer)

    def consume(self, challenge_id: uuid.UUID, answer: str) -> bool:
        """Single use: the challenge is spent whether or not the answer is right."""
        challenge = self.repo.get(challenge_id)
        now = utcnow()
        if challenge is None or not challenge.is_usable(now):
            return False
        challenge.consumed_at = now
        return secrets.compare_digest(challenge.answer_hash, answer_hash(answer))

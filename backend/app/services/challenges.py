"""Login security check: a server-drawn code image whose answer only the server knows."""

import hashlib
import random
import secrets
import uuid
from datetime import timedelta

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


#: A small stroke font on a 4 × 6 grid (x right, y down): each glyph is a list of polylines. Drawn as
#: SVG paths — the characters never appear as text in the markup (Phase 8A, AX-01), so reading the code
#: needs image recognition rather than an HTML parser.
_GLYPHS: dict[str, list[list[tuple[float, float]]]] = {
    "A": [[(0, 6), (2, 0), (4, 6)], [(1, 3.6), (3, 3.6)]],
    "B": [[(0, 0), (0, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)], [(0, 0), (3, 0), (4, 1), (4, 2), (3, 3)]],
    "C": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5)]],
    "D": [[(0, 0), (0, 6), (2.5, 6), (4, 4.5), (4, 1.5), (2.5, 0), (0, 0)]],
    "E": [[(4, 0), (0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    "F": [[(4, 0), (0, 0), (0, 6)], [(0, 3), (3, 3)]],
    "G": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 3.5), (2.5, 3.5)]],
    "H": [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    "J": [[(1, 0), (4, 0)], [(3, 0), (3, 5), (2, 6), (1, 6), (0, 5)]],
    "K": [[(0, 0), (0, 6)], [(4, 0), (0, 3.5)], [(1.4, 2.6), (4, 6)]],
    "L": [[(0, 0), (0, 6), (4, 6)]],
    "M": [[(0, 6), (0, 0), (2, 3.2), (4, 0), (4, 6)]],
    "N": [[(0, 6), (0, 0), (4, 6), (4, 0)]],
    "P": [[(0, 6), (0, 0), (3, 0), (4, 1), (4, 2.5), (3, 3.5), (0, 3.5)]],
    "Q": [[(1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0)], [(2.5, 4.5), (4.2, 6.4)]],
    "R": [[(0, 6), (0, 0), (3, 0), (4, 1), (4, 2.5), (3, 3.5), (0, 3.5)], [(2, 3.5), (4, 6)]],
    "S": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 2), (1, 3), (3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "T": [[(0, 0), (4, 0)], [(2, 0), (2, 6)]],
    "U": [[(0, 0), (0, 5), (1, 6), (3, 6), (4, 5), (4, 0)]],
    "V": [[(0, 0), (2, 6), (4, 0)]],
    "W": [[(0, 0), (1, 6), (2, 2.5), (3, 6), (4, 0)]],
    "X": [[(0, 0), (4, 6)], [(4, 0), (0, 6)]],
    "Y": [[(0, 0), (2, 3), (4, 0)], [(2, 3), (2, 6)]],
    "Z": [[(0, 0), (4, 0), (0, 6), (4, 6)]],
    "2": [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (0, 6), (4, 6)]],
    "3": [
        [(0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1.5, 3)],
        [(3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)],
    ],
    "4": [[(3, 6), (3, 0), (0, 4), (4, 4)]],
    "5": [[(4, 0), (0, 0), (0, 3), (3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "6": [[(3.5, 0), (1, 0), (0, 1.5), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)]],
    "7": [[(0, 0), (4, 0), (1.5, 6)]],
    "8": [
        [(1, 3), (0, 2), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1, 3)],
        [(1, 3), (0, 4), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3)],
    ],
    "9": [[(4, 3), (1, 3), (0, 2), (0, 1), (1, 0), (3, 0), (4, 1), (4, 4.5), (3, 6), (0.5, 6)]],
}
assert set(_GLYPHS) == set(ALPHABET), "every challenge character needs a glyph"


def _glyph_path(char: str, cx: float, cy: float, scale: float, angle: float) -> str:
    """One character as an SVG path: each point jittered, the glyph rotated about its centre."""
    import math

    cos, sin = math.cos(angle), math.sin(angle)
    parts = []
    for stroke in _GLYPHS[char]:
        points = []
        for gx, gy in stroke:
            x = (gx - 2 + _rng.uniform(-0.18, 0.18)) * scale
            y = (gy - 3 + _rng.uniform(-0.18, 0.18)) * scale
            points.append(f"{cx + x * cos - y * sin:.1f} {cy + x * sin + y * cos:.1f}")
        parts.append("M" + " L".join(points))
    return " ".join(parts)


def render_svg(text: str) -> str:
    """Draws the code as SVG: grid background, noise curves, and each character as a jittered, rotated
    stroke path — never as `<text>`, so the answer cannot be read from the markup."""
    import math

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
        y = HEIGHT / 2 + _rng.uniform(-3, 3)
        angle = math.radians(_rng.uniform(-14, 14))
        scale = 3.4 + _rng.uniform(0, 0.5)
        color = "#1d4ed8" if i % 2 else "#111827"
        parts.append(
            f'<path d="{_glyph_path(char, x, y, scale, angle)}" fill="none" stroke="{color}" '
            'stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>'
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

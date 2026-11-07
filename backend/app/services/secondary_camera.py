import hashlib
import hmac
import secrets
import socket
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFound, Unauthorized, ValidationFailed
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.base import utcnow
from app.models.secondary_camera import SecondaryCameraSession, SecondaryCameraStatus
from app.models.user import User, UserRole


def get_lan_ip() -> str:
    """Detect local network IP so phone on same WiFi can connect to desktop."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class SecondaryCameraService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def generate_mobile_token(self, session_id: uuid.UUID) -> str:
        """Create a cryptographic signature for the mobile device tied to this session."""
        key = self.settings.secret_key.encode("utf-8")
        msg = f"secondary_camera:{session_id}".encode()
        sig = hmac.new(key, msg, hashlib.sha256).hexdigest()
        return f"{session_id}:{sig}"

    def verify_mobile_token(self, session_id: uuid.UUID, mobile_token: str) -> bool:
        expected = self.generate_mobile_token(session_id)
        return hmac.compare_digest(expected, mobile_token)

    def create_or_get_pairing_session(
        self, attempt_id: uuid.UUID, user: User, host: str = "localhost:1420"
    ) -> tuple[SecondaryCameraSession, str, str]:
        attempt = self.db.get(AssessmentAttempt, attempt_id)
        if attempt is None:
            raise NotFound("Assessment attempt not found.")
        if user.role != UserRole.ADMIN and attempt.candidate_id != user.id:
            raise NotFound("Assessment attempt not found.")
        if attempt.status != AttemptStatus.IN_PROGRESS:
            raise ValidationFailed("Secondary camera can only be connected for an active exam attempt.")

        assessment = attempt.assessment
        if not assessment.secondary_camera_enabled:
            raise ValidationFailed("This assessment does not require a secondary camera.")

        # Find existing session for this attempt
        session = self.db.scalar(
            select(SecondaryCameraSession).where(SecondaryCameraSession.attempt_id == attempt_id)
        )

        raw_token = secrets.token_urlsafe(32)
        token_hash = self.hash_token(raw_token)
        expires_at = utcnow() + timedelta(minutes=15)

        if session is None:
            session = SecondaryCameraSession(
                id=uuid.uuid4(),
                attempt_id=attempt_id,
                pairing_token_hash=token_hash,
                status=SecondaryCameraStatus.PENDING,
                orientation=assessment.secondary_camera_orientation,
                expires_at=expires_at,
            )
            self.db.add(session)
        else:
            # Refresh pairing token and expiration if still pending/interrupted
            session.pairing_token_hash = token_hash
            session.expires_at = expires_at
            if session.status in (SecondaryCameraStatus.DISCONNECTED, SecondaryCameraStatus.INTERRUPTED):
                session.status = SecondaryCameraStatus.PENDING

        self.db.flush()

        # Build pairing URL that the phone will open
        # Replace localhost/127.0.0.1 with LAN IP so phone on local WiFi can connect directly
        lan_ip = get_lan_ip()
        mobile_host = host
        if "localhost" in mobile_host or "127.0.0.1" in mobile_host:
            mobile_host = mobile_host.replace("localhost", lan_ip).replace("127.0.0.1", lan_ip)

        scheme = "https" if "assessx" in host.lower() and not host.startswith("localhost") else "http"
        pairing_url = f"{scheme}://{mobile_host}/#/mobile-camera?session_id={session.id}&token={raw_token}"

        return session, raw_token, pairing_url

    def pair_device(
        self, session_id: uuid.UUID, token: str, device_info: str | None
    ) -> tuple[SecondaryCameraSession, str]:
        session = self.db.get(SecondaryCameraSession, session_id)
        if session is None:
            raise NotFound("Invalid or expired secondary camera session.")

        if utcnow() > session.expires_at:
            raise ValidationFailed(
                "This QR pairing code has expired. Please refresh the QR code on your computer."
            )

        token_hash = self.hash_token(token)
        if not hmac.compare_digest(session.pairing_token_hash, token_hash):
            raise Unauthorized("Invalid pairing token.")

        session.status = SecondaryCameraStatus.PAIRED
        session.paired_at = utcnow()
        session.last_heartbeat_at = utcnow()
        session.device_info = device_info[:255] if device_info else "Mobile Browser"
        self.db.flush()

        mobile_token = self.generate_mobile_token(session.id)
        return session, mobile_token

    def heartbeat(
        self,
        session_id: uuid.UUID,
        mobile_token: str,
        battery_level: int | None = None,
        status: str | None = None,
    ) -> SecondaryCameraSession:
        if not self.verify_mobile_token(session_id, mobile_token):
            raise Unauthorized("Invalid mobile token.")

        session = self.db.get(SecondaryCameraSession, session_id)
        if session is None:
            raise NotFound("Session not found.")

        session.last_heartbeat_at = utcnow()
        if battery_level is not None:
            session.battery_level = battery_level
        if status and status in SecondaryCameraStatus.__members__:
            session.status = SecondaryCameraStatus(status)
        elif session.status == SecondaryCameraStatus.PAIRED and status == "STREAMING":
            session.status = SecondaryCameraStatus.STREAMING
            if not session.streaming_started_at:
                session.streaming_started_at = utcnow()

        self.db.flush()
        return session

    def get_session(self, session_id: uuid.UUID) -> SecondaryCameraSession:
        session = self.db.get(SecondaryCameraSession, session_id)
        if session is None:
            raise NotFound("Session not found.")
        return session

    def get_by_attempt(self, attempt_id: uuid.UUID) -> SecondaryCameraSession | None:
        return self.db.scalar(
            select(SecondaryCameraSession).where(SecondaryCameraSession.attempt_id == attempt_id)
        )

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.auth_session import AuthSession


class AuthSessionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_token_hash(self, token_hash: str) -> AuthSession | None:
        return self.db.scalar(
            select(AuthSession)
            .options(joinedload(AuthSession.user))
            .where(AuthSession.token_hash == token_hash)
        )

    def add(self, session: AuthSession) -> AuthSession:
        self.db.add(session)
        self.db.flush()
        return session

    def get(self, session_id) -> AuthSession | None:  # noqa: ANN001 — a UUID
        return self.db.scalar(
            select(AuthSession).options(joinedload(AuthSession.user)).where(AuthSession.id == session_id)
        )

    def revoke_all(self, user_id, now, except_id=None) -> int:  # noqa: ANN001
        """Revokes every live session of a user (optionally keeping one). Returns how many."""
        query = select(AuthSession).where(
            AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > now
        )
        if except_id is not None:
            query = query.where(AuthSession.id != except_id)
        sessions = list(self.db.scalars(query))
        for session in sessions:
            session.revoked_at = now
        self.db.flush()
        return len(sessions)

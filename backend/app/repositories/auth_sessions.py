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

import uuid
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.login_challenge import LoginChallenge


class LoginChallengeRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, challenge_id: uuid.UUID) -> LoginChallenge | None:
        return self.db.get(LoginChallenge, challenge_id)

    def add(self, challenge: LoginChallenge) -> LoginChallenge:
        self.db.add(challenge)
        self.db.flush()
        return challenge

    def delete_expired(self, before: datetime) -> int:
        result = self.db.execute(delete(LoginChallenge).where(LoginChallenge.expires_at < before))
        return result.rowcount or 0

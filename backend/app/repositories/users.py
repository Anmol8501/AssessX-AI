import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.user import User, UserRole


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, user_id: uuid.UUID) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(func.lower(User.email) == email.lower()))

    def list(self, *, role: UserRole | None = None) -> list[User]:
        query = select(User).order_by(User.created_at)
        if role is not None:
            query = query.where(User.role == role)
        return list(self.db.scalars(query))

    def add(self, user: User) -> User:
        self.db.add(user)
        self.db.flush()
        return user

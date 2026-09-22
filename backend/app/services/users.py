from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User, UserRole
from app.repositories.users import UserRepository


class UserService:
    def __init__(self, db: Session) -> None:
        self.repo = UserRepository(db)

    def create(
        self,
        *,
        name: str,
        email: str,
        password: str,
        role: UserRole,
        roll_number: str | None = None,
        username: str | None = None,
        is_active: bool = True,
    ) -> User:
        if role is UserRole.CANDIDATE and not roll_number:
            raise ValueError("A candidate account needs a roll number.")
        if role is UserRole.ADMIN and not username:
            raise ValueError("An administrator account needs a username.")
        return self.repo.add(
            User(
                name=name.strip(),
                email=email.strip().lower(),
                password_hash=hash_password(password),
                role=role,
                roll_number=roll_number.strip() if role is UserRole.CANDIDATE and roll_number else None,
                username=username.strip().lower() if role is UserRole.ADMIN and username else None,
                is_active=is_active,
            )
        )

    def list(self, *, role: UserRole | None = None) -> list[User]:
        return self.repo.list(role=role)

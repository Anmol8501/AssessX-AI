"""Test harness.

* Schema comes from the Alembic migrations (so migrations are exercised, not `create_all`).
* Each test runs inside one database transaction that is rolled back afterwards.
* Requests go through the real FastAPI app via httpx; only the DB session is overridden.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import timedelta

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from alembic import command

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

from app.core.config import get_settings  # noqa: E402
from app.core.database import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.base import utcnow  # noqa: E402
from app.models.login_challenge import LoginChallenge  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.services.challenges import answer_hash  # noqa: E402
from app.services.users import UserService  # noqa: E402

settings = get_settings()
TEST_DATABASE_URL = settings.test_database_url or os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    pytest.exit("TEST_DATABASE_URL is not set (see backend/.env.example).", returncode=3)

engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)

ADMIN_PASSWORD = "Test-admin-pass-1"
CANDIDATE_PASSWORD = "Test-candidate-pass-1"
INACTIVE_PASSWORD = "Test-inactive-pass-1"
ADMIN_USERNAME = "ada"
CANDIDATE_ROLL = "TEST2026001"
INACTIVE_ROLL = "TEST2026002"


@pytest.fixture(scope="session", autouse=True)
def _migrate_test_database() -> Iterator[None]:
    """Fresh schema for the whole run: downgrade to nothing, then upgrade to head."""
    config = Config("alembic.ini")
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_DATABASE_URL
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    yield
    with engine.connect() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE question_options, questions, assessments, "
                "auth_sessions, login_challenges, users CASCADE"
            )
        )
        conn.commit()


@pytest.fixture
def db() -> Iterator[Session]:
    """A session bound to a transaction that is always rolled back."""
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSession(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app = create_app()

    def _override_db() -> Iterator[Session]:
        yield db
        db.flush()

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def users(db: Session) -> dict[str, User]:
    service = UserService(db)
    created = {
        "admin": service.create(
            name="Ada Admin",
            email="admin@test.local",
            password=ADMIN_PASSWORD,
            role=UserRole.ADMIN,
            username=ADMIN_USERNAME,
        ),
        "candidate": service.create(
            name="Cal Candidate",
            email="candidate@test.local",
            password=CANDIDATE_PASSWORD,
            role=UserRole.CANDIDATE,
            roll_number=CANDIDATE_ROLL,
        ),
        "inactive": service.create(
            name="Ida Inactive",
            email="inactive@test.local",
            password=INACTIVE_PASSWORD,
            role=UserRole.CANDIDATE,
            roll_number=INACTIVE_ROLL,
            is_active=False,
        ),
    }
    db.flush()
    return created


class Helpers:
    """Shortcuts that keep the tests focused on behaviour, not plumbing."""

    def __init__(self, client: TestClient, db: Session) -> None:
        self.client = client
        self.db = db

    def solved_challenge(self, answer: str = "ABC234", *, expired: bool = False) -> uuid.UUID:
        """Inserts a challenge whose answer the test knows (the API never reveals one)."""
        challenge = LoginChallenge(
            answer_hash=answer_hash(answer),
            expires_at=utcnow() + (timedelta(seconds=-1) if expired else timedelta(minutes=5)),
        )
        self.db.add(challenge)
        self.db.flush()
        return challenge.id

    def login_candidate(
        self,
        email: str,
        password: str,
        *,
        roll_number: str = CANDIDATE_ROLL,
        remember: bool = False,
        answer: str | None = None,
    ):
        challenge_id = self.solved_challenge()
        return self.client.post(
            "/api/v1/auth/login/candidate",
            json={
                "roll_number": roll_number,
                "email": email,
                "password": password,
                "challenge_id": str(challenge_id),
                "challenge_answer": answer if answer is not None else "ABC234",
                "remember_me": remember,
            },
        )

    def login_admin(
        self,
        email: str,
        password: str,
        *,
        username: str = ADMIN_USERNAME,
        remember: bool = False,
        answer: str | None = None,
    ):
        challenge_id = self.solved_challenge()
        return self.client.post(
            "/api/v1/auth/login/admin",
            json={
                "username": username,
                "email": email,
                "password": password,
                "challenge_id": str(challenge_id),
                "challenge_answer": answer if answer is not None else "ABC234",
                "remember_me": remember,
            },
        )

    def token_for(self, email: str, password: str) -> str:
        """Signs in through whichever form matches the account (tests name the account)."""
        if email.startswith("admin"):
            response = self.login_admin(email, password)
        else:
            response = self.login_candidate(
                email, password, roll_number=INACTIVE_ROLL if "inactive" in email else CANDIDATE_ROLL
            )
        assert response.status_code == 200, response.text
        return response.json()["token"]

    def token_for_candidate(self, email: str, password: str, roll_number: str) -> str:
        """A token for a candidate created during the test (not one of the fixtures)."""
        response = self.login_candidate(email, password, roll_number=roll_number)
        assert response.status_code == 200, response.text
        return response.json()["token"]

    @staticmethod
    def bearer(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def helpers(client: TestClient, db: Session) -> Helpers:
    return Helpers(client, db)

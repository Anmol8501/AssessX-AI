"""Developer commands.

    python -m app.cli serve            # run the API with API_HOST / API_PORT from the environment
    python -m app.cli seed-dev-users   # create the documented development accounts

The seed command refuses to run when APP_ENV=production, so those credentials can never reach
a real deployment.
"""

import argparse
import os
import sys
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.user import UserRole
from app.repositories.users import UserRepository
from app.services.users import UserService


@dataclass(frozen=True)
class DevUser:
    name: str
    email: str
    role: UserRole
    password_env: str
    default_password: str
    identifier: str
    """Roll number for candidates, username for administrators."""
    active: bool = True


# Development-only accounts. Passwords can be overridden with the named environment
# variables; the defaults are documented in backend/README.md.
DEV_USERS = [
    DevUser(
        "Dev Admin",
        "admin@assessx.local",
        UserRole.ADMIN,
        "DEV_ADMIN_PASSWORD",
        "AssessX-admin-dev1",
        "admin",
    ),
    DevUser(
        "Dev Candidate",
        "candidate@assessx.local",
        UserRole.CANDIDATE,
        "DEV_CANDIDATE_PASSWORD",
        "AssessX-candidate-dev1",
        "DEV2026001",
    ),
    DevUser(
        "Inactive Candidate",
        "inactive@assessx.local",
        UserRole.CANDIDATE,
        "DEV_INACTIVE_PASSWORD",
        "AssessX-inactive-dev1",
        "DEV2026002",
        active=False,
    ),
]


def seed_dev_users() -> int:
    settings = get_settings()
    if settings.is_production:
        print("Refusing to seed development users with APP_ENV=production.", file=sys.stderr)
        return 2
    with SessionLocal() as db:
        repo = UserRepository(db)
        service = UserService(db)
        # Remove the transitional student@ dev account first: it holds the candidate roll number.
        legacy = repo.get_by_email("student@assessx.local")
        if legacy:
            db.delete(legacy)
            db.flush()
            print("removed  student@assessx.local  (replaced by candidate@assessx.local)")
        for spec in DEV_USERS:
            is_candidate = spec.role is UserRole.CANDIDATE
            existing = repo.get_by_email(spec.email)
            if existing:
                # Keep an already-seeded account's identifier in step with the documented value.
                if is_candidate:
                    existing.roll_number = spec.identifier
                else:
                    existing.username = spec.identifier
                print(f"exists   {spec.email}  (identifier set to {spec.identifier})")
                continue
            service.create(
                name=spec.name,
                email=spec.email,
                password=os.environ.get(spec.password_env, spec.default_password),
                role=spec.role,
                roll_number=spec.identifier if is_candidate else None,
                username=None if is_candidate else spec.identifier,
                is_active=spec.active,
            )
            status = "" if spec.active else ", inactive"
            print(f"created  {spec.email}  ({spec.role.value}{status}, {spec.identifier})")
        db.commit()
    return 0


def serve(reload: bool) -> int:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=reload,
        log_config=None,  # the app configures logging itself
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="assessx", description="AssessX backend developer commands")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-dev-users", help="create the documented development accounts (non-production only)")
    serve_parser = sub.add_parser("serve", help="run the API using API_HOST / API_PORT")
    serve_parser.add_argument(
        "--reload", action="store_true", help="auto-reload on code changes (development)"
    )
    args = parser.parse_args(argv)
    if args.command == "seed-dev-users":
        return seed_dev_users()
    if args.command == "serve":
        return serve(reload=args.reload)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

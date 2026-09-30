"""Developer commands.

    python -m app.cli serve            # run the API with API_HOST / API_PORT from the environment
    python -m app.cli seed-dev-users   # create the documented development accounts
    python -m app.cli create-admin --email … --name … --username …   # bootstrap a real administrator

The seed command refuses to run when APP_ENV=production, so those credentials can never reach
a real deployment. `create-admin` is how a deployment gets its first administrator (who then
creates candidates in the app): the password is read from ASSESSX_ADMIN_PASSWORD or prompted for,
never passed on the command line, and an existing account is never modified.
"""

import argparse
import getpass
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


#: Minimum length for a bootstrapped administrator's password.
ADMIN_PASSWORD_MIN_LENGTH = 12


def create_admin(email: str, name: str, username: str) -> int:
    password = os.environ.get("ASSESSX_ADMIN_PASSWORD")
    if password is None:
        password = getpass.getpass("Administrator password: ")
        if getpass.getpass("Repeat the password: ") != password:
            print("The passwords do not match.", file=sys.stderr)
            return 2
    if len(password) < ADMIN_PASSWORD_MIN_LENGTH:
        print(f"The password must be at least {ADMIN_PASSWORD_MIN_LENGTH} characters.", file=sys.stderr)
        return 2
    with SessionLocal() as db:
        repo = UserRepository(db)
        if repo.get_by_email(email.strip().lower()):
            print(f"An account with {email} already exists; nothing was changed.", file=sys.stderr)
            return 1
        UserService(db).create(
            name=name, email=email, password=password, role=UserRole.ADMIN, username=username
        )
        db.commit()
    print(f"created  {email.strip().lower()}  (ADMIN, {username.strip().lower()})")
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
    admin_parser = sub.add_parser(
        "create-admin", help="create an administrator (password from ASSESSX_ADMIN_PASSWORD or a prompt)"
    )
    admin_parser.add_argument("--email", required=True)
    admin_parser.add_argument("--name", required=True)
    admin_parser.add_argument("--username", required=True, help="the administrator's sign-in username")
    serve_parser = sub.add_parser("serve", help="run the API using API_HOST / API_PORT")
    serve_parser.add_argument(
        "--reload", action="store_true", help="auto-reload on code changes (development)"
    )
    args = parser.parse_args(argv)
    if args.command == "seed-dev-users":
        return seed_dev_users()
    if args.command == "create-admin":
        return create_admin(args.email, args.name, args.username)
    if args.command == "serve":
        return serve(reload=args.reload)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

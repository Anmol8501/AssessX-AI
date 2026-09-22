"""users.roll_number (candidates) and users.username (administrators)

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("roll_number", sa.String(length=50), nullable=True))
    op.add_column("users", sa.Column("username", sa.String(length=50), nullable=True))
    # Rows created before this revision get placeholder identifiers so the constraint below
    # holds; real values are set by administrators (or `seed-dev-users` for dev accounts).
    op.execute("UPDATE users SET username = 'admin-' || left(id::text, 8) WHERE role = 'ADMIN' AND username IS NULL")
    op.execute(
        "UPDATE users SET roll_number = 'TEMP-' || left(id::text, 8) WHERE role = 'CANDIDATE' AND roll_number IS NULL"
    )
    op.create_unique_constraint("uq_users_roll_number", "users", ["roll_number"])
    op.create_unique_constraint("uq_users_username", "users", ["username"])
    # Each role carries exactly its own identifier.
    op.create_check_constraint(
        "ck_users_role_identifier",
        "users",
        "(role = 'CANDIDATE' AND roll_number IS NOT NULL AND username IS NULL) "
        "OR (role = 'ADMIN' AND username IS NOT NULL AND roll_number IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_role_identifier", "users", type_="check")
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_constraint("uq_users_roll_number", "users", type_="unique")
    op.drop_column("users", "username")
    op.drop_column("users", "roll_number")

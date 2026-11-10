"""Device registration: devices table for Phase 1A Windows Workstation Provisioning

Revision ID: 0031
Revises: 0030
"""

import sqlalchemy as sa

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("device_identifier", sa.String(length=64), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=64), server_default="Windows", nullable=False),
        sa.Column("os_edition", sa.String(length=128), nullable=True),
        sa.Column("os_build", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="ACTIVE", nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("registered_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["registered_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_devices_device_identifier", "devices", ["device_identifier"], unique=True)
    op.create_index("ix_devices_registered_by_id", "devices", ["registered_by_id"], unique=False)
    op.create_index("ix_devices_status_platform", "devices", ["status", "platform"], unique=False)

    from app.core.db_security import secure_table

    for statement in secure_table("devices"):
        op.execute(statement)


def downgrade() -> None:
    from app.core.db_security import unsecure_table

    for statement in unsecure_table("devices", keep_rls=False):
        op.execute(statement)

    op.drop_index("ix_devices_status_platform", table_name="devices")
    op.drop_index("ix_devices_registered_by_id", table_name="devices")
    op.drop_index("ix_devices_device_identifier", table_name="devices")
    op.drop_table("devices")

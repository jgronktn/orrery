"""per-user credential-account vault (Account Logins), metadata only

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-29

Moves the "Account Logins" vault off the browser's localStorage onto the
backend, scoped per user, so a person sees their own list on any machine. Stores
account metadata only (service, username, category, URL, description, note, MFA
flag) — never passwords, which live in Bitwarden.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vault_logins",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("svc", sa.String(length=200), nullable=False),
        sa.Column("username", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("cat", sa.String(length=50), nullable=False, server_default=""),
        sa.Column("url", sa.String(length=1000), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("mfa", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_vault_logins_user_id", "vault_logins", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_vault_logins_user_id", table_name="vault_logins")
    op.drop_table("vault_logins")

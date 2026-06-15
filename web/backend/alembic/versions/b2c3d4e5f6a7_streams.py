"""function streams: projects.kind + projects.function; created_by nullable

Revision ID: b2c3d4e5f6a7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-15

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("kind", sa.String(length=20), server_default="project", nullable=False),
    )
    op.add_column("projects", sa.Column("function", sa.String(length=50), nullable=True))
    # Streams are system-provisioned (no creator).
    op.alter_column("projects", "created_by", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    op.alter_column("projects", "created_by", existing_type=sa.Uuid(), nullable=False)
    op.drop_column("projects", "function")
    op.drop_column("projects", "kind")

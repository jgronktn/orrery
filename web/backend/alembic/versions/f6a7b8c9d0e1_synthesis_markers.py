"""synthesis markers (§5b): catalog.synthesized, tasks.synthesized,
projects.last_synthesized_at

Agent-free hooks so a future batched synthesis pass can refresh knowledge
precisely. Manual adds/edits default 'pending'; nothing writes 'synthesized'
or last_synthesized_at yet.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-20

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "catalog",
        sa.Column("synthesized", sa.String(length=20), server_default="pending", nullable=False),
    )
    op.add_column(
        "tasks",
        sa.Column("synthesized", sa.String(length=20), server_default="pending", nullable=False),
    )
    op.add_column(
        "projects",
        sa.Column("last_synthesized_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "last_synthesized_at")
    op.drop_column("tasks", "synthesized")
    op.drop_column("catalog", "synthesized")

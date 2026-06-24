"""request_id on proposals — correlates the agent run (Logfire span) to its
approval outcome

Revision ID: a1b2c3d4e5f6
Revises: f6a7b8c9d0e1
Create Date: 2026-06-24

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "proposals", sa.Column("request_id", sa.String(length=36), nullable=True)
    )
    op.create_index("ix_proposals_request_id", "proposals", ["request_id"])


def downgrade() -> None:
    op.drop_index("ix_proposals_request_id", table_name="proposals")
    op.drop_column("proposals", "request_id")

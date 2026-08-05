"""transfer items: file support (metadata + bytes in Postgres)

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-29

Adds file columns to transfer_items so the Transfer moon can move files, not
just text. Bytes live in Postgres (the file store is a bind mount + git catalog;
ephemeral per-user transfer blobs don't belong there). `data` is fetched only by
the download endpoint (deferred in the ORM), never by the list poll.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("transfer_items", sa.Column("filename", sa.String(length=500), nullable=True))
    op.add_column("transfer_items", sa.Column("content_type", sa.String(length=200), nullable=True))
    op.add_column("transfer_items", sa.Column("size", sa.BigInteger(), nullable=True))
    op.add_column("transfer_items", sa.Column("data", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("transfer_items", "data")
    op.drop_column("transfer_items", "size")
    op.drop_column("transfer_items", "content_type")
    op.drop_column("transfer_items", "filename")

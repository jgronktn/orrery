"""catalog table (universal file index) — replaces project_documents

Revision ID: f1a2b3c4d5e6
Revises: 593f8c11a2b8
Create Date: 2026-06-15

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "593f8c11a2b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # project_documents (drop-only catalog) is superseded by the universal
    # catalog. Disposable per the build note — drop it outright.
    op.drop_table("project_documents")

    op.create_table(
        "catalog",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("path", sa.String(length=700), nullable=False),
        sa.Column("container_kind", sa.String(length=20), nullable=False),
        sa.Column("container_id", sa.Uuid(), nullable=True),
        sa.Column("function", sa.String(length=50), nullable=False),
        sa.Column("sub_function", sa.String(length=50), nullable=True),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("ext", sa.String(length=20), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("uploader_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("on_timeline", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("text_extracted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["container_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalog_path", "catalog", ["path"], unique=True)
    op.create_index("ix_catalog_container_id", "catalog", ["container_id"])

    # Full-text keyword search: a STORED tsvector over title + path + text,
    # with a GIN index. Generated columns aren't expressible in the ORM, so
    # they live here.
    op.execute(
        "ALTER TABLE catalog ADD COLUMN tsv tsvector "
        "GENERATED ALWAYS AS ("
        "  to_tsvector('english', "
        "    coalesce(title,'') || ' ' || coalesce(path,'') || ' ' || coalesce(extracted_text,'')"
        "  )"
        ") STORED"
    )
    op.execute("CREATE INDEX ix_catalog_tsv ON catalog USING GIN (tsv)")


def downgrade() -> None:
    op.drop_index("ix_catalog_tsv", table_name="catalog")
    op.drop_index("ix_catalog_container_id", table_name="catalog")
    op.drop_index("ix_catalog_path", table_name="catalog")
    op.drop_table("catalog")

    op.create_table(
        "project_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=300), nullable=False),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_documents_project_id", "project_documents", ["project_id"])

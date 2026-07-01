"""project_document_links + project_link_folders (spec linking into projects)

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-06-30

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_document_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("doc_path", sa.String(length=700), nullable=False),
        sa.Column("target_dir", sa.String(length=700), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "doc_path", name="uq_proj_doc_link"),
    )
    op.create_index(
        "ix_project_document_links_project_id", "project_document_links", ["project_id"]
    )

    op.create_table(
        "project_link_folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("folder_path", sa.String(length=700), nullable=False),
        sa.Column("dest_function", sa.String(length=50), nullable=False),
        sa.Column("dest_dir", sa.String(length=700), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "folder_path", name="uq_proj_link_folder"),
    )
    op.create_index(
        "ix_project_link_folders_project_id", "project_link_folders", ["project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_project_link_folders_project_id", table_name="project_link_folders")
    op.drop_table("project_link_folders")
    op.drop_index("ix_project_document_links_project_id", table_name="project_document_links")
    op.drop_table("project_document_links")

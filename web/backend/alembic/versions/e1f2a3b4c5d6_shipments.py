"""operations shipments (OPS shipping domain) + engage each project's function agent

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-10-22

`shipments` is the first OPS domain: one row per package in or out, created by
humans in the UI and read by the OPS agent. `shipment_documents` links its
documents (packing slips, receipts — cataloged store files) to the record.

Also backfills `project_agents`: projects used to engage only 'engineering'
regardless of function, so a Corporate project's own agent was refused on its
PM/research-log callbacks. Each bounded project now also engages its
function's agent (corp → corporate, ops → ops). Additive only.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Function key → its agent id, for functions whose agent isn't engineering.
_FUNCTION_AGENTS = {"corp": "corporate", "ops": "ops"}


def upgrade() -> None:
    op.create_table(
        "shipments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("shipped_on", sa.Date(), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=True),
        sa.Column("carrier", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("tracking_number", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("counterparty", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("contents", sa.Text(), nullable=False, server_default=""),
        sa.Column("po_ref", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("folder", sa.String(length=500), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shipments_direction", "shipments", ["direction"])
    op.create_index("ix_shipments_shipped_on", "shipments", ["shipped_on"])
    op.create_index("ix_shipments_project_id", "shipments", ["project_id"])

    op.create_table(
        "shipment_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("shipment_id", sa.Uuid(), nullable=False),
        sa.Column("doc_path", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["shipment_id"], ["shipments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shipment_documents_shipment_id", "shipment_documents", ["shipment_id"])

    # Engage each bounded project's function agent (idempotent).
    for function, agent_id in _FUNCTION_AGENTS.items():
        op.execute(
            sa.text(
                """
                INSERT INTO project_agents (id, project_id, agent_id, role)
                SELECT gen_random_uuid(), p.id, :agent, 'primary'
                FROM projects p
                WHERE p.kind <> 'function_stream' AND p.function = :function
                  AND NOT EXISTS (
                    SELECT 1 FROM project_agents pa
                    WHERE pa.project_id = p.id AND pa.agent_id = :agent
                  )
                """
            ).bindparams(agent=agent_id, function=function)
        )


def downgrade() -> None:
    # The project_agents backfill is left in place (additive, harmless).
    op.drop_index("ix_shipment_documents_shipment_id", table_name="shipment_documents")
    op.drop_table("shipment_documents")
    op.drop_index("ix_shipments_project_id", table_name="shipments")
    op.drop_index("ix_shipments_shipped_on", table_name="shipments")
    op.drop_index("ix_shipments_direction", table_name="shipments")
    op.drop_table("shipments")

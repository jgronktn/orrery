"""rename the engineering function key 'engineering' -> 'engr'

Renames catalog.function and the function_stream projects row (function +
slug). The agent service id stays 'engineering' (Forge) and folder names stay
full-word (engineering/) — only the function KEY changes. The Qdrant
`documents` payloads (payload.function) are re-pointed out-of-band via
`orrery_backend.maintenance.repoint_function('engineering','engr')`.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-20

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE catalog SET function = 'engr' WHERE function = 'engineering'")
    op.execute(
        "UPDATE projects SET function = 'engr', slug = 'engr' "
        "WHERE kind = 'function_stream' AND function = 'engineering'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE projects SET function = 'engineering', slug = 'engineering' "
        "WHERE kind = 'function_stream' AND function = 'engr'"
    )
    op.execute("UPDATE catalog SET function = 'engineering' WHERE function = 'engr'")

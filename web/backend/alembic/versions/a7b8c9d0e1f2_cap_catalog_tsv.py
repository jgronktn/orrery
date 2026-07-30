"""bound the catalog full-text tsvector input (Postgres 1 MB tsvector limit)

Revision ID: a7b8c9d0e1f2
Revises: c5d6e7f8a9b0
Create Date: 2026-07-29

The `tsv` generated column indexed the FULL concatenation of title + path +
extracted_text. A large data file (e.g. a 48 MB CSV current-log) produces a
tsvector far above Postgres's hard 1 MB (1048575-byte) ceiling, so the catalog
INSERT throws — leaving the file's bytes on disk with no catalog row (an orphan
that then 404s on delete). Cap the tsvector's input with left(..., 300000) so
the generated column can never overflow, regardless of file size. Keyword search
covers the first ~300 K chars; deeper coverage lives in the `documents`
embeddings. `extracted_text` itself is also capped upstream (filestore.MAX_EXTRACT_CHARS).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "c5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A STORED generated column's expression can't be ALTERed in place — drop and
# re-add. The catalog table is small, so recomputing every row is instant.
_TSV_CAPPED = (
    "ALTER TABLE catalog ADD COLUMN tsv tsvector "
    "GENERATED ALWAYS AS ("
    "  to_tsvector('english', "
    "    left("
    "      coalesce(title,'') || ' ' || coalesce(path,'') || ' ' || coalesce(extracted_text,''),"
    "      300000"
    "    )"
    "  )"
    ") STORED"
)
_TSV_UNCAPPED = (
    "ALTER TABLE catalog ADD COLUMN tsv tsvector "
    "GENERATED ALWAYS AS ("
    "  to_tsvector('english', "
    "    coalesce(title,'') || ' ' || coalesce(path,'') || ' ' || coalesce(extracted_text,'')"
    "  )"
    ") STORED"
)


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_catalog_tsv")
    op.execute("ALTER TABLE catalog DROP COLUMN IF EXISTS tsv")
    op.execute(_TSV_CAPPED)
    op.execute("CREATE INDEX ix_catalog_tsv ON catalog USING GIN (tsv)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_catalog_tsv")
    op.execute("ALTER TABLE catalog DROP COLUMN IF EXISTS tsv")
    op.execute(_TSV_UNCAPPED)
    op.execute("CREATE INDEX ix_catalog_tsv ON catalog USING GIN (tsv)")

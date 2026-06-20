"""One-shot maintenance helpers, run via `python -c` in the backend container.

These touch the git filestore / Qdrant, which don't belong in Alembic SQL
migrations. Run them in the documented order around the relevant migration.
"""
from __future__ import annotations

from qdrant_client import models

from orrery_lib import docstore, kb


def repoint_function(old: str, new: str) -> int:
    """Rewrite payload.function `old`->`new` on the Qdrant `documents`
    collection — the filter field only; vectors and text are untouched. Run
    once right after the engr-rename migration so semantic search by the new
    function key still matches the existing engineering embeddings."""
    client = kb.get_client()
    if not client.collection_exists(docstore.DOCUMENTS_COLLECTION):
        print("no documents collection; nothing to repoint")
        return 0
    client.set_payload(
        collection_name=docstore.DOCUMENTS_COLLECTION,
        payload={"function": new},
        points=models.Filter(
            must=[
                models.FieldCondition(
                    key="function", match=models.MatchValue(value=old)
                )
            ]
        ),
    )
    print(f"repointed documents.function {old!r} -> {new!r}")
    return 1


if __name__ == "__main__":
    import sys

    if len(sys.argv) == 4 and sys.argv[1] == "repoint":
        repoint_function(sys.argv[2], sys.argv[3])
    else:
        print("usage: python -m orrery_backend.maintenance repoint <old> <new>")

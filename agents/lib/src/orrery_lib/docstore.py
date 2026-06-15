"""Document-passage store — the Tier-1 RAG index over source files.

Distinct from kb.py's `learnings` (agent-asserted facts, trust/decay): the
`documents` collection holds chunked passages of real files, owner-curated,
with **lifecycle tied 1:1 to the file** — when a file is deleted its chunks
are dropped (delete_file), no decay scoring. Populated automatically when a
file is cataloged (deterministic plumbing, never an agent call).

Reuses kb.py's embedder/client/model pin so both collections share one
embedding space.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from qdrant_client import models

from . import kb

DOCUMENTS_COLLECTION = "documents"
_NS = uuid.UUID("6f0a8d2e-3b1c-4e8a-9f2d-0c1a2b3c4d5e")  # stable point-id namespace


@dataclass
class DocHit:
    catalog_id: str
    path: str
    title: str
    text: str
    score: float


def _chunk(text: str, size: int = 1200, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        out.append(text[i : i + size])
        i += max(1, size - overlap)
    return out


def index_file(
    catalog_id: str,
    text: str,
    *,
    path: str,
    title: str,
    container_kind: str,
    container_id: str | None,
    function: str,
    source: str,
) -> int:
    """(Re)index a file's text into `documents`. Idempotent: clears any prior
    chunks for this catalog_id first. Returns the chunk count."""
    delete_file(catalog_id)
    chunks = _chunk(text)
    if not chunks:
        return 0
    kb.ensure_collection(DOCUMENTS_COLLECTION)
    points = []
    for idx, chunk in enumerate(chunks):
        points.append(
            models.PointStruct(
                id=str(uuid.uuid5(_NS, f"{catalog_id}:{idx}")),
                vector=kb._embed(chunk),
                payload={
                    "catalog_id": catalog_id, "chunk_idx": idx, "text": chunk,
                    "path": path, "title": title, "container_kind": container_kind,
                    "container_id": container_id, "function": function, "source": source,
                },
            )
        )
    kb.get_client().upsert(collection_name=DOCUMENTS_COLLECTION, points=points)
    return len(points)


def delete_file(catalog_id: str) -> None:
    """Drop all chunks for a file (called when the file is removed)."""
    client = kb.get_client()
    if not client.collection_exists(DOCUMENTS_COLLECTION):
        return
    client.delete(
        collection_name=DOCUMENTS_COLLECTION,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[models.FieldCondition(key="catalog_id", match=models.MatchValue(value=catalog_id))]
            )
        ),
    )


def search(
    query: str,
    *,
    k: int = 8,
    container_id: str | None = None,
    container_kind: str | None = None,
    function: str | None = None,
) -> list[DocHit]:
    """Semantic search over passages, optionally scoped to one container
    (project_id), container_kind, and/or function. [] if empty."""
    client = kb.get_client()
    if not client.collection_exists(DOCUMENTS_COLLECTION):
        return []
    must = []
    if container_id is not None:
        must.append(models.FieldCondition(key="container_id", match=models.MatchValue(value=container_id)))
    if container_kind is not None:
        must.append(models.FieldCondition(key="container_kind", match=models.MatchValue(value=container_kind)))
    if function is not None:
        must.append(models.FieldCondition(key="function", match=models.MatchValue(value=function)))
    flt = models.Filter(must=must) if must else None
    result = client.query_points(
        collection_name=DOCUMENTS_COLLECTION, query=kb._embed(query),
        limit=k, with_payload=True, query_filter=flt,
    ).points
    return [
        DocHit(
            catalog_id=str(h.payload.get("catalog_id", "")),
            path=str(h.payload.get("path", "")),
            title=str(h.payload.get("title", "")),
            text=str(h.payload.get("text", "")),
            score=float(h.score),
        )
        for h in result
    ]

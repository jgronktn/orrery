"""Knowledge base — Qdrant + fastembed local embeddings.

Two collections, same shape:

  docs       — curated. Indexed from ./docs/ via `make index-docs`.
               status="curated" by convention.
  learnings  — provisional. Written by the agent's add_kb tool as it
               works tickets. status="provisional" until a human
               reviews and decides.

The agent has tools to search BOTH collections, but can only add to
`learnings` — there is no code path that lets it modify `docs`. That
keeps "facts curated by a human" cleanly separated from "things the
agent thinks it learned".

Each stored point carries:
  text          — the actual passage
  source        — where it came from (filename, ticket id, etc.)
  status        — "curated" or "provisional"
  embed_model   — pinned per point so a future model swap is reindex-aware

Embedding model: BAAI/bge-small-en-v1.5 (384 dim, ~30 MB). Override
via ORRERY_EMBED_MODEL — but if you change models, every existing
point needs reindexing or its vectors will be in the wrong space.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from fastembed import TextEmbedding
from qdrant_client import QdrantClient, models

QDRANT_URL = os.environ.get("ORRERY_QDRANT_URL", "http://qdrant:6333")
EMBED_MODEL = os.environ.get("ORRERY_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
# fastembed cache. When the container runs non-root, the default
# (~/.cache under /root) is unreadable — point it at a world-readable
# baked-in path via ORRERY_FASTEMBED_CACHE.
FASTEMBED_CACHE = os.environ.get("ORRERY_FASTEMBED_CACHE") or None

# Vector dimension for BAAI/bge-small-en-v1.5. If you change models,
# update this too — fastembed exposes the dim on the model_card but
# pinning here makes the wrong-model error explicit at startup.
EMBED_DIM = 384

DOCS_COLLECTION = "docs"
LEARNINGS_COLLECTION = "learnings"


@dataclass
class KBHit:
    text: str
    source: str
    status: str
    score: float
    point_id: str


# ── Module-level lazy singletons ────────────────────────────────────
_embedder: TextEmbedding | None = None
_client: QdrantClient | None = None


def get_embedder() -> TextEmbedding:
    global _embedder
    if _embedder is None:
        _embedder = TextEmbedding(EMBED_MODEL, cache_dir=FASTEMBED_CACHE)
    return _embedder


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL, timeout=30)
    return _client


def _embed(text: str) -> list[float]:
    """One-shot embed. fastembed returns a generator over numpy arrays."""
    vec = next(get_embedder().embed([text]))
    return vec.tolist()


def ensure_collection(name: str) -> None:
    """Idempotent. Creates the collection if it doesn't exist."""
    client = get_client()
    if client.collection_exists(name):
        return
    client.create_collection(
        collection_name=name,
        vectors_config=models.VectorParams(
            size=EMBED_DIM,
            distance=models.Distance.COSINE,
        ),
    )


def delete_collection(name: str) -> None:
    """Drop a collection entirely. Used by reindex flows."""
    client = get_client()
    if client.collection_exists(name):
        client.delete_collection(name)


# ── Search / add / curate ───────────────────────────────────────────


def search(
    collection: str,
    query: str,
    k: int = 5,
) -> list[KBHit]:
    """Semantic-similarity search. Returns at most k hits, ranked.

    If the collection doesn't exist yet (first-run case), returns [].
    The agent's search tools tolerate empty results gracefully.
    """
    client = get_client()
    if not client.collection_exists(collection):
        return []
    embedding = _embed(query)
    result = client.query_points(
        collection_name=collection,
        query=embedding,
        limit=k,
        with_payload=True,
    ).points
    return [
        KBHit(
            text=str(hit.payload.get("text", "")),
            source=str(hit.payload.get("source", "?")),
            status=str(hit.payload.get("status", "?")),
            score=float(hit.score),
            point_id=str(hit.id),
        )
        for hit in result
    ]


def add(
    collection: str,
    text: str,
    source: str,
    status: str = "provisional",
) -> str:
    """Insert one point. Returns the assigned id.

    `status` is "provisional" for agent-added learnings (the default)
    or "curated" for human-blessed facts and docs.

    Caller is responsible for choosing the right collection — the
    agent only ever calls add(LEARNINGS_COLLECTION, ...) via its
    add_kb tool. The indexer writes to DOCS_COLLECTION at index time.
    """
    ensure_collection(collection)
    embedding = _embed(text)
    point_id = str(uuid.uuid4())
    get_client().upsert(
        collection_name=collection,
        points=[
            models.PointStruct(
                id=point_id,
                vector=embedding,
                payload={
                    "text": text,
                    "source": source,
                    "status": status,
                    # Pin the model so a future swap can identify
                    # stale points and reindex them.
                    "embed_model": EMBED_MODEL,
                },
            ),
        ],
    )
    return point_id


def list_points(
    collection: str,
    status: str | None = None,
    limit: int = 100,
) -> list[KBHit]:
    """Iterate the collection (optionally filtered by status) for the
    human curation flow. Not used by the agent — only the CLI.

    Returns hits with score=0.0 (no query). Useful for `kb-list`.
    """
    client = get_client()
    if not client.collection_exists(collection):
        return []
    flt = None
    if status is not None:
        flt = models.Filter(
            must=[
                models.FieldCondition(
                    key="status",
                    match=models.MatchValue(value=status),
                ),
            ],
        )
    points, _ = client.scroll(
        collection_name=collection,
        scroll_filter=flt,
        limit=limit,
        with_payload=True,
    )
    return [
        KBHit(
            text=str(p.payload.get("text", "")),
            source=str(p.payload.get("source", "?")),
            status=str(p.payload.get("status", "?")),
            score=0.0,
            point_id=str(p.id),
        )
        for p in points
    ]


def delete_point(collection: str, point_id: str) -> None:
    """Remove one point — the human's curation gesture."""
    get_client().delete(
        collection_name=collection,
        points_selector=models.PointIdsList(points=[point_id]),
    )

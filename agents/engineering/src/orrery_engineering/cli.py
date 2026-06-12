"""CLI subcommands — knowledge-base management.

Invoked via the `python -m orrery_engineering` entry point and reached
from the host via `make` targets (index-docs, kb-search, kb-list,
kb-delete). All operations are local to this container's view of
Qdrant.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from orrery_lib import kb

DOCS_ROOT = Path(os.environ.get("ORRERY_DOCS_ROOT", "/app/docs"))

# Filename extensions we'll index. Markdown + plain text covers
# product/firmware docs without dragging in PDFs or office formats
# (those need different chunking/extraction strategies).
DOC_EXTENSIONS = {".md", ".markdown", ".txt"}

# Skip this subdirectory — those are test inputs to the agent, not
# product knowledge.
SKIP_DIRS = {"sample_tickets"}


# ── index-docs ─────────────────────────────────────────────────────


def index_docs() -> int:
    """Rebuild the `docs` collection from DOCS_ROOT. Idempotent:
    drops + recreates the collection so removed files don't linger.

    Each file becomes ONE point. Long files (>8000 chars) are noted
    and skipped — Phase 0 doesn't ship a chunker; add one in Step 5+
    when real corpus pressure forces it.
    """
    if not DOCS_ROOT.exists():
        print(f"docs root not found: {DOCS_ROOT}")
        return 2

    print(f"Reindexing '{kb.DOCS_COLLECTION}' from {DOCS_ROOT}")
    kb.delete_collection(kb.DOCS_COLLECTION)
    kb.ensure_collection(kb.DOCS_COLLECTION)

    indexed = 0
    skipped = 0
    for path in sorted(DOCS_ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(DOCS_ROOT)
        if rel.parts and rel.parts[0] in SKIP_DIRS:
            continue
        if path.suffix.lower() not in DOC_EXTENSIONS:
            continue
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        if not text:
            skipped += 1
            print(f"  skip:  {rel}  (empty)")
            continue
        if len(text) > 8000:
            skipped += 1
            print(f"  skip:  {rel}  (too long: {len(text)} chars, needs chunking)")
            continue
        kb.add(kb.DOCS_COLLECTION, text=text, source=str(rel), status="curated")
        indexed += 1
        print(f"  index: {rel}  ({len(text)} chars)")

    print(f"\nIndexed: {indexed}  Skipped: {skipped}")
    return 0


# ── kb-search ───────────────────────────────────────────────────────


def kb_search(query: str, collection: str, k: int) -> int:
    """Manual search — useful for debugging what the agent would see."""
    hits = kb.search(collection, query, k=k)
    if not hits:
        print(f"(no hits in '{collection}')")
        return 0
    print(f"{len(hits)} hit(s) in '{collection}':\n")
    for i, h in enumerate(hits, 1):
        excerpt = h.text if len(h.text) <= 200 else h.text[:200] + "..."
        print(f"  [{i}] score={h.score:.3f}  status={h.status}  source={h.source}")
        print(f"      id={h.point_id}")
        print(f"      {excerpt}\n")
    return 0


# ── kb-list ─────────────────────────────────────────────────────────


def kb_list(collection: str, status: str | None, limit: int) -> int:
    """Browse a collection without a query — the curation surface.
    Filter by status to find provisional notes the agent has added.
    """
    points = kb.list_points(collection, status=status, limit=limit)
    if not points:
        suffix = f" with status={status}" if status else ""
        print(f"(no points in '{collection}'{suffix})")
        return 0
    desc = f"'{collection}'"
    if status:
        desc += f" (status={status})"
    print(f"{len(points)} point(s) in {desc}:\n")
    for i, p in enumerate(points, 1):
        excerpt = p.text if len(p.text) <= 200 else p.text[:200] + "..."
        print(f"  [{i}] id={p.point_id}  status={p.status}  source={p.source}")
        print(f"      {excerpt}\n")
    return 0


# ── kb-delete ───────────────────────────────────────────────────────


def kb_delete(collection: str, point_id: str) -> int:
    """Curation: remove a provisional note that wasn't useful."""
    kb.delete_point(collection, point_id)
    print(f"deleted {point_id} from '{collection}'")
    return 0


# ── Argparse wiring ─────────────────────────────────────────────────


def register_subparsers(sub: argparse._SubParsersAction) -> None:
    """Called from __main__ to attach KB subcommands to the parser."""
    p_idx = sub.add_parser(
        "index-docs",
        help="Rebuild the docs Qdrant collection from /app/docs/",
    )
    p_idx.set_defaults(_kb_fn=lambda args: index_docs())

    p_search = sub.add_parser(
        "kb-search",
        help="Manual semantic search against a KB collection",
    )
    p_search.add_argument("query")
    p_search.add_argument(
        "--collection", default=kb.LEARNINGS_COLLECTION,
        choices=[kb.LEARNINGS_COLLECTION, kb.DOCS_COLLECTION],
    )
    p_search.add_argument("-k", type=int, default=5)
    p_search.set_defaults(
        _kb_fn=lambda a: kb_search(a.query, a.collection, a.k),
    )

    p_list = sub.add_parser(
        "kb-list",
        help="List points in a collection (the curation surface)",
    )
    p_list.add_argument(
        "--collection", default=kb.LEARNINGS_COLLECTION,
        choices=[kb.LEARNINGS_COLLECTION, kb.DOCS_COLLECTION],
    )
    p_list.add_argument(
        "--status", choices=["provisional", "curated"], default=None,
    )
    p_list.add_argument("--limit", type=int, default=100)
    p_list.set_defaults(
        _kb_fn=lambda a: kb_list(a.collection, a.status, a.limit),
    )

    p_del = sub.add_parser(
        "kb-delete", help="Delete a point by id",
    )
    p_del.add_argument("point_id")
    p_del.add_argument(
        "--collection", default=kb.LEARNINGS_COLLECTION,
        choices=[kb.LEARNINGS_COLLECTION, kb.DOCS_COLLECTION],
    )
    p_del.set_defaults(
        _kb_fn=lambda a: kb_delete(a.collection, a.point_id),
    )

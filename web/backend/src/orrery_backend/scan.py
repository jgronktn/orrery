"""One-shot catalog backfill — index files already on disk.

Walks the engineering reference corpus + every project tree, creating catalog
rows (Tier 0) + embeddings (Tier 1) for anything not already cataloged. This
replaces the old `make index-docs` flow. Run once after the catalog migration:

    docker compose exec backend python -m orrery_backend.scan
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from orrery_lib import docstore, filestore

from . import projectstore
from .db import SessionLocal
from .models import Catalog, Project

_SKIP = {".git", ".gitkeep", ".DS_Store"}


def _scan_dir(db, root: Path, *, container_kind: str, container_id, function: str) -> int:
    if not root.exists():
        return 0
    n = 0
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name in _SKIP:
            continue
        if ".git" in p.relative_to(root).parts:
            continue
        rel = str(p.relative_to(filestore.FILES_ROOT))
        if db.scalar(select(Catalog.id).where(Catalog.path == rel)) is not None:
            continue  # already cataloged (e.g. dropped via commit_path)
        data = p.read_bytes()
        ext = p.suffix.lstrip(".").lower() or None
        text = filestore.extract_text(p)
        now = datetime.now(timezone.utc)
        facet = projectstore.facet_from_relparts(p.relative_to(root).parts)
        cat = Catalog(
            path=rel, container_kind=container_kind, container_id=container_id,
            function=function, sub_function=facet,
            type=projectstore._type_for_ext(ext or ""), ext=ext,
            size=p.stat().st_size, sha256=hashlib.sha256(data).hexdigest(),
            source="scan", uploader_id=None, title=p.name,
            occurred_at=None, on_timeline=False,
            extracted_text=text, text_extracted_at=now if text else None,
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
        if text:
            docstore.index_file(
                str(cat.id), text, path=rel, title=p.name,
                container_kind=container_kind,
                container_id=str(container_id) if container_id else None,
                function=function, source="scan",
            )
        n += 1
    return n


def scan_store() -> int:
    db = SessionLocal()
    try:
        total = _scan_dir(
            db, filestore.ENGINEERING_ROOT,
            container_kind="function", container_id=None, function="engr",
        )
        for proj in db.scalars(
            select(Project).where(
                Project.archived.is_(False), Project.kind == "project"
            )
        ):
            total += _scan_dir(
                db, projectstore.project_dir(proj.slug),
                container_kind="project", container_id=proj.id, function="engr",
            )
        print(f"cataloged {total} new files")
        return total
    finally:
        db.close()


def backfill_facets() -> int:
    """Recompute sub_function (facet) for existing catalog rows from their
    folder path. One-time after the faceting change."""
    db = SessionLocal()
    try:
        n = 0
        for cat in db.scalars(select(Catalog)):
            parts = cat.path.split("/")
            rel = parts[2:] if cat.container_kind == "project" else parts[1:]
            facet = projectstore.facet_from_relparts(tuple(rel))
            if cat.sub_function != facet:
                cat.sub_function = facet
                n += 1
        db.commit()
        print(f"backfilled facet on {n} catalog rows")
        return n
    finally:
        db.close()


def reindex_emails() -> int:
    """Backfill email cataloging for existing .eml rows: re-parse the headers
    (From/To/Cc/attachments), re-extract the body text, refresh the catalog
    row (type/title/description/occurred_at/extracted_text), and re-index its
    embeddings. Idempotent; safe to run repeatedly after the .eml-aware text
    extractor lands."""
    db = SessionLocal()
    try:
        n = 0
        for cat in list(db.scalars(select(Catalog).where(Catalog.ext == "eml"))):
            p = filestore.FILES_ROOT / cat.path
            if not p.is_file():
                continue
            data = p.read_bytes()
            meta = projectstore.parse_eml(data)
            text = filestore.extract_text(p)
            now = datetime.now(timezone.utc)

            cat.type = "email"
            cat.title = ((meta.subject or p.name).strip() or p.name)[:300]
            cat.description = meta.description()
            if meta.date is not None:
                cat.occurred_at = meta.date
            cat.extracted_text = text
            cat.text_extracted_at = now if text else None
            db.commit()
            db.refresh(cat)

            docstore.delete_file(str(cat.id))
            if text:
                docstore.index_file(
                    str(cat.id), text, path=cat.path, title=cat.title,
                    container_kind=cat.container_kind,
                    container_id=str(cat.container_id) if cat.container_id else None,
                    function=cat.function, source=cat.source,
                )
            n += 1
        print(f"reindexed {n} email(s)")
        return n
    finally:
        db.close()


def reextract(ext: str) -> int:
    """Re-extract text + re-index for existing catalog rows of a given ext
    (e.g. after teaching `extract_text` a new format like .odt). Refreshes
    extracted_text/text_extracted_at and the node `type`, and rebuilds the
    embeddings. Idempotent."""
    db = SessionLocal()
    try:
        n = 0
        node_type = projectstore._type_for_ext(ext.lower())
        for cat in list(db.scalars(select(Catalog).where(Catalog.ext == ext.lower()))):
            p = filestore.FILES_ROOT / cat.path
            if not p.is_file():
                continue
            text = filestore.extract_text(p)
            cat.type = node_type
            cat.extracted_text = text
            cat.text_extracted_at = datetime.now(timezone.utc) if text else None
            db.commit()
            db.refresh(cat)

            docstore.delete_file(str(cat.id))
            if text:
                docstore.index_file(
                    str(cat.id), text, path=cat.path, title=cat.title,
                    container_kind=cat.container_kind,
                    container_id=str(cat.container_id) if cat.container_id else None,
                    function=cat.function, source=cat.source,
                )
            n += 1
        print(f"reextracted {n} {ext} file(s)")
        return n
    finally:
        db.close()


def remove_path(rel_path: str) -> bool:
    """Delete one cataloged file by its FILES_ROOT-relative path: git-remove the
    bytes, drop its embeddings, delete the catalog row. Returns False if there's
    no catalog row for it."""
    from . import commit_path
    from .models import User

    db = SessionLocal()
    try:
        cat = db.scalar(select(Catalog).where(Catalog.path == rel_path))
        if cat is None:
            print(f"no catalog row for {rel_path}")
            return False
        actor = db.scalars(select(User).order_by(User.created_at)).first()
        commit_path.remove_file(db, cat, actor=actor)
        print(f"removed {rel_path}")
        return True
    finally:
        db.close()


if __name__ == "__main__":
    scan_store()
    backfill_facets()

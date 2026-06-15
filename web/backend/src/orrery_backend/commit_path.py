"""commit_path — the single door for human-initiated file mutations.

Every add lands here: write bytes → git commit → catalog row → deterministic
text extraction (Tier 0, synchronous, zero-LLM) → schedule a Tier-1 embed
(background, near-free). This is the manual-edit counterpart to the agent's
propose door; both make a file findable the instant it exists. No agent loop.

Slice (a) implements add + remove for project containers (drop → attachments).
Seams left for: arbitrary destinations, rename/move, and per-folder risk
floors that route sensitive destinations through the approval queue.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session as DbSession

from orrery_lib import docstore, filestore

from . import projectstore
from .models import Catalog, Project, User

_log = logging.getLogger("orrery.commit_path")


def _embed(catalog_id: str, text: str, meta: dict) -> None:
    """Tier-1: chunk + embed into the `documents` collection. Runs in a
    BackgroundTask; failures are logged, never block the add."""
    try:
        docstore.index_file(catalog_id, text, **meta)
    except Exception:  # pragma: no cover - best-effort indexing
        _log.exception("embed failed for %s", meta.get("path"))


def add_file(
    db: DbSession,
    *,
    project: Project,
    function: str,
    data: bytes,
    filename: str,
    file_type: str,
    ext: str | None,
    source: str,
    uploader: User,
    title: str,
    description: str | None = None,
    occurred_at: datetime | None = None,
    on_timeline: bool = False,
    background_tasks: BackgroundTasks | None = None,
) -> Catalog:
    """Catalog a file into a project container (Tier 0), then queue its embed."""
    rel_in_project, _stored = projectstore.save_upload(
        project.slug, filename, data,
        author_name=uploader.display_name, author_email=uploader.email,
    )
    rel_path = f"projects/{project.slug}/{rel_in_project}"
    text = filestore.extract_text(filestore.FILES_ROOT / rel_path)
    now = datetime.now(timezone.utc)

    cat = Catalog(
        path=rel_path, container_kind="project", container_id=project.id,
        function=function, type=file_type, ext=ext or None, size=len(data),
        sha256=hashlib.sha256(data).hexdigest(), source=source,
        uploader_id=uploader.id, title=title[:300], description=description,
        occurred_at=occurred_at, on_timeline=on_timeline,
        extracted_text=text, text_extracted_at=now if text else None,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)

    if text and background_tasks is not None:
        background_tasks.add_task(
            _embed, str(cat.id), text,
            {
                "path": rel_path, "title": cat.title, "container_kind": "project",
                "container_id": str(project.id), "function": function, "source": source,
            },
        )
    return cat


def remove_file(db: DbSession, cat: Catalog, *, project: Project, actor: User) -> None:
    """Delete a cataloged file: git-remove the bytes, drop its embeddings, and
    delete the row. Git history retains it (recoverable)."""
    prefix = f"projects/{project.slug}/"
    if cat.path.startswith(prefix):
        projectstore.delete_upload(
            project.slug, cat.path[len(prefix):],
            author_name=actor.display_name, author_email=actor.email,
        )
    docstore.delete_file(str(cat.id))
    db.delete(cat)
    db.commit()

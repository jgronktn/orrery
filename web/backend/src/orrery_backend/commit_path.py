"""commit_path — the single door for human-initiated file mutations.

Every add lands here: write bytes → git commit → catalog row → deterministic
text extraction (Tier 0, synchronous, zero-LLM) → schedule a Tier-1 embed
(background, near-free). This is the manual-edit counterpart to the agent's
propose door; both make a file findable the instant it exists. No agent loop.

Adds land here (Tier 0/1). Mutations (rename/move/delete) also route through
here, risk-tiered by destination: normal folders auto-commit; sensitive
records-of-record queue for one-glance approval (the same queue the agent's
proposals feed).
"""
from __future__ import annotations

import hashlib
import logging
import os
import uuid as uuidlib
from datetime import datetime, timezone

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session as DbSession

from orrery_lib import docstore, filestore

from . import functions, projectstore
from .models import Catalog, ProposalRecord, Project, User
from .slack import notify_approval

_log = logging.getLogger("orrery.commit_path")

# ── Per-folder risk floors ──────────────────────────────────────────
# Risk by destination, not just operation (note §3): legal/financial
# records-of-record queue for approval even for a human. Empty-ish today
# (no such folders exist yet); declared forward-looking.
_SENSITIVE_PREFIXES = ("corporate/equity/", "corporate/financial/debt/")
_ORDER = {"low": 0, "medium": 1, "high": 2}

FILE_OPS = {"file_rename", "file_move", "file_delete"}


def path_risk_floor(path: str | None) -> str:
    if path and path.startswith(_SENSITIVE_PREFIXES):
        return "medium"
    return "low"


def _max_floor(*paths: str | None) -> str:
    return max(
        (path_risk_floor(p) for p in paths if p),
        key=lambda r: _ORDER[r],
        default="low",
    )


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
    """Catalog a file into a container (project OR function stream), Tier 0,
    then queue its embed (Tier 1). A function stream saves into its function
    folder (container_kind='function', container_id NULL); a project saves into
    projects/<slug>/ (container_kind='project')."""
    if project.kind == "function_stream":
        rel_root = functions.FUNCTIONS[project.function].folder
        ckind: str = "function"
        cid: uuid.UUID | None = None
        fn = project.function
    else:
        rel_root = f"projects/{project.slug}"
        ckind, cid, fn = "project", project.id, function

    rel_path, _name = projectstore.save_to(
        rel_root, filename, data,
        author_name=uploader.display_name, author_email=uploader.email,
    )
    text = filestore.extract_text(filestore.FILES_ROOT / rel_path)
    now = datetime.now(timezone.utc)

    cat = Catalog(
        path=rel_path, container_kind=ckind, container_id=cid,
        function=fn, type=file_type, ext=ext or None, size=len(data),
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
                "path": rel_path, "title": cat.title, "container_kind": ckind,
                "container_id": str(cid) if cid else None, "function": fn, "source": source,
            },
        )
    return cat


def remove_file(db: DbSession, cat: Catalog, *, actor: User) -> None:
    """Delete a cataloged file (project OR function): git-remove the bytes by
    its store path, drop its embeddings, and delete the row. Git history retains
    it (recoverable)."""
    projectstore.delete_at(
        cat.path, author_name=actor.display_name, author_email=actor.email
    )
    docstore.delete_file(str(cat.id))
    db.delete(cat)
    db.commit()


# ── Governed mutations: rename / move / delete ──────────────────────


def execute_file_op(db: DbSession, kind: str, payload: dict) -> None:
    """Perform a rename/move/delete from a proposal payload — git mv/rm +
    commit, then keep the catalog row + `documents` embeddings in sync. Used
    by both the immediate (low-risk) path and on approval. Caller commits."""
    src: str = payload["src"]
    dest: str | None = payload.get("dest")
    author = {
        "author_name": payload.get("author_name"),
        "author_email": payload.get("author_email"),
    }
    cat = db.get(Catalog, uuidlib.UUID(payload["catalog_id"])) if payload.get("catalog_id") else None
    full_src = filestore.FILES_ROOT / src

    if kind == "file_delete":
        if full_src.exists():
            full_src.unlink()
        filestore.git_commit([src], f"files: delete {src.rsplit('/', 1)[-1]}", **author)
        if cat is not None:
            docstore.delete_file(str(cat.id))
            db.delete(cat)
        return

    assert dest is not None
    name = dest.rsplit("/", 1)[-1]
    full_dest = filestore.FILES_ROOT / dest
    full_dest.parent.mkdir(parents=True, exist_ok=True)
    os.rename(full_src, full_dest)
    filestore.git_commit([src, dest], f"files: {kind.split('_')[1]} {src} → {dest}", **author)
    if cat is not None:
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else None
        cat.path = dest
        cat.title = name
        cat.ext = ext
        cat.type = projectstore._type_for_ext(ext or "")
        cat.synthesized = "pending"  # moved/renamed → re-digest next synthesis pass
        if "new_facet" in payload:
            cat.sub_function = payload["new_facet"]
        db.flush()
        if cat.extracted_text:
            docstore.index_file(
                str(cat.id), cat.extracted_text, path=dest, title=name,
                container_kind=cat.container_kind,
                container_id=str(cat.container_id) if cat.container_id else None,
                function=cat.function, source=cat.source,
            )


def route_file_op(
    db: DbSession,
    *,
    kind: str,
    cat: Catalog,
    user: User,
    summary: str,
    dest: str | None = None,
    new_facet: str | None = None,
) -> tuple[str, ProposalRecord | None]:
    """Risk-route a mutation: low → execute now; medium/high → queue a
    proposal. Returns ("done", None) or ("queued", proposal)."""
    payload: dict = {
        "catalog_id": str(cat.id), "src": cat.path, "dest": dest,
        "author_name": user.display_name, "author_email": user.email,
    }
    if new_facet is not None:
        payload["new_facet"] = new_facet

    if _max_floor(cat.path, dest) == "low":
        execute_file_op(db, kind, payload)
        db.commit()
        return "done", None

    floor = _max_floor(cat.path, dest)
    rec = ProposalRecord(
        user_id=user.id, project_id=cat.container_id,
        agent_id=functions.agent_for_function(cat.function) or "engineering",
        kind=kind, summary=summary, risk=floor, payload=payload, status="pending",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    notify_approval(summary, floor)
    return "queued", rec

"""File read access — raw bytes (download / inline preview) + extracted text.

Read-only and permission-checked: a file is reachable only if it's cataloged
AND the user can access its container (project membership / stream function
access). Paths are resolved strictly under FILES_ROOT. No agent, no mutation.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from orrery_lib import filestore

from . import commit_path, functions, projectstore
from .auth import current_user
from .db import get_db
from .models import Catalog, Project, User
from .projects import require_membership
from .schemas import FileMoveIn, FileOpResult, FileRenameIn

router = APIRouter(prefix="/api/files", tags=["files"])


def _container_root(cat: Catalog, db: DbSession) -> tuple[str, set[str]]:
    """The container's FILES_ROOT-relative folder + its allowed facet subdirs.
    For a function file the root is the function's FOLDER, not its key — they
    differ (key `engr` → folder `engineering`)."""
    if cat.container_kind == "project" and cat.container_id is not None:
        project = db.get(Project, cat.container_id)
        assert project is not None
        return f"projects/{project.slug}", set(projectstore.PROJECT_FACETS)
    return functions.FUNCTIONS[cat.function].folder, set(
        functions.facets_for(cat.function)
    )


def _accessible_file(path: str, user: User, db: DbSession) -> Catalog:
    """The catalog row for `path` if the user may read it, else 404. Only
    cataloged files are reachable, which also blocks path traversal."""
    cat = db.scalar(select(Catalog).where(Catalog.path == path))
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    if cat.container_kind == "project" and cat.container_id is not None:
        require_membership(cat.container_id, user, db)
    elif cat.container_kind != "project" and not functions.can_access_function(
        user, cat.function
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    return cat


def _abs(cat: Catalog) -> Path:
    root = filestore.FILES_ROOT.resolve()
    full = (root / cat.path).resolve()
    if full != root and root not in full.parents:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    if not full.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    return full


@router.get("/raw")
def file_raw(
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> FileResponse:
    """Raw bytes, served inline (used for download + image/PDF preview)."""
    full = _abs(_accessible_file(path, user, db))
    media = mimetypes.guess_type(full.name)[0] or "application/octet-stream"
    return FileResponse(
        str(full), media_type=media, filename=full.name,
        content_disposition_type="inline",
    )


# Extensions stored as plain UTF-8 on disk — read live so in-place edits and
# appends (e.g. the agent writing to research-log.md) show immediately. Other
# previewable types (pdf/docx) are binary and rely on the catalog's one-time
# text extraction captured at ingestion.
_LIVE_TEXT_EXTS = {
    "md", "mdx", "txt", "csv", "json", "yaml", "yml", "toml", "lock", "env",
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "sh", "go", "rs", "py",
    "css", "scss", "sass", "less", "html", "htm",
}


@router.get("/text")
def file_text(
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Deterministically-extracted text for preview (markdown/pdf/docx/csv).
    Plain-text files are re-read from disk so the preview always reflects the
    current contents; binary types fall back to the cataloged extraction.
    Null when the file type has no extractable text (e.g. images)."""
    cat = _accessible_file(path, user, db)
    if (cat.ext or "").lower() in _LIVE_TEXT_EXTS:
        try:
            return {"text": _abs(cat).read_text(encoding="utf-8")}
        except (OSError, UnicodeDecodeError):
            pass
    return {"text": cat.extracted_text}


@router.post("/rename", response_model=FileOpResult)
def file_rename(
    body: FileRenameIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    cat = _accessible_file(body.path, user, db)
    name = projectstore._safe_name(body.new_name)
    parent = cat.path.rsplit("/", 1)[0]
    dest = f"{parent}/{name}"
    status_, rec = commit_path.route_file_op(
        db, kind="file_rename", cat=cat, user=user, dest=dest,
        summary=f"Rename {cat.title} → {name}",
    )
    return {"status": status_, "proposal_id": rec.id if rec else None}


@router.post("/move", response_model=FileOpResult)
def file_move(
    body: FileMoveIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    cat = _accessible_file(body.path, user, db)
    root, _allowed = _container_root(cat, db)
    # Folders are free-form now: the target may be any existing folder within
    # the container root (nested ok), not just a fixed facet. Validate it
    # resolves inside the root with no traversal.
    target = body.target_dir.strip().strip("/").replace("\\", "/")
    if target:
        if ".." in target.split("/") or target.startswith("."):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid destination folder")
        if not (filestore.FILES_ROOT / root / target).is_dir():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "destination folder does not exist")
    name = cat.path.rsplit("/", 1)[-1]
    dest = f"{root}/{target}/{name}" if target else f"{root}/{name}"
    if dest == cat.path:
        return {"status": "done", "proposal_id": None}
    status_, rec = commit_path.route_file_op(
        db, kind="file_move", cat=cat, user=user, dest=dest,
        new_facet=target.split("/")[0] if target else None,
        summary=f"Move {cat.title} → {target or '/'}",
    )
    return {"status": status_, "proposal_id": rec.id if rec else None}


@router.delete("", response_model=FileOpResult)
def file_delete(
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    cat = _accessible_file(path, user, db)
    status_, rec = commit_path.route_file_op(
        db, kind="file_delete", cat=cat, user=user,
        summary=f"Delete {cat.title}",
    )
    return {"status": status_, "proposal_id": rec.id if rec else None}

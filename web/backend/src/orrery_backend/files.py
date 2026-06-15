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

from . import functions
from .auth import current_user
from .db import get_db
from .models import Catalog, User
from .projects import require_membership

router = APIRouter(prefix="/api/files", tags=["files"])


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


@router.get("/text")
def file_text(
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Deterministically-extracted text for preview (markdown/pdf/docx/csv).
    Null when the file type has no extractable text (e.g. images)."""
    cat = _accessible_file(path, user, db)
    return {"text": cat.extracted_text}

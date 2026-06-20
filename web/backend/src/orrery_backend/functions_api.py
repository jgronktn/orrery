"""Function-scoped routes — the container ops that belong to a function, not
its agent. A function is a first-class container (a `function_stream` project
row) that owns a folder, timeline, files, facets, and search whether or not an
agent occupies it. Reuses the project helpers (container-kind aware).
"""
from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from orrery_lib import filestore

from . import commit_path, functions, projects, projectstore
from .auth import current_user
from .config import settings
from .db import get_db
from .models import Catalog, Project, ProposalRecord, Task, User
from .schemas import (
    FsTreeNode,
    FunctionOut,
    HomeOut,
    SearchHit,
    TimelineNode,
)

router = APIRouter(prefix="/api/functions", tags=["functions"])
home_router = APIRouter(prefix="/api/home", tags=["home"])


def _resolve_stream(key: str, user: User, db: DbSession) -> Project:
    """The accessible function_stream row for `key`, or 404."""
    if key not in functions.ACTIVE_FUNCTIONS or not functions.can_access_function(user, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "function not found")
    stream = db.scalar(
        select(Project).where(
            Project.kind == "function_stream", Project.function == key
        )
    )
    if stream is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "function not found")
    return stream


def function_out(key: str, stream: Project, db: DbSession) -> dict:
    fdef = functions.FUNCTIONS[key]
    file_count = db.scalar(
        select(func.count()).select_from(Catalog).where(
            Catalog.container_kind == "function", Catalog.function == key
        )
    ) or 0
    reminder_count = db.scalar(
        select(func.count()).select_from(Task).where(
            Task.project_id == stream.id, Task.kind == "reminder", Task.status != "done"
        )
    ) or 0
    return {
        "key": key, "name": fdef.name, "folder": fdef.folder,
        "agent": functions.agent_for_function(key),
        "facets": functions.facets_for(key),
        "stream_id": stream.id,
        "file_count": file_count,
        "reminder_count": reminder_count,
        "pending_count": functions.pending_synth_count(stream, db),
    }


@router.get("", response_model=list[FunctionOut])
def list_functions(
    user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> list[dict]:
    out: list[dict] = []
    for key in functions.ACTIVE_FUNCTIONS:
        if not functions.can_access_function(user, key):
            continue
        stream = db.scalar(
            select(Project).where(
                Project.kind == "function_stream", Project.function == key
            )
        )
        if stream is not None:
            out.append(function_out(key, stream, db))
    return out


@router.get("/{key}", response_model=FunctionOut)
def get_function(
    key: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> dict:
    return function_out(key, _resolve_stream(key, user, db), db)


@router.get("/{key}/tree", response_model=FsTreeNode)
def function_tree(
    key: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> dict:
    _resolve_stream(key, user, db)
    root = filestore.FILES_ROOT / functions.FUNCTIONS[key].folder
    if root.exists():
        return projectstore.build_tree(root, "reference")
    return {"name": "reference", "children": []}


@router.get("/{key}/search", response_model=list[SearchHit])
def function_search(
    key: str,
    q: str,
    semantic: bool = False,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    stream = _resolve_stream(key, user, db)
    return projects.container_search(stream, q, semantic, db)


@router.get("/{key}/timeline", response_model=list[TimelineNode])
def function_timeline(
    key: str,
    facet: str | None = None,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    stream = _resolve_stream(key, user, db)
    return projects.build_timeline(stream, facet, db)


@router.post("/{key}/documents", response_model=TimelineNode, status_code=status.HTTP_201_CREATED)
async def upload_function_document(
    key: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Drop a file onto the function stream's timeline (lands in the function
    folder). .eml emails dated by their sent/received header."""
    stream = _resolve_stream(key, user, db)
    data = await projects._read_upload(file)
    cat = projects.ingest_timeline_drop(db, stream, data, file.filename, user, background_tasks)
    return projects._doc_node(cat)


@router.delete("/{key}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_function_document(
    key: str,
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    stream = _resolve_stream(key, user, db)
    cat = db.get(Catalog, document_id)
    if cat is None or not projects._catalog_in_container(cat, stream):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    commit_path.remove_file(db, cat, actor=user)
    return None


@home_router.get("", response_model=HomeOut)
def home(
    user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> dict:
    """Company Home — five functions (with counts), a union timeline (recent
    across functions), all pending approvals, and company identity. One trip."""
    funcs = list_functions(user, db)

    timeline: list[dict] = []
    for f in funcs:
        stream = db.get(Project, f["stream_id"])
        if stream is not None:
            timeline.extend(projects.build_timeline(stream, None, db))
    timeline.sort(key=lambda n: n["time"], reverse=True)
    timeline = timeline[:50]

    approvals = list(
        db.scalars(
            select(ProposalRecord)
            .where(ProposalRecord.user_id == user.id, ProposalRecord.status == "pending")
            .order_by(ProposalRecord.created_at.desc())
        )
    )
    return {
        "company": {"name": settings.company_name, "tagline": settings.company_tagline},
        "functions": funcs,
        "timeline": timeline,
        "approvals": approvals,
    }

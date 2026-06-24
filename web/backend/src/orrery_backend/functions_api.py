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
    Form,
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
    FileOpResult,
    FolderCreateIn,
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


def _function_payload(
    key: str, stream: Project, *, file_count: int, reminder_count: int, pending_count: int
) -> dict:
    fdef = functions.FUNCTIONS[key]
    return {
        "key": key, "name": fdef.name, "folder": fdef.folder,
        "agent": functions.agent_for_function(key),
        "facets": functions.facets_for(key),
        "stream_id": stream.id,
        "file_count": file_count,
        "reminder_count": reminder_count,
        "pending_count": pending_count,
    }


def function_out(key: str, stream: Project, db: DbSession) -> dict:
    """Single-function payload (used by GET /{key}). For the multi-function
    list, list_functions batches these counts — see below."""
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
    return _function_payload(
        key, stream,
        file_count=file_count,
        reminder_count=reminder_count,
        pending_count=functions.pending_synth_count(stream, db),
    )


@router.get("", response_model=list[FunctionOut])
def list_functions(
    user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> list[dict]:
    # Batched: instead of ~4 count queries per function (× N functions), run one
    # grouped query per metric across all accessible functions — 5 queries total
    # regardless of how many functions exist. Feeds /api/home's badge counts.
    keys = [k for k in functions.ACTIVE_FUNCTIONS if functions.can_access_function(user, k)]
    if not keys:
        return []
    streams = {
        p.function: p
        for p in db.scalars(
            select(Project).where(
                Project.kind == "function_stream", Project.function.in_(keys)
            )
        )
    }
    keys = [k for k in keys if k in streams]
    sids = [streams[k].id for k in keys]

    files = dict(
        db.execute(
            select(Catalog.function, func.count())
            .where(Catalog.container_kind == "function", Catalog.function.in_(keys))
            .group_by(Catalog.function)
        ).all()
    )
    reminders = dict(
        db.execute(
            select(Task.project_id, func.count())
            .where(Task.project_id.in_(sids), Task.kind == "reminder", Task.status != "done")
            .group_by(Task.project_id)
        ).all()
    )
    pend_cat = dict(
        db.execute(
            select(Catalog.function, func.count())
            .where(
                Catalog.container_kind == "function",
                Catalog.function.in_(keys),
                Catalog.synthesized == "pending",
            )
            .group_by(Catalog.function)
        ).all()
    )
    pend_task = dict(
        db.execute(
            select(Task.project_id, func.count())
            .where(Task.project_id.in_(sids), Task.synthesized == "pending")
            .group_by(Task.project_id)
        ).all()
    )

    return [
        _function_payload(
            k, streams[k],
            file_count=files.get(k, 0),
            reminder_count=reminders.get(streams[k].id, 0),
            pending_count=pend_cat.get(k, 0) + pend_task.get(streams[k].id, 0),
        )
        for k in keys
    ]


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
    dir: str | None = Form(None),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Drop a file onto the function stream's timeline. Defaults to the
    function's attachments/ folder; pass `dir` (a folder from the function's
    tree) to drop it there instead. .eml emails dated by their header."""
    stream = _resolve_stream(key, user, db)
    dest_dir = _validate_dir(key, dir)
    data = await projects._read_upload(file)
    cat = projects.ingest_timeline_drop(
        db, stream, data, file.filename, user, background_tasks, dest_dir=dest_dir
    )
    return projects._doc_node(cat)


def _validate_dir(key: str, dir: str | None) -> str | None:
    """A drop target must resolve inside the function's own folder (no traversal,
    no escaping into another function or the projects tree)."""
    if not dir:
        return None
    folder = functions.FUNCTIONS[key].folder
    norm = dir.strip().strip("/").replace("\\", "/")
    parts = norm.split("/")
    if ".." in parts or not norm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid target folder")
    if norm != folder and not norm.startswith(folder + "/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "target outside function folder")
    return norm


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


# ── Folders (free-form, nested) ─────────────────────────────────────


def _func_subpath(key: str, sub: str | None) -> tuple[str, str]:
    """Validate a function-relative subpath (no traversal). Returns
    (function-relative, FILES_ROOT-relative) — e.g. ("specs/2026",
    "engineering/specs/2026). "" → the function root."""
    folder = functions.FUNCTIONS[key].folder
    norm = (sub or "").strip().strip("/").replace("\\", "/")
    if norm and (".." in norm.split("/") or norm.startswith(".")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid folder path")
    return norm, (f"{folder}/{norm}" if norm else folder)


@router.get("/{key}/folders", response_model=list[str])
def list_function_folders(
    key: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> list[str]:
    """Every subfolder under the function, function-relative — the dynamic
    move-target / new-folder vocabulary (replaces the fixed facet list)."""
    _resolve_stream(key, user, db)
    base = filestore.FILES_ROOT / functions.FUNCTIONS[key].folder
    if not base.is_dir():
        return []
    out = [
        str(p.relative_to(base))
        for p in base.rglob("*")
        if p.is_dir() and ".git" not in p.parts
    ]
    return sorted(out)


@router.post("/{key}/folders", response_model=list[str], status_code=status.HTTP_201_CREATED)
def create_function_folder(
    key: str,
    body: FolderCreateIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[str]:
    """Create a folder under the function (nested via `parent`). Empty folders
    get a tracked .gitkeep so they persist in git + the tree."""
    _resolve_stream(key, user, db)
    _, parent_full = _func_subpath(key, body.parent)
    if not (filestore.FILES_ROOT / parent_full).is_dir():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "parent folder not found")
    name = projectstore._safe_name(body.name)
    if not name or name in {".git", "attachments"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid folder name")
    new_dir = filestore.FILES_ROOT / parent_full / name
    new_dir.mkdir(parents=True, exist_ok=True)
    keep = new_dir / ".gitkeep"
    if not keep.exists():
        keep.write_text("", encoding="utf-8")
    filestore.git_commit(
        [str(keep.relative_to(filestore.FILES_ROOT))],
        f"{functions.FUNCTIONS[key].folder}: add folder {name}",
        author_name=user.display_name, author_email=user.email,
    )
    return list_function_folders(key, user, db)


@router.delete("/{key}/folders", response_model=FileOpResult)
def delete_function_folder(
    key: str,
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Recursively delete a folder + its files (risk-routed; sensitive paths
    queue for approval). The function root itself cannot be deleted."""
    _resolve_stream(key, user, db)
    rel, full = _func_subpath(key, path)
    if not rel:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot delete the function root")
    if not (filestore.FILES_ROOT / full).is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "folder not found")
    status_, rec = commit_path.route_folder_delete(
        db, rel_path=full, function=key, user=user, summary=f"Delete folder {rel}"
    )
    return {"status": status_, "proposal_id": rec.id if rec else None}


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
            nodes = projects.build_timeline(stream, None, db)
            for n in nodes:
                n["function"] = f["key"]  # tag each node with its owning function
            timeline.extend(nodes)
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

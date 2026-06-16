"""Projects (first-class) + minimal tasks.

Access is by membership: the creator becomes an `owner` member; listing
returns the projects the user belongs to. Per-user permissions beyond
membership are a later concern.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session as DbSession

from orrery_lib import docstore

from . import commit_path, functions, projectstore
from .auth import current_user
from .db import get_db
from .models import (
    Catalog,
    Project,
    ProjectAgent,
    ProjectMember,
    ProjectMemberAgent,
    Task,
    TaskDocument,
    User,
)
from .projectstore import create_project_tree
from .schemas import (
    ContainerFile,
    ProjectIn,
    ProjectOut,
    SearchHit,
    TaskDocLinkIn,
    TaskDocOut,
    TaskIn,
    TaskOut,
    TimelineNode,
    TimelineNoteIn,
)

# Project files are cataloged under the engineering function for now (the
# only agent). Cross-functional per-file function tagging arrives with streams.
_PROJECT_FUNCTION = "engineering"

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "project"


def unique_slug(db: DbSession, name: str) -> str:
    """A filesystem-safe, unique project slug derived from the name."""
    base = _slugify(name)
    slug, i = base, 1
    while db.scalar(select(Project.id).where(Project.slug == slug)) is not None:
        slug, i = f"{base}-{i}", i + 1
    return slug


def require_membership(
    project_id: uuid.UUID, user: User, db: DbSession
) -> ProjectMember:
    """Return the user's membership for a project, or 404 if not a member."""
    membership = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    return membership


def get_container(project_id: uuid.UUID, user: User, db: DbSession) -> Project:
    """Return a container (project OR function_stream) the user can access, or
    404. Projects gate on membership; streams gate on function-access."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    if project.kind == "function_stream":
        if not functions.can_access_function(user, project.function):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
        return project
    require_membership(project_id, user, db)
    return project


def _to_out(project: Project, role: str) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.role = role
    return out


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> ProjectOut:
    slug = unique_slug(db, body.name)
    project = Project(
        name=body.name,
        slug=slug,
        description=body.description,
        created_by=user.id,
    )
    db.add(project)
    db.flush()  # assign project.id
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role="owner"))
    # A project is cross-functional; engineering is the (only) agent today.
    db.add(
        ProjectAgent(
            project_id=project.id, agent_id="engineering", role="primary",
            added_by=user.id,
        )
    )
    db.add(
        ProjectMemberAgent(
            project_id=project.id, user_id=user.id, agent_id="engineering",
            can_talk=True, can_approve=True,
        )
    )
    db.commit()
    db.refresh(project)
    # Filesystem: create the project's folder tree + seeded research log.
    create_project_tree(
        slug, project.name, author_name=user.display_name, author_email=user.email
    )
    return _to_out(project, "owner")


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user: User = Depends(current_user), db: DbSession = Depends(get_db)
) -> list[ProjectOut]:
    # Bounded projects the user is a member of …
    rows = db.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            ProjectMember.user_id == user.id,
            Project.archived.is_(False),
            Project.kind == "project",
        )
        .order_by(Project.created_at.desc())
    ).all()
    out = [_to_out(project, role) for project, role in rows]
    # … plus the perpetual function streams the user can reach.
    streams = db.scalars(
        select(Project)
        .where(
            Project.kind == "function_stream",
            Project.function.in_(functions.accessible_functions(user)),
            Project.archived.is_(False),
        )
        .order_by(Project.name)
    )
    out.extend(_to_out(s, "member") for s in streams)
    return out


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ProjectOut:
    project = get_container(project_id, user, db)
    role = "member"
    if project.kind == "project":
        membership = require_membership(project_id, user, db)
        role = membership.role
    return _to_out(project, role)


MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _doc_node(cat: Catalog) -> dict:
    """Render a cataloged timeline file as a timeline node, dated by occurred_at."""
    when = cat.occurred_at or cat.created_at
    return {
        "id": f"doc:{cat.id}",
        "kind": "file",
        "name": cat.title,
        "time": int(when.timestamp() * 1000),
        "type": cat.type,
        "ext": cat.ext,
        "path": cat.path,
        "size": cat.size,
        "desc": cat.description,
        "batch": cat.source,
        "attached": cat.type == "email",
        "status": None,
        "facet": cat.sub_function,
        "note": cat.note,
    }


def _catalog_note_map(db: DbSession, container: Project) -> dict[str, str]:
    """{catalog path → note} for the container's files (notes only)."""
    stmt = select(Catalog.path, Catalog.note).where(Catalog.note.is_not(None))
    if container.kind == "function_stream":
        stmt = stmt.where(
            Catalog.container_kind == "function", Catalog.function == container.function
        )
    else:
        stmt = stmt.where(Catalog.container_id == container.id)
    return {p: n for p, n in db.execute(stmt).all()}


def _catalog_in_container(cat: Catalog, container: Project) -> bool:
    if container.kind == "function_stream":
        return cat.container_kind == "function" and cat.function == container.function
    return cat.container_id == container.id


@router.get("/{project_id}/facets", response_model=list[str])
def project_facets(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[str]:
    """The container's controlled facet vocabulary (for filter chips)."""
    container = get_container(project_id, user, db)
    if container.kind == "function_stream":
        return functions.facets_for(container.function)
    return list(projectstore.PROJECT_FACETS)


@router.get("/{project_id}/timeline", response_model=list[TimelineNode])
def project_timeline(
    project_id: uuid.UUID,
    facet: str | None = None,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """Timeline nodes for a container (project or function stream): files
    (git-timestamped) + cataloged timeline events + tasks. Optionally filtered
    to one facet (sub-function)."""
    container = get_container(project_id, user, db)
    rel_root = (
        container.function
        if container.kind == "function_stream"
        else f"projects/{container.slug}"
    )
    nodes: list[dict] = projectstore.folder_files(rel_root or "")
    note_map = _catalog_note_map(db, container)
    for n in nodes:  # attach notes to native (git-scanned) file nodes
        n["note"] = note_map.get(n["id"][5:])

    for cat in db.scalars(
        select(Catalog).where(
            Catalog.container_id == project_id, Catalog.on_timeline.is_(True)
        )
    ):
        nodes.append(_doc_node(cat))

    for t in db.scalars(select(Task).where(Task.project_id == project_id)):
        if t.due_date is not None:
            when = datetime(
                t.due_date.year, t.due_date.month, t.due_date.day,
                12, 0, tzinfo=timezone.utc,
            )
        else:
            when = t.created_at
        nodes.append(
            {
                "id": f"task:{t.id}",
                "kind": "task",
                "name": t.title,
                "time": int(when.timestamp() * 1000),
                "type": t.kind,
                "ext": None,
                "path": None,
                "size": None,
                "desc": t.description,
                "batch": None,
                "attached": len(t.documents) > 0,
                "status": t.status,
                "facet": t.facet,
                "note": t.note,
            }
        )

    if facet:
        nodes = [n for n in nodes if n.get("facet") == facet]
    nodes.sort(key=lambda n: n["time"])
    return nodes


@router.post("/{project_id}/timeline/note", status_code=status.HTTP_204_NO_CONTENT)
def set_timeline_note(
    project_id: uuid.UUID,
    body: TimelineNoteIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Attach/clear a note (URL/text) on a timeline item — action item
    (task:<id>), dropped doc (doc:<id>), or file (file:<path>)."""
    container = get_container(project_id, user, db)
    nid = body.node_id
    note = (body.note or "").strip() or None

    if nid.startswith("task:"):
        task = db.get(Task, uuid.UUID(nid[5:]))
        if task is None or task.project_id != project_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        task.note = note
    elif nid.startswith("doc:"):
        cat = db.get(Catalog, uuid.UUID(nid[4:]))
        if cat is None or not _catalog_in_container(cat, container):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        cat.note = note
    elif nid.startswith("file:"):
        cat = db.scalar(select(Catalog).where(Catalog.path == nid[5:]))
        if cat is None or not _catalog_in_container(cat, container):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        cat.note = note
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad node id")
    db.commit()
    return None


@router.post(
    "/{project_id}/documents",
    response_model=TimelineNode,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    project_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Drop a file onto the project's timeline (Tier 0/1 via commit_path).
    Regular files are dated now; .eml emails by their sent/received header."""
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large (max 25 MB)")

    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    description: str | None = None
    if ext == "eml":
        when, subject, sender = projectstore.parse_eml(data)
        occurred = when or datetime.now(timezone.utc)
        node_type = "email"
        title = (subject or filename).strip() or filename
        if sender:
            description = f"From {sender}"
    else:
        occurred = datetime.now(timezone.utc)
        node_type = projectstore._type_for_ext(ext)
        title = filename

    cat = commit_path.add_file(
        db, project=project, function=_PROJECT_FUNCTION, data=data,
        filename=filename, file_type=node_type, ext=ext or None,
        source="timeline_drop", uploader=user, title=title,
        description=description, occurred_at=occurred, on_timeline=True,
        background_tasks=background_tasks,
    )
    return _doc_node(cat)


@router.delete(
    "/{project_id}/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_document(
    project_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Remove a cataloged file: git-remove the bytes, drop its embeddings and
    catalog row (git history retains it)."""
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    cat = db.get(Catalog, document_id)
    if project is None or cat is None or cat.container_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    commit_path.remove_file(db, cat, project=project, actor=user)
    return None


@router.get("/{project_id}/search", response_model=list[SearchHit])
def search_project(
    project_id: uuid.UUID,
    q: str,
    semantic: bool = False,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """Container-scoped file search. Keyword (Postgres FTS) always; semantic
    (the `documents` collection) when toggled. No agent. A project scopes by
    container_id; a function stream scopes by its function corpus."""
    container = get_container(project_id, user, db)
    query = q.strip()
    if not query:
        return []
    is_stream = container.kind == "function_stream"

    if semantic:
        if is_stream:
            hits = docstore.search(
                query, container_kind="function", function=container.function, k=20
            )
        else:
            hits = docstore.search(query, container_id=str(project_id), k=20)
        ids = [uuid.UUID(h.catalog_id) for h in hits if h.catalog_id]
        types = dict(
            db.execute(select(Catalog.id, Catalog.type).where(Catalog.id.in_(ids))).all()
        ) if ids else {}
        return [
            {
                "id": h.catalog_id, "path": h.path, "title": h.title,
                "type": types.get(uuid.UUID(h.catalog_id), "other"),
                "snippet": h.text[:200], "score": h.score, "mode": "semantic",
            }
            for h in hits if h.catalog_id
        ]

    if is_stream:
        where, params = "container_kind = 'function' AND function = :fn", {"q": query, "fn": container.function}
    else:
        where, params = "container_id = :pid", {"q": query, "pid": str(project_id)}
    rows = db.execute(
        sqltext(
            "SELECT id, path, title, type, "
            "ts_headline('english', coalesce(extracted_text,''), "
            " plainto_tsquery('english', :q), "
            " 'MaxFragments=1,MaxWords=22,MinWords=6,ShortWord=2') AS snippet "
            "FROM catalog "
            f"WHERE {where} AND tsv @@ plainto_tsquery('english', :q) "
            "ORDER BY ts_rank(tsv, plainto_tsquery('english', :q)) DESC LIMIT 25"
        ),
        params,
    ).all()
    return [
        {"id": r.id, "path": r.path, "title": r.title, "type": r.type,
         "snippet": r.snippet, "score": None, "mode": "keyword"}
        for r in rows
    ]


@router.get("/{project_id}/tasks", response_model=list[TaskOut])
def list_tasks(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[Task]:
    require_membership(project_id, user, db)
    return list(
        db.scalars(
            select(Task)
            .where(Task.project_id == project_id)
            .order_by(Task.created_at.desc())
        )
    )


@router.post(
    "/{project_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED
)
def create_task(
    project_id: uuid.UUID,
    body: TaskIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> Task:
    require_membership(project_id, user, db)
    task = Task(
        project_id=project_id,
        title=body.title,
        description=body.description,
        due_date=body.due_date,
        kind=body.kind,
        facet=body.facet,
        created_by=user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.delete(
    "/{project_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_task(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Remove an action item (task/milestone/reminder) from the project."""
    require_membership(project_id, user, db)
    task = db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    db.delete(task)
    db.commit()
    return None


# ── Task attachments (link files to an action item) ─────────────────


def _require_task(project_id: uuid.UUID, task_id: uuid.UUID, db: DbSession) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return task


def _taskdoc_out(doc: TaskDocument, db: DbSession) -> dict:
    typ = db.scalar(select(Catalog.type).where(Catalog.path == doc.doc_path))
    return {
        "id": doc.id, "path": doc.doc_path,
        "name": doc.doc_path.rsplit("/", 1)[-1], "type": typ or "other",
    }


@router.get("/{project_id}/tasks/{task_id}/documents", response_model=list[TaskDocOut])
def list_task_documents(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    get_container(project_id, user, db)
    task = _require_task(project_id, task_id, db)
    return [_taskdoc_out(d, db) for d in task.documents]


@router.post(
    "/{project_id}/tasks/{task_id}/documents",
    response_model=TaskDocOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_task_document(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Upload a new file and attach it to the action item (cataloged, not a
    timeline event)."""
    project = get_container(project_id, user, db)
    task = _require_task(project_id, task_id, db)
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large (max 25 MB)")
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    cat = commit_path.add_file(
        db, project=project, function=_PROJECT_FUNCTION, data=data,
        filename=filename, file_type=projectstore._type_for_ext(ext), ext=ext or None,
        source="upload", uploader=user, title=filename,
        on_timeline=False, background_tasks=background_tasks,
    )
    doc = TaskDocument(task_id=task.id, doc_path=cat.path)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _taskdoc_out(doc, db)


@router.post(
    "/{project_id}/tasks/{task_id}/documents/link",
    response_model=TaskDocOut,
    status_code=status.HTTP_201_CREATED,
)
def link_task_document(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    body: TaskDocLinkIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Attach an existing cataloged file (in this container) to the action item."""
    container = get_container(project_id, user, db)
    task = _require_task(project_id, task_id, db)
    cat = db.scalar(select(Catalog).where(Catalog.path == body.path))
    if cat is None or not _catalog_in_container(cat, container):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    existing = db.scalar(
        select(TaskDocument).where(
            TaskDocument.task_id == task.id, TaskDocument.doc_path == cat.path
        )
    )
    doc = existing or TaskDocument(task_id=task.id, doc_path=cat.path)
    if existing is None:
        db.add(doc)
        db.commit()
        db.refresh(doc)
    return _taskdoc_out(doc, db)


@router.delete(
    "/{project_id}/tasks/{task_id}/documents/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unlink_task_document(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    doc_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Detach a file from the action item (unlink only; the file stays)."""
    get_container(project_id, user, db)
    task = _require_task(project_id, task_id, db)
    doc = db.get(TaskDocument, doc_id)
    if doc is None or doc.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "attachment not found")
    db.delete(doc)
    db.commit()
    return None


@router.get("/{project_id}/files", response_model=list[ContainerFile])
def list_container_files(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """Flat list of the container's cataloged files (for the attach picker)."""
    container = get_container(project_id, user, db)
    stmt = select(Catalog).order_by(Catalog.path)
    if container.kind == "function_stream":
        stmt = stmt.where(
            Catalog.container_kind == "function", Catalog.function == container.function
        )
    else:
        stmt = stmt.where(Catalog.container_id == container.id)
    return [
        {"path": c.path, "name": c.path.rsplit("/", 1)[-1], "type": c.type}
        for c in db.scalars(stmt)
    ]
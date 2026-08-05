"""Projects (first-class) + minimal tasks.

Access is by membership: the creator becomes an `owner` member; listing
returns the projects the user belongs to. Per-user permissions beyond
membership are a later concern.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone

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
from sqlalchemy import select
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session as DbSession

from orrery_lib import docstore, filestore

from . import commit_path, functions, projectstore
from .activities import index_task_kb, unindex_task_kb
from .config import settings
from .auth import current_user
from .db import get_db
from .models import (
    Catalog,
    Project,
    ProjectAgent,
    ProjectDocumentLink,
    ProjectLinkFolder,
    ProjectMember,
    ProjectMemberAgent,
    Task,
    TaskDocument,
    User,
)
from .projectstore import create_project_tree
from .schemas import (
    ContainerFile,
    FileOpResult,
    FolderCreateIn,
    FsTreeNode,
    LinkFolderIn,
    LinkFolderOut,
    ProjectDocLinkIn,
    ProjectDocLinkOut,
    ProjectIn,
    ProjectOut,
    ProjectUpdate,
    SearchHit,
    TaskDocLinkIn,
    TaskDocOut,
    TaskIn,
    TaskOut,
    TaskUpdate,
    TimelineDateIn,
    TimelineNode,
    TimelineNoteIn,
)

# Project files are cataloged under the engineering function for now.
# Cross-functional per-file function tagging arrives later.
_PROJECT_FUNCTION = "engr"

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
    # A project belongs to the function it was created under, so it only shows
    # on that function's page. Defaults to engineering if unspecified/unknown.
    fn = body.function if body.function in functions.ACTIVE_FUNCTIONS else _PROJECT_FUNCTION
    project = Project(
        name=body.name,
        slug=slug,
        description=body.description,
        function=fn,
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


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ProjectOut:
    """Edit a project's display details (name, description). The slug and its
    on-disk folder (projects/<slug>/) are intentionally left unchanged — git
    history, timeline dates, and cataloged file paths all key on that slug, so
    the stable filesystem identity is decoupled from the editable label."""
    project = db.get(Project, project_id)
    if project is None or project.kind != "project":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    membership = require_membership(project_id, user, db)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "name cannot be empty"
            )
        project.name = name
    if body.description is not None:
        project.description = body.description.strip() or None
    db.commit()
    db.refresh(project)
    return _to_out(project, membership.role)


MAX_UPLOAD_BYTES = 100 * 1024 * 1024


_FROM_RE = re.compile(r"^From:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_ADDR_RE = re.compile(r"[\w.+-]+@([\w.-]+)")


def _email_direction(description: str | None) -> str:
    """'out' if the email's From is on one of our company domains, else 'in'.
    Reads the From line of the cataloged description (a format we control via
    EmailMeta.description()); defaults to 'in' when it can't be determined."""
    if not description:
        return "in"
    line = _FROM_RE.search(description)
    if not line:
        return "in"
    addr = _ADDR_RE.search(line.group(1))
    if not addr:
        return "in"
    return "out" if addr.group(1).lower() in settings.company_domains else "in"


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
        # Email direction (in/out) so the UI can place + label it; None for
        # non-email nodes.
        "direction": _email_direction(cat.description) if cat.type == "email" else None,
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


def _container_rel_root(container: Project) -> str:
    """The container's FILES_ROOT-relative folder. A function stream resolves
    its folder via the registry (key ≠ folder name after the engr rename); a
    project uses projects/<slug>."""
    if container.kind == "function_stream":
        fdef = functions.FUNCTIONS.get(container.function or "")
        return fdef.folder if fdef else (container.function or "")
    return f"projects/{container.slug}"


def _container_catalog_stmt(container: Project):
    """SELECT Catalog scoped to the container (kind-aware). Function corpus
    files have container_id NULL, so streams must scope by function, not id."""
    stmt = select(Catalog)
    if container.kind == "function_stream":
        return stmt.where(
            Catalog.container_kind == "function", Catalog.function == container.function
        )
    return stmt.where(Catalog.container_id == container.id)


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


def build_timeline(container: Project, facet: str | None, db: DbSession) -> list[dict]:
    """Unified timeline for a container (project OR function stream): native
    git-scanned files + cataloged timeline events + tasks (action items /
    reminders / milestones) + notes. Shared by project + function endpoints.
    Function corpus files have container_id NULL, so streams scope by function
    (via the container-kind-aware helpers), and the folder is resolved through
    the registry (key ≠ folder after the engr rename)."""
    nodes: list[dict] = projectstore.folder_files(_container_rel_root(container))
    note_map = _catalog_note_map(db, container)
    for n in nodes:  # attach notes to native (git-scanned) file nodes
        n["note"] = note_map.get(n["id"][5:])

    for cat in db.scalars(_container_catalog_stmt(container).where(Catalog.on_timeline.is_(True))):
        nodes.append(_doc_node(cat))

    for t in db.scalars(select(Task).where(Task.project_id == container.id)):
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


@router.get("/{project_id}/timeline", response_model=list[TimelineNode])
def project_timeline(
    project_id: uuid.UUID,
    facet: str | None = None,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """Timeline nodes for a container, optionally filtered to one facet."""
    return build_timeline(get_container(project_id, user, db), facet, db)


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
        task.synthesized = "pending"  # edited → re-digest next synthesis pass
    elif nid.startswith("doc:"):
        cat = db.get(Catalog, uuid.UUID(nid[4:]))
        if cat is None or not _catalog_in_container(cat, container):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        cat.note = note
        cat.synthesized = "pending"
    elif nid.startswith("file:"):
        cat = db.scalar(select(Catalog).where(Catalog.path == nid[5:]))
        if cat is None or not _catalog_in_container(cat, container):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        cat.note = note
        cat.synthesized = "pending"
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad node id")
    db.commit()
    return None


@router.post("/{project_id}/timeline/date", status_code=status.HTTP_204_NO_CONTENT)
def set_timeline_date(
    project_id: uuid.UUID,
    body: TimelineDateIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Move a timeline item to a different day — an action item (task:<id> →
    due_date) or a dropped doc/email (doc:<id> → occurred_at, at noon UTC).
    Native git-scanned files (file:) are dated by git and not editable here."""
    container = get_container(project_id, user, db)
    nid = body.node_id
    try:
        y, m, d = (int(x) for x in body.date.split("-"))
        when = datetime(y, m, d, 12, 0, tzinfo=timezone.utc)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad date")

    if nid.startswith("task:"):
        task = db.get(Task, uuid.UUID(nid[5:]))
        if task is None or task.project_id != project_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        task.due_date = when.date()
        task.synthesized = "pending"
    elif nid.startswith("doc:"):
        cat = db.get(Catalog, uuid.UUID(nid[4:]))
        if cat is None or not _catalog_in_container(cat, container):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        cat.occurred_at = when
        cat.synthesized = "pending"
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "date not editable for this item")
    db.commit()
    return None


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large (max 100 MB)")
    return data


def ingest_timeline_drop(
    db: DbSession, container: Project, data: bytes, filename: str | None,
    uploader: User, background_tasks: BackgroundTasks,
    dest_dir: str | None = None,
) -> Catalog:
    """Catalog a dropped file as a timeline event (.eml dated by header). Works
    for projects AND function streams — add_file resolves the destination by
    container kind. `dest_dir` (FILES_ROOT-relative folder) overrides the
    default attachments/ landing spot — e.g. a tree folder the user dropped on."""
    filename = filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    description: str | None = None
    if ext == "eml":
        meta = projectstore.parse_eml(data)
        occurred = meta.date or datetime.now(timezone.utc)
        node_type = "email"
        title = (meta.subject or filename).strip() or filename
        description = meta.description()
    else:
        occurred = datetime.now(timezone.utc)
        node_type = projectstore._type_for_ext(ext)
        title = filename
    return commit_path.add_file(
        db, project=container, function=_PROJECT_FUNCTION, data=data,
        filename=filename, file_type=node_type, ext=ext or None,
        source="timeline_drop", uploader=uploader, title=title,
        description=description, occurred_at=occurred, on_timeline=True,
        dest_dir=dest_dir, background_tasks=background_tasks,
    )


@router.post(
    "/{project_id}/documents",
    response_model=TimelineNode,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    project_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    dir: str | None = Form(None),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Drop a file onto the project's timeline (Tier 0/1 via commit_path).
    Regular files are dated now; .eml emails by their sent/received header.
    `dir` (a folder from the project tree) overrides the attachments/ landing."""
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    dest_dir: str | None = None
    if dir:
        root = f"projects/{project.slug}"
        norm = dir.strip().strip("/").replace("\\", "/")
        if ".." in norm.split("/") or not (norm == root or norm.startswith(root + "/")):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "target outside project")
        dest_dir = norm
    data = await _read_upload(file)
    # If the target folder is a "link folder" portal, the file is written into
    # the function corpus instead of the project, and a shortcut is left behind.
    if dest_dir is not None:
        portal = db.scalar(
            select(ProjectLinkFolder).where(
                ProjectLinkFolder.project_id == project.id,
                ProjectLinkFolder.folder_path == dest_dir,
            )
        )
        if portal is not None:
            return _doc_node(
                _portal_ingest(
                    db, project, portal, data, file.filename, user, background_tasks
                )
            )
    return _doc_node(
        ingest_timeline_drop(
            db, project, data, file.filename, user, background_tasks, dest_dir=dest_dir
        )
    )


# ── Project folders (mirror the function-folder endpoints) ───────────


def _project_subpath(project: Project, sub: str | None) -> tuple[str, str]:
    """Validate a project-relative subpath. Returns (project-relative,
    FILES_ROOT-relative). "" → the project root."""
    root = f"projects/{project.slug}"
    norm = (sub or "").strip().strip("/").replace("\\", "/")
    if norm and (".." in norm.split("/") or norm.startswith(".")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid folder path")
    return norm, (f"{root}/{norm}" if norm else root)


@router.get("/{project_id}/tree", response_model=FsTreeNode)
def project_tree(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    root = filestore.FILES_ROOT / f"projects/{project.slug}"
    tree = (
        projectstore.build_tree(root, "root")
        if root.exists()
        else {"name": "root", "children": []}
    )
    return augment_project_tree(tree, project, db)


@router.get("/{project_id}/folders", response_model=list[str])
def project_folders(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[str]:
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    base = filestore.FILES_ROOT / f"projects/{project.slug}"
    if not base.is_dir():
        return []
    out = [
        str(p.relative_to(base))
        for p in base.rglob("*")
        if p.is_dir() and ".git" not in p.parts
    ]
    return sorted(out)


@router.post("/{project_id}/folders", response_model=list[str], status_code=status.HTTP_201_CREATED)
def create_project_folder(
    project_id: uuid.UUID,
    body: FolderCreateIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[str]:
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    _, parent_full = _project_subpath(project, body.parent)
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
        f"projects/{project.slug}: add folder {name}",
        author_name=user.display_name, author_email=user.email,
    )
    return project_folders(project_id, user, db)


@router.delete("/{project_id}/folders", response_model=FileOpResult)
def delete_project_folder(
    project_id: uuid.UUID,
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    rel, full = _project_subpath(project, path)
    if not rel:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot delete the project root")
    if not (filestore.FILES_ROOT / full).is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "folder not found")
    status_, rec = commit_path.route_folder_delete(
        db, rel_path=full, function=project.function or "engr",
        user=user, summary=f"Delete folder {rel}",
    )
    return {"status": status_, "proposal_id": rec.id if rec else None}


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
    cat = db.get(Catalog, document_id)
    if cat is None or cat.container_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    commit_path.remove_file(db, cat, actor=user)
    return None


def container_search(container: Project, q: str, semantic: bool, db: DbSession) -> list[dict]:
    """Container-scoped file search shared by projects + function streams.
    Keyword (Postgres FTS) always; semantic (the `documents` collection) when
    toggled. A project scopes by container_id; a stream by its function corpus."""
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
            hits = docstore.search(query, container_id=str(container.id), k=20)
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
        where, params = "container_id = :pid", {"q": query, "pid": str(container.id)}
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


@router.get("/{project_id}/search", response_model=list[SearchHit])
def search_project(
    project_id: uuid.UUID,
    q: str,
    semantic: bool = False,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """Container-scoped file search (no agent)."""
    container = get_container(project_id, user, db)
    return container_search(container, q, semantic, db)


@router.get("/{project_id}/tasks", response_model=list[TaskOut])
def list_tasks(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[Task]:
    get_container(project_id, user, db)  # project membership OR function access
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
    container = get_container(project_id, user, db)  # membership OR function access
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
    index_task_kb(task, container_name=container.name)  # → agent-searchable
    db.commit()
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
    """Remove an action item (task/milestone/reminder) from the container."""
    get_container(project_id, user, db)  # project membership OR function access
    task = db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    unindex_task_kb(task)  # drop its learnings point
    db.delete(task)
    db.commit()
    return None


@router.patch("/{project_id}/tasks/{task_id}", response_model=TaskOut)
def update_task(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    body: TaskUpdate,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> Task:
    """Update an action item's completion status ("todo"/"done"). Status-only, so
    it doesn't touch the KB (mirrors the internal agent update)."""
    get_container(project_id, user, db)  # project membership OR function access
    task = db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    task.status = body.status
    task.synthesized = "pending"  # flag for the next synthesis pass
    db.commit()
    db.refresh(task)
    return task


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
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large (max 100 MB)")
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


# ── Spec linking: reference function-corpus files into a project ─────
# A link surfaces a function file inside a project's tree as a shortcut, with
# no copy (catalog.path is UNIQUE). Two ways in: an explicit picker (link an
# existing file) and a "link folder" portal (drops route to the function
# corpus, leaving a shortcut behind). See docs/decisions.md.


def _require_project(project_id: uuid.UUID, user: User, db: DbSession) -> Project:
    """A real (kind=project) container the user belongs to. Links/portals target
    a project, never a function stream."""
    container = get_container(project_id, user, db)
    if container.kind != "project":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "links target a project")
    return container


def _validate_project_dir(project: Project, target_dir: str | None) -> str:
    """Normalize a project-relative target folder (default = project root); it
    must exist on disk and live under projects/<slug>."""
    root = f"projects/{project.slug}"
    if not target_dir:
        return root
    norm = target_dir.strip().strip("/").replace("\\", "/")
    if ".." in norm.split("/") or not (norm == root or norm.startswith(root + "/")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "target outside project")
    if not (filestore.FILES_ROOT / norm).is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "target folder not found")
    return norm


def _validate_function_dir(key: str, dest_dir: str) -> str:
    """Normalize a destination folder under a function's corpus; must exist."""
    fdef = functions.FUNCTIONS.get(key)
    if fdef is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "function not found")
    norm = (dest_dir or "").strip().strip("/").replace("\\", "/")
    if not norm or ".." in norm.split("/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid destination folder")
    if norm != fdef.folder and not norm.startswith(fdef.folder + "/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "destination outside function folder")
    if not (filestore.FILES_ROOT / norm).is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "destination folder not found")
    return norm


def _link_out(link: ProjectDocumentLink, db: DbSession) -> dict:
    cat = db.scalar(select(Catalog).where(Catalog.path == link.doc_path))
    return {
        "id": link.id,
        "path": link.doc_path,
        "name": link.doc_path.rsplit("/", 1)[-1],
        "type": cat.type if cat else "other",
        "function": cat.function if cat else "",
        "target_dir": link.target_dir,
    }


def _upsert_link(
    db: DbSession, project_id: uuid.UUID, doc_path: str, target_dir: str, user: User
) -> ProjectDocumentLink:
    """Idempotent on (project, doc_path); re-linking updates the target folder."""
    link = db.scalar(
        select(ProjectDocumentLink).where(
            ProjectDocumentLink.project_id == project_id,
            ProjectDocumentLink.doc_path == doc_path,
        )
    )
    if link is None:
        link = ProjectDocumentLink(
            project_id=project_id, doc_path=doc_path,
            target_dir=target_dir, created_by=user.id,
        )
        db.add(link)
    else:
        link.target_dir = target_dir
    db.commit()
    db.refresh(link)
    return link


def _portal_ingest(
    db: DbSession, project: Project, portal: ProjectLinkFolder,
    data: bytes, filename: str | None, user: User, background_tasks: BackgroundTasks,
) -> Catalog:
    """A drop into a link folder: write into the function corpus (deduped by
    sha256 — same content already there → no copy), then leave a shortcut in the
    project's portal folder. Returns the (existing or new) function Catalog row."""
    sha = hashlib.sha256(data).hexdigest()
    existing = db.scalar(
        select(Catalog).where(
            Catalog.container_kind == "function",
            Catalog.function == portal.dest_function,
            Catalog.sha256 == sha,
        )
    )
    if existing is not None:
        cat = existing
    else:
        stream = db.scalar(
            select(Project).where(
                Project.kind == "function_stream",
                Project.function == portal.dest_function,
            )
        )
        assert stream is not None  # portal creation validated the function exists
        cat = ingest_timeline_drop(
            db, stream, data, filename, user, background_tasks, dest_dir=portal.dest_dir
        )
    _upsert_link(db, project.id, cat.path, portal.folder_path, user)
    return cat


@router.get("/{project_id}/links", response_model=list[ProjectDocLinkOut])
def list_project_links(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """The project's linked specs (shortcuts to function-corpus files)."""
    project = _require_project(project_id, user, db)
    links = db.scalars(
        select(ProjectDocumentLink)
        .where(ProjectDocumentLink.project_id == project.id)
        .order_by(ProjectDocumentLink.created_at)
    ).all()
    return [_link_out(link, db) for link in links]


@router.post(
    "/{project_id}/links", response_model=ProjectDocLinkOut,
    status_code=status.HTTP_201_CREATED,
)
def create_project_link(
    project_id: uuid.UUID,
    body: ProjectDocLinkIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Link an existing function-corpus file into a project folder (no copy)."""
    project = _require_project(project_id, user, db)
    cat = db.scalar(select(Catalog).where(Catalog.path == body.path))
    if (
        cat is None
        or cat.container_kind != "function"
        or not functions.can_access_function(user, cat.function)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    target_dir = _validate_project_dir(project, body.target_dir)
    return _link_out(_upsert_link(db, project.id, cat.path, target_dir, user), db)


@router.delete(
    "/{project_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_project_link(
    project_id: uuid.UUID,
    link_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Remove a shortcut (unlink only; the source file is untouched)."""
    project = _require_project(project_id, user, db)
    link = db.get(ProjectDocumentLink, link_id)
    if link is None or link.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "link not found")
    db.delete(link)
    db.commit()
    return None


@router.get("/{project_id}/link-folders", response_model=list[LinkFolderOut])
def list_link_folders(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    project = _require_project(project_id, user, db)
    rows = db.scalars(
        select(ProjectLinkFolder).where(ProjectLinkFolder.project_id == project.id)
    ).all()
    return [
        {"id": r.id, "folder_path": r.folder_path,
         "dest_function": r.dest_function, "dest_dir": r.dest_dir}
        for r in rows
    ]


@router.post(
    "/{project_id}/link-folders", response_model=LinkFolderOut,
    status_code=status.HTTP_201_CREATED,
)
def create_link_folder(
    project_id: uuid.UUID,
    body: LinkFolderIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Designate a project folder as a portal: drops route to a function corpus,
    leaving a shortcut behind. Sensitive (risk-floored) destinations are rejected
    for now — the queued write can't produce a synchronous link."""
    project = _require_project(project_id, user, db)
    folder_path = _validate_project_dir(project, body.folder_path)
    if not functions.can_access_function(user, body.dest_function):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "function not found")
    dest_dir = _validate_function_dir(body.dest_function, body.dest_dir)
    if commit_path.path_risk_floor(dest_dir.rstrip("/") + "/") != "low":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "that destination needs approval on write; not allowed as a link folder yet",
        )
    lf = db.scalar(
        select(ProjectLinkFolder).where(
            ProjectLinkFolder.project_id == project.id,
            ProjectLinkFolder.folder_path == folder_path,
        )
    )
    if lf is None:
        lf = ProjectLinkFolder(
            project_id=project.id, folder_path=folder_path,
            dest_function=body.dest_function, dest_dir=dest_dir, created_by=user.id,
        )
        db.add(lf)
    else:
        lf.dest_function, lf.dest_dir = body.dest_function, dest_dir
    db.commit()
    db.refresh(lf)
    return {"id": lf.id, "folder_path": lf.folder_path,
            "dest_function": lf.dest_function, "dest_dir": lf.dest_dir}


@router.delete(
    "/{project_id}/link-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_link_folder(
    project_id: uuid.UUID,
    folder_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Stop a folder being a portal (existing shortcuts in it stay)."""
    project = _require_project(project_id, user, db)
    lf = db.get(ProjectLinkFolder, folder_id)
    if lf is None or lf.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "link folder not found")
    db.delete(lf)
    db.commit()
    return None


def _find_tree_node(node: dict, store_path: str) -> dict | None:
    if node.get("store_path") == store_path:
        return node
    for child in node.get("children") or []:
        found = _find_tree_node(child, store_path)
        if found is not None:
            return found
    return None


def augment_project_tree(tree: dict, project: Project, db: DbSession) -> dict:
    """Merge linking metadata into a project's filesystem tree: mark portal
    folders, and inject each link as a shortcut leaf at its target folder
    (store_path = the SOURCE path, so open/preview work unchanged). Stale links
    (source gone) are skipped; a missing target folder falls back to the root."""
    for portal in db.scalars(
        select(ProjectLinkFolder).where(ProjectLinkFolder.project_id == project.id)
    ):
        node = _find_tree_node(tree, portal.folder_path)
        if node is not None and node.get("children") is not None:
            node["link_folder"] = True
            node["link_dest"] = portal.dest_dir

    for link in db.scalars(
        select(ProjectDocumentLink).where(ProjectDocumentLink.project_id == project.id)
    ):
        cat = db.scalar(select(Catalog).where(Catalog.path == link.doc_path))
        if cat is None:
            continue  # stale source — skip
        target = _find_tree_node(tree, link.target_dir) or tree
        if target.get("children") is None:
            target = tree
        target["children"].append(
            {
                "name": link.doc_path.rsplit("/", 1)[-1],
                "store_path": link.doc_path,
                "link_id": str(link.id),
            }
        )
    return tree
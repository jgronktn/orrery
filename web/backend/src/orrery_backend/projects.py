"""Projects (first-class) + minimal tasks.

Access is by membership: the creator becomes an `owner` member; listing
returns the projects the user belongs to. Per-user permissions beyond
membership are a later concern.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from . import projectstore
from .auth import current_user
from .db import get_db
from .models import (
    Project,
    ProjectAgent,
    ProjectDocument,
    ProjectMember,
    ProjectMemberAgent,
    Task,
    User,
)
from .projectstore import create_project_tree
from .schemas import ProjectIn, ProjectOut, TaskIn, TaskOut, TimelineNode

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
    rows = db.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id, Project.archived.is_(False))
        .order_by(Project.created_at.desc())
    ).all()
    return [_to_out(project, role) for project, role in rows]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ProjectOut:
    membership = require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    return _to_out(project, membership.role)


MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _doc_node(doc: ProjectDocument) -> dict:
    """Render a dropped document as a timeline node, dated by occurred_at."""
    ext = doc.filename.rsplit(".", 1)[-1].lower() if "." in doc.filename else None
    return {
        "id": f"doc:{doc.id}",
        "kind": "file",
        "name": doc.title,
        "time": int(doc.occurred_at.timestamp() * 1000),
        "type": doc.type,
        "ext": ext,
        "path": doc.path,
        "size": doc.size,
        "desc": doc.description,
        "batch": doc.source,
        "attached": doc.source == "email",
        "status": None,
    }


@router.get("/{project_id}/timeline", response_model=list[TimelineNode])
def project_timeline(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    """Timeline nodes for a project: files (git-timestamped) + dropped
    documents (dated by drop time / email Date) + tasks."""
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    assert project is not None
    nodes: list[dict] = projectstore.project_files(project.slug)

    for doc in db.scalars(
        select(ProjectDocument).where(ProjectDocument.project_id == project_id)
    ):
        nodes.append(_doc_node(doc))

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
            }
        )

    nodes.sort(key=lambda n: n["time"])
    return nodes


@router.post(
    "/{project_id}/documents",
    response_model=TimelineNode,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Record a dropped file on the project's timeline. Regular files are
    dated now; .eml emails are dated by their sent/received header."""
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
        node_type, source = "email", "email"
        title = (subject or filename).strip() or filename
        if sender:
            description = f"From {sender}"
    else:
        occurred = datetime.now(timezone.utc)
        node_type, source = projectstore._type_for_ext(ext), "upload"
        title = filename

    rel_path, stored_name = projectstore.save_upload(
        project.slug, filename, data,
        author_name=user.display_name, author_email=user.email,
    )
    doc = ProjectDocument(
        project_id=project_id,
        filename=stored_name,
        path=rel_path,
        title=title[:300],
        type=node_type,
        size=len(data),
        occurred_at=occurred,
        source=source,
        description=description,
        uploaded_by=user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _doc_node(doc)


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
    """Remove a dropped document from the timeline — deletes the stored file
    (git-removed, history-recoverable) and the record."""
    require_membership(project_id, user, db)
    project = db.get(Project, project_id)
    doc = db.get(ProjectDocument, document_id)
    if project is None or doc is None or doc.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    projectstore.delete_upload(
        project.slug, doc.path,
        author_name=user.display_name, author_email=user.email,
    )
    db.delete(doc)
    db.commit()
    return None


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
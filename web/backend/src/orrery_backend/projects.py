"""Projects (first-class) + minimal tasks.

Access is by membership: the creator becomes an `owner` member; listing
returns the projects the user belongs to. Per-user permissions beyond
membership are a later concern.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db
from .models import Project, ProjectMember, Task, User
from .schemas import ProjectIn, ProjectOut, TaskIn, TaskOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


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
    project = Project(name=body.name, description=body.description, created_by=user.id)
    db.add(project)
    db.flush()  # assign project.id
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role="owner"))
    db.commit()
    db.refresh(project)
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
    task = Task(project_id=project_id, title=body.title, created_by=user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task
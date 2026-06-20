"""Internal agent API: agent → backend, for project-scoped PM + research-log
operations the agent can't do directly (Postgres state, governed FS writes).

Auth: a short-lived signed **callback token** (minted by the backend for an
agent run) carried in the `X-Agent-Callback` header, encoding
`{user_id, agent_id, project_id}`. The backend validates it and enforces
`project_agents` — an agent not engaged on the project is refused. This keeps
the backend the single enforcement point; the agent never touches Postgres.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from . import functions, projectstore
from .db import get_db
from .models import Project, ProjectAgent, Task, TaskDocument, User
from .schemas import (
    AgentTaskIn,
    AgentTaskUpdate,
    LinkDocIn,
    ResearchLogAppendIn,
    ResearchLogOut,
    TaskOut,
)
from .security import verify_agent_callback

router = APIRouter(prefix="/internal/agent", tags=["internal-agent"])


@dataclass
class AgentContext:
    user: User
    agent_id: str
    project: Project


def agent_context(
    request: Request, db: DbSession = Depends(get_db)
) -> AgentContext:
    token = request.headers.get("X-Agent-Callback", "")
    payload = verify_agent_callback(token) if token else None
    if not payload:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "invalid or missing agent callback token"
        )
    try:
        user_id = uuid.UUID(payload["user_id"])
        project_id = uuid.UUID(payload["project_id"])
        agent_id = str(payload["agent_id"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed callback token")

    user = db.get(User, user_id)
    project = db.get(Project, project_id)
    if user is None or project is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown user or project")

    # A function stream has one implicit agent (the function's). A project
    # engages agents explicitly via project_agents.
    if project.kind == "function_stream":
        engaged = functions.agent_for_function(project.function) == agent_id
    else:
        engaged = db.scalar(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project.id,
                ProjectAgent.agent_id == agent_id,
            )
        ) is not None
    if not engaged:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"agent '{agent_id}' is not engaged on this container",
        )
    return AgentContext(user=user, agent_id=agent_id, project=project)


# ── Tasks ───────────────────────────────────────────────────────────


@router.get("/tasks", response_model=list[TaskOut])
def list_project_tasks(
    ctx: AgentContext = Depends(agent_context), db: DbSession = Depends(get_db)
) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .where(Task.project_id == ctx.project.id)
            .order_by(Task.created_at.desc())
        )
    )


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    body: AgentTaskIn,
    ctx: AgentContext = Depends(agent_context),
    db: DbSession = Depends(get_db),
) -> Task:
    task = Task(
        project_id=ctx.project.id,
        title=body.title,
        description=body.description,
        owner_id=body.owner_id,
        due_date=body.due_date,
        kind=body.kind,
        facet=body.facet,
        created_by=ctx.user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _get_project_task(db: DbSession, ctx: AgentContext, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.project_id != ctx.project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found in this project")
    return task


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID,
    body: AgentTaskUpdate,
    ctx: AgentContext = Depends(agent_context),
    db: DbSession = Depends(get_db),
) -> Task:
    task = _get_project_task(db, ctx, task_id)
    changed = False
    for field in ("title", "description", "status", "owner_id", "due_date", "kind", "facet"):
        value = getattr(body, field)
        if value is not None:
            setattr(task, field, value)
            changed = True
    if changed:
        task.synthesized = "pending"  # edited → re-digest next synthesis pass
    db.commit()
    db.refresh(task)
    return task


@router.post("/tasks/{task_id}/docs", response_model=TaskOut)
def link_task_to_doc(
    task_id: uuid.UUID,
    body: LinkDocIn,
    ctx: AgentContext = Depends(agent_context),
    db: DbSession = Depends(get_db),
) -> Task:
    task = _get_project_task(db, ctx, task_id)
    db.add(TaskDocument(task_id=task.id, doc_path=body.doc_path))
    db.commit()
    db.refresh(task)
    return task


# ── Research log ────────────────────────────────────────────────────


@router.get("/research-log", response_model=ResearchLogOut)
def read_research_log(
    ctx: AgentContext = Depends(agent_context),
) -> ResearchLogOut:
    try:
        content = projectstore.read_research_log(ctx.project.slug)
    except FileNotFoundError:
        content = ""
    return ResearchLogOut(project_id=ctx.project.id, content=content)


@router.post("/research-log", response_model=ResearchLogOut)
def append_research_log(
    body: ResearchLogAppendIn,
    ctx: AgentContext = Depends(agent_context),
) -> ResearchLogOut:
    attribution = f"{ctx.agent_id} agent (for {ctx.user.display_name})"
    try:
        content = projectstore.append_research_log(
            ctx.project.slug, body.section, body.content, attribution
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return ResearchLogOut(project_id=ctx.project.id, content=content)

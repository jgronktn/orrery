"""Agent registry + the route that proxies a query to an agent service.

The backend is the ONLY caller of agent HTTP services (CLAUDE.md
invariant). The registry is data-driven so future agents (bookkeeping,
EA, …) are added here without new routing code; only engineering is
wired up now.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from orrery_lib.schema import AgentRequest, AgentResponse, ConversationTurn

from .auth import current_user
from .config import settings
from .db import get_db
from .models import Conversation, Message, Project, User
from .projects import require_membership
from .schemas import AgentSummary, MessageOut, SendMessageIn


@dataclass(frozen=True)
class AgentDescriptor:
    id: str
    name: str
    description: str
    url: str


REGISTRY: dict[str, AgentDescriptor] = {
    "engineering": AgentDescriptor(
        id="engineering",
        name="Engineering",
        description="Drive document Q&A, parts/vendor research, and template drafting.",
        url=settings.engineering_agent_url,
    ),
}

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("", response_model=list[AgentSummary])
def list_agents(user: User = Depends(current_user)) -> list[AgentSummary]:
    return [
        AgentSummary(id=a.id, name=a.name, description=a.description)
        for a in REGISTRY.values()
    ]


@router.post("/{agent_id}/run", response_model=AgentResponse)
async def run_agent(
    agent_id: str, req: AgentRequest, user: User = Depends(current_user)
) -> AgentResponse:
    agent = REGISTRY.get(agent_id)
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown agent")
    # Per-user agent permissions are a later step; any authenticated user
    # may use engineering for now.
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(f"{agent.url}/run", json=req.model_dump())
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"agent '{agent_id}' error: {exc}"
        )
    return AgentResponse.model_validate(resp.json())


# ── Persisted, project-scoped conversation ──────────────────────────
# Conversation state lives in Postgres (the agent stays stateless): one
# conversation per (user, agent, project); project_id=None is the global
# context (placeholder for the future EA).


def _require_agent(agent_id: str) -> AgentDescriptor:
    agent = REGISTRY.get(agent_id)
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown agent")
    return agent


def _find_conversation(
    db: DbSession, user: User, agent_id: str, project_id: uuid.UUID | None
) -> Conversation | None:
    stmt = select(Conversation).where(
        Conversation.user_id == user.id, Conversation.agent_id == agent_id
    )
    stmt = (
        stmt.where(Conversation.project_id.is_(None))
        if project_id is None
        else stmt.where(Conversation.project_id == project_id)
    )
    return db.scalar(stmt)


@router.get("/{agent_id}/messages", response_model=list[MessageOut])
def get_messages(
    agent_id: str,
    project_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[Message]:
    _require_agent(agent_id)
    if project_id is not None:
        require_membership(project_id, user, db)
    conv = _find_conversation(db, user, agent_id, project_id)
    return list(conv.messages) if conv else []


@router.post("/{agent_id}/messages", response_model=MessageOut)
async def send_message(
    agent_id: str,
    body: SendMessageIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> Message:
    agent = _require_agent(agent_id)

    project_context: dict | None = None
    if body.project_id is not None:
        require_membership(body.project_id, user, db)
        project = db.get(Project, body.project_id)
        project_context = {
            "project_id": str(body.project_id),
            "project_name": project.name if project else None,
        }

    conv = _find_conversation(db, user, agent_id, body.project_id)
    if conv is None:
        conv = Conversation(
            user_id=user.id, agent_id=agent_id, project_id=body.project_id
        )
        db.add(conv)
        db.flush()

    history = [
        ConversationTurn(role=m.role, content=m.content) for m in conv.messages
    ]
    req = AgentRequest(
        query=body.query,
        conversation_history=history,
        project_context=project_context,
    )
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(f"{agent.url}/run", json=req.model_dump())
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"agent '{agent_id}' error: {exc}"
        )
    answer = AgentResponse.model_validate(resp.json())

    db.add(Message(conversation_id=conv.id, role="user", content=body.query))
    assistant = Message(
        conversation_id=conv.id,
        role="assistant",
        content=answer.text,
        artifacts=[a.model_dump() for a in answer.artifacts],
        proposals=[p.model_dump() for p in answer.proposals],
    )
    db.add(assistant)
    db.commit()
    db.refresh(assistant)
    return assistant

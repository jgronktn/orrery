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

from orrery_lib.schema import (
    AgentCallback,
    AgentRequest,
    AgentResponse,
    ConversationTurn,
    Risk,
)

from .auth import current_user
from .config import settings
from .db import get_db
from .governance import classify, execute_proposal
from .models import (
    Conversation,
    Message,
    Project,
    ProposalRecord,
    User,
)
from .projects import _container_rel_root, get_container
from .schemas import AgentSummary, MessageOut, SendMessageIn
from .security import sign_agent_callback
from .slack import notify_approval


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
        get_container(project_id, user, db)
    conv = _find_conversation(db, user, agent_id, project_id)
    return list(conv.messages) if conv else []


@router.post("/{agent_id}/messages", response_model=list[MessageOut])
async def send_message(
    agent_id: str,
    body: SendMessageIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> Message:
    agent = _require_agent(agent_id)

    project_context: dict | None = None
    callback: AgentCallback | None = None
    if body.project_id is not None:
        project = get_container(body.project_id, user, db)
        project_context = {
            "project_id": str(body.project_id),
            "project_name": project.name if project else None,
            # The container's FILES_ROOT-relative folder, so the agent can scope
            # its file tools to this project/stream (where dropped files + emails
            # live) rather than only the engineering corpus.
            "folder": _container_rel_root(project) if project else None,
        }
        # Mint a short-lived callback token so the agent can reach the
        # /internal/agent API (tasks + research log) for this project.
        token = sign_agent_callback(
            {
                "user_id": str(user.id),
                "agent_id": agent_id,
                "project_id": str(body.project_id),
            }
        )
        callback = AgentCallback(
            token=token, backend_url=settings.backend_internal_url
        )

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
        callback=callback,
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

    # Route each proposal: low auto-executes; medium/high queue for approval
    # (with a Slack heads-up). The honest, possibly-overridden risk is
    # reflected back into the stored message so the UI and queue agree.
    for p in answer.proposals:
        final = classify(p.kind, p.risk.value)
        p.risk = Risk(final)
        record = ProposalRecord(
            user_id=user.id,
            conversation_id=conv.id,
            project_id=body.project_id,
            agent_id=agent_id,
            kind=p.kind,
            summary=p.summary,
            risk=final,
            payload=p.payload,
            status="pending",
        )
        db.add(record)
        db.flush()
        if final == "low":
            record.decided_by = user.id
            await execute_proposal(db, record, agent.url)
        else:
            notify_approval(p.summary, final)

    user_msg = Message(conversation_id=conv.id, role="user", content=body.query)
    db.add(user_msg)
    assistant = Message(
        conversation_id=conv.id,
        role="assistant",
        content=answer.text,
        artifacts=[a.model_dump() for a in answer.artifacts],
        proposals=[p.model_dump() for p in answer.proposals],
    )
    db.add(assistant)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant)
    # Return both persisted turns (with real ids) so the UI can address each
    # message — e.g. to delete one and prune it from future context.
    return [user_msg, assistant]


@router.delete(
    "/{agent_id}/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_message(
    agent_id: str,
    message_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Delete one message from the user's conversation. Since conversation
    history is what the agent sees, this prunes that turn from future context."""
    _require_agent(agent_id)
    msg = db.get(Message, message_id)
    if msg is not None:
        conv = db.get(Conversation, msg.conversation_id)
        if conv is not None and conv.user_id == user.id and conv.agent_id == agent_id:
            db.delete(msg)
            db.commit()
            return None
    raise HTTPException(status.HTTP_404_NOT_FOUND, "message not found")

"""Agent registry + the route that proxies a query to an agent service.

The backend is the ONLY caller of agent HTTP services (CLAUDE.md
invariant). The registry is data-driven so future agents (bookkeeping,
EA, …) are added here without new routing code; only engineering is
wired up now.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from orrery_lib.schema import AgentRequest, AgentResponse

from .auth import current_user
from .config import settings
from .models import User
from .schemas import AgentSummary


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

"""The agent ↔ backend contract — defined ONCE here, imported by both the
agents and the web backend (and surfaced to the frontend via the
backend's OpenAPI export).

An agent run takes a query (plus optional prior turns and project
context) and returns structured output: prose `text`, zero or more
`artifacts` (things produced — a Drive doc, a table), and zero or more
`proposals` (actions the agent wants a human to approve). Each proposal
carries a risk tag the backend uses to route it (low auto-executes,
medium queues, high needs explicit approval).
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Risk(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ConversationTurn(BaseModel):
    """One prior turn, as the backend stores/sends it (stateless agent)."""

    role: str  # "user" | "assistant"
    content: str


class Artifact(BaseModel):
    """Something the agent produced this turn (e.g. a created Drive doc)."""

    kind: str  # e.g. "drive_doc", "table"
    title: str
    url: str | None = None
    data: dict = Field(default_factory=dict)


class Proposal(BaseModel):
    """An action the agent proposes; a human approves before it executes.
    The agent suggests `risk`, but the backend may override it."""

    kind: str  # e.g. "save_spec", "create_draft"
    summary: str
    risk: Risk = Risk.MEDIUM
    payload: dict = Field(default_factory=dict)


class AgentCallback(BaseModel):
    """Lets the agent call back into the backend's /internal/agent API for
    project-scoped PM + research-log ops. The token encodes
    (user, agent, project); the backend enforces project_agents."""

    token: str
    backend_url: str


class AgentRequest(BaseModel):
    query: str
    conversation_history: list[ConversationTurn] = Field(default_factory=list)
    project_context: dict | None = None
    callback: AgentCallback | None = None


class AgentResponse(BaseModel):
    text: str
    artifacts: list[Artifact] = Field(default_factory=list)
    proposals: list[Proposal] = Field(default_factory=list)

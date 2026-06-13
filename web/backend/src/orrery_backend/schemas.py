"""Pydantic request/response models for the backend's own API.

(The agent contract — AgentRequest/AgentResponse — is imported from
orrery_lib.schema, defined once and shared.)
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from orrery_lib.schema import Artifact, Proposal


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str = Field(min_length=1, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    display_name: str
    role: str
    status: str
    created_at: datetime


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class PasswordResetConfirmIn(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=256)


class AgentSummary(BaseModel):
    id: str
    name: str
    description: str


# ── Projects ────────────────────────────────────────────────────────


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    archived: bool
    created_at: datetime
    role: str = "member"  # the requesting user's role in this project


# ── Tasks (minimal; schema ready for the future PM agent) ───────────


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    status: str
    owner_id: uuid.UUID | None = None
    due_date: date | None = None
    created_at: datetime


# ── Internal agent API (agent → backend, callback-token auth) ───────


class AgentTaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    owner_id: uuid.UUID | None = None
    due_date: date | None = None


class AgentTaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    owner_id: uuid.UUID | None = None
    due_date: date | None = None


class LinkDocIn(BaseModel):
    doc_path: str = Field(min_length=1, max_length=500)


class ResearchLogAppendIn(BaseModel):
    section: str = Field(min_length=1)
    content: str = Field(min_length=1)


class ResearchLogOut(BaseModel):
    project_id: uuid.UUID
    content: str


# ── Conversation (persisted, keyed on user+agent+project) ───────────


class SendMessageIn(BaseModel):
    query: str = Field(min_length=1)
    project_id: uuid.UUID | None = None  # None = global context


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    artifacts: list[Artifact] | None = None
    proposals: list[Proposal] | None = None
    created_at: datetime


# ── Approval queue ──────────────────────────────────────────────────


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agent_id: str
    kind: str
    summary: str
    risk: str
    status: str
    payload: dict
    result: dict | None = None
    project_id: uuid.UUID | None = None
    created_at: datetime

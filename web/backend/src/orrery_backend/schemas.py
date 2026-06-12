"""Pydantic request/response models for the backend's own API.

(The agent contract — AgentRequest/AgentResponse — is imported from
orrery_lib.schema, defined once and shared.)
"""
from __future__ import annotations

import uuid
from datetime import datetime

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
    status: str
    created_at: datetime


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

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
    function: str | None = None  # the function this project belongs to (e.g. "engr")


class ProjectUpdate(BaseModel):
    # Editable project details. The slug/folder is deliberately immutable — only
    # the human-facing label and description change. Fields left unset are
    # untouched; an empty `description` clears it.
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    archived: bool
    created_at: datetime
    kind: str = "project"  # project | function_stream
    function: str | None = None  # set for function_stream
    role: str = "member"  # the requesting user's role in this project


# ── Tasks (minimal; schema ready for the future PM agent) ───────────


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    due_date: date | None = None
    kind: str = "task"  # task | milestone | reminder
    facet: str | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    status: str
    kind: str = "task"
    facet: str | None = None
    owner_id: uuid.UUID | None = None
    due_date: date | None = None
    created_at: datetime


# ── Internal agent API (agent → backend, callback-token auth) ───────


class AgentTaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    owner_id: uuid.UUID | None = None
    due_date: date | None = None
    kind: str = "task"  # task | milestone | reminder
    facet: str | None = None


class AgentTaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    owner_id: uuid.UUID | None = None
    due_date: date | None = None
    kind: str | None = None
    facet: str | None = None


class LinkDocIn(BaseModel):
    doc_path: str = Field(min_length=1, max_length=500)


class ResearchLogAppendIn(BaseModel):
    section: str = Field(min_length=1)
    content: str = Field(min_length=1)


class ResearchLogOut(BaseModel):
    project_id: uuid.UUID
    content: str


# ── Project timeline ────────────────────────────────────────────────


class FileRenameIn(BaseModel):
    path: str
    new_name: str = Field(min_length=1, max_length=300)


class FileMoveIn(BaseModel):
    path: str
    target_dir: str = ""  # a facet folder within the container ("" = root)


class FileOpResult(BaseModel):
    status: str  # done | queued
    proposal_id: uuid.UUID | None = None


class FolderCreateIn(BaseModel):
    parent: str = ""  # folder path within the function ("" = function root)
    name: str = Field(min_length=1, max_length=120)


class TaskDocOut(BaseModel):
    id: uuid.UUID
    path: str  # FILES_ROOT-relative
    name: str
    type: str


class ContainerFile(BaseModel):
    path: str
    name: str
    type: str


class TaskDocLinkIn(BaseModel):
    path: str


class ProjectDocLinkIn(BaseModel):
    path: str  # source function-corpus file, FILES_ROOT-relative
    target_dir: str | None = None  # project folder the shortcut shows in (default: root)


class ProjectDocLinkOut(BaseModel):
    id: uuid.UUID
    path: str  # source file, FILES_ROOT-relative
    name: str
    type: str
    function: str  # registry key of the source corpus
    target_dir: str


class LinkFolderIn(BaseModel):
    folder_path: str  # project portal folder, FILES_ROOT-relative
    dest_function: str  # registry key, e.g. "engr"
    dest_dir: str  # function-corpus destination, FILES_ROOT-relative


class LinkFolderOut(BaseModel):
    id: uuid.UUID
    folder_path: str
    dest_function: str
    dest_dir: str


class SearchHit(BaseModel):
    id: uuid.UUID
    path: str
    title: str
    type: str
    snippet: str | None = None
    score: float | None = None
    mode: str  # keyword | semantic


class FunctionOut(BaseModel):
    key: str
    name: str
    folder: str
    agent: str | None  # the occupying agent's id, or null
    facets: list[str]
    stream_id: uuid.UUID  # the function_stream project row (for project-scoped routes)
    file_count: int
    reminder_count: int
    pending_count: int  # items added since last knowledge synthesis


class CompanyOut(BaseModel):
    name: str
    tagline: str


class FsTreeNode(BaseModel):
    """A node in a container's filesystem tree. Folders carry `children`
    (possibly empty); files have it as null."""

    name: str
    children: "list[FsTreeNode] | None" = None
    store_path: str | None = None  # FILES_ROOT-relative path (files only)
    # Linking (spec references): a leaf with `link_id` is a shortcut to a
    # function-corpus file (store_path is the SOURCE path); a folder with
    # `link_folder` is a portal whose drops route to `link_dest`.
    link_id: str | None = None
    link_folder: bool = False
    link_dest: str | None = None  # "function-folder" the portal routes to


class TimelineNode(BaseModel):
    id: str
    kind: str  # file | task
    name: str
    time: int  # ms epoch
    type: str  # code | style | markup | data | doc | image | other | task
    ext: str | None = None
    path: str | None = None
    size: int | None = None
    desc: str | None = None
    batch: str | None = None
    attached: bool = False
    status: str | None = None
    facet: str | None = None
    note: str | None = None
    direction: str | None = None  # email: "out" (sent) | "in" (received)
    function: str | None = None  # owning function key — set on the company union timeline


class TimelineNoteIn(BaseModel):
    node_id: str  # task:<id> | doc:<id> | file:<path>
    note: str | None = None


class TimelineDateIn(BaseModel):
    node_id: str  # task:<id> (due_date) | doc:<id> (occurred_at)
    date: str  # YYYY-MM-DD (placed at noon UTC)


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


class HomeOut(BaseModel):
    """Company Home read model — one round trip for the whole-company view."""

    company: CompanyOut
    functions: list[FunctionOut]
    timeline: list[TimelineNode]  # union, most-recent-first
    approvals: list[ProposalOut]  # all pending for the user


# ── Credential-account vault (per-user "Account Logins") ─────────────
# Metadata only — never passwords (those live in Bitwarden).


class VaultLoginIn(BaseModel):
    svc: str = Field(min_length=1, max_length=200)  # service name (required)
    user: str = Field(default="", max_length=320)   # account / email
    cat: str = Field(default="", max_length=50)      # category
    url: str = Field(default="", max_length=1000)
    desc: str = ""                                    # description
    note: str = ""
    mfa: bool = False


class VaultLoginOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    svc: str
    user: str
    cat: str
    url: str
    desc: str
    note: str
    mfa: bool
    created_at: datetime

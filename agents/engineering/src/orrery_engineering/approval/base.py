"""ApprovalSurface protocol + the value types it exchanges.

Two operations:
  - post_draft(ticket_id, draft) → DraftHandle
      Show the draft somewhere a human can react to it. Returns an
      opaque handle the surface uses internally to track the post.
  - await_decision(handle, timeout_s) → Decision
      Block until the human reacts (APPROVED / REJECTED) or the
      timeout elapses (TIMEOUT).

Plus one fire-and-forget operation:
  - post_notification(ticket_id, msg)
      For escalations: tell the human a ticket needs personal
      attention. No reaction expected, no awaiting.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol


class Decision(Enum):
    APPROVED = "approved"
    REJECTED = "rejected"
    TIMEOUT = "timeout"


@dataclass
class DraftHandle:
    """Opaque per-post identifier the surface uses to poll for status.

    `extra` is whatever the implementation needs (e.g. channel id +
    message ts for Slack). The handle is returned by post_draft and
    passed back into await_decision verbatim.
    """
    surface: str
    id: str
    extra: dict = field(default_factory=dict)


class ApprovalSurface(Protocol):
    async def post_draft(
        self, ticket_id: str, draft: str
    ) -> DraftHandle: ...

    async def await_decision(
        self, handle: DraftHandle, timeout_s: int = 1800
    ) -> Decision: ...

    async def post_notification(
        self, ticket_id: str, message: str
    ) -> None: ...

    async def post_review(
        self, subject: str, body: str
    ) -> DraftHandle: ...
        # Like post_draft, but FEEDBACK semantics rather than a
        # send-gate: the artifact already exists (e.g. an engineering
        # draft already created in Drive). Seed 👍/👎 and return a
        # handle await_decision can poll — the verdict is logged as
        # good/bad feedback, no downstream "send" fires.

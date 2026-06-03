"""End-to-end ticket driver: read → draft → approve → maybe send.

This is the ONLY place that ties the read-only reasoning loop to the
write-capable ReplyDispatcher. The agent doesn't import this file.

Flow:
  1. Run the agent's reasoning loop via draft_reply() (read-only).
  2. If the output starts with "ESCALATE:", post a notification on
     the approval surface and exit — no send, no decision flow.
  3. Otherwise, post the draft, wait for the human's 👍 / 👎 / timeout.
  4. On APPROVED: invoke ReplyDispatcher.send() (the separate write
     module). Log "sent".
  5. On REJECTED or TIMEOUT: log only. The agent doesn't auto-correct
     yet — the human handles it directly.
"""
from __future__ import annotations

import sys

from . import actions
from .agent import draft_reply
from .approval import Decision, build_approval_surface
from .send import ReplyDispatcher


async def handle_ticket(ticket_id: str, timeout_s: int = 1800) -> dict:
    """Drive one ticket through the full pipeline. Returns a small
    summary dict for the caller / CLI to print."""

    # 1. Read + reason + draft (read-only).
    draft = await draft_reply(ticket_id)
    actions.log("drafted", ticket_id, draft=draft)

    # 2. Escalation short-circuit. Don't post a draft for approval —
    # nothing to approve. Just notify the human.
    if draft.startswith("ESCALATE:"):
        reason = draft[len("ESCALATE:"):].strip()
        surface = build_approval_surface()
        await surface.post_notification(ticket_id, draft)
        actions.log("escalated", ticket_id, reason=reason)
        return {
            "action": "escalated",
            "ticket_id": ticket_id,
            "reason": reason,
        }

    # 3. Post draft for approval.
    surface = build_approval_surface()
    surface_name = type(surface).__name__
    handle = await surface.post_draft(ticket_id, draft)
    # Surface the wait state to stderr so the user knows the agent
    # didn't just hang. SlackApprovalSurface polling is otherwise
    # completely silent.
    print(
        f"[handle] draft posted via {surface_name}; "
        f"waiting up to {timeout_s}s for human approval...",
        file=sys.stderr,
        flush=True,
    )
    decision = await surface.await_decision(handle, timeout_s=timeout_s)
    print(
        f"[handle] decision: {decision.value}",
        file=sys.stderr,
        flush=True,
    )

    # 4. On approval, fire the dispatcher. This is the ONLY place
    # ReplyDispatcher is imported / called.
    if decision == Decision.APPROVED:
        dispatcher = ReplyDispatcher()
        path = dispatcher.send(ticket_id, draft)
        actions.log(
            "approved", ticket_id, draft=draft, sent_to=str(path)
        )
        actions.log("sent", ticket_id, path=str(path))
        return {
            "action": "sent",
            "ticket_id": ticket_id,
            "path": str(path),
        }

    # 5. Rejection / timeout — log, don't send.
    label = decision.value  # "rejected" | "timeout"
    actions.log(label, ticket_id, draft=draft)
    return {
        "action": label,
        "ticket_id": ticket_id,
    }

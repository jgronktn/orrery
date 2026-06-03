"""Console approval surface — for development without Slack.

Prints the draft to stdout, reads y/n from stdin. Same Decision
contract as Slack, just no real human-network round-trip.

Used as the fallback when SLACK_BOT_TOKEN isn't set. Also handy in
tests and CI runs where you don't want to hit a real Slack workspace.
"""
from __future__ import annotations

import asyncio
import sys

from .base import ApprovalSurface, Decision, DraftHandle


class ConsoleApprovalSurface:
    """Stdin/stdout fallback. Blocks on `input()` for the decision."""

    async def post_draft(
        self, ticket_id: str, draft: str
    ) -> DraftHandle:
        bar = "─" * 72
        sys.stdout.write(
            f"\n{bar}\n"
            f"DRAFT for ticket {ticket_id}:\n"
            f"{bar}\n"
            f"{draft}\n"
            f"{bar}\n"
        )
        sys.stdout.flush()
        return DraftHandle(surface="console", id=ticket_id)

    async def await_decision(
        self, handle: DraftHandle, timeout_s: int = 1800
    ) -> Decision:
        # input() blocks the event loop; offload it. timeout_s is
        # ignored here — console is interactive, you decide when.
        loop = asyncio.get_event_loop()
        try:
            ans = await loop.run_in_executor(
                None, input, "Approve and send? [y/n]: "
            )
        except EOFError:
            return Decision.TIMEOUT
        ans = ans.strip().lower()
        if ans in ("y", "yes"):
            return Decision.APPROVED
        if ans in ("n", "no"):
            return Decision.REJECTED
        return Decision.TIMEOUT

    async def post_notification(
        self, ticket_id: str, message: str
    ) -> None:
        bar = "─" * 72
        sys.stdout.write(
            f"\n{bar}\n"
            f"NOTIFICATION for ticket {ticket_id}:\n"
            f"{bar}\n"
            f"{message}\n"
            f"{bar}\n"
        )
        sys.stdout.flush()

    async def post_review(
        self, subject: str, body: str
    ) -> DraftHandle:
        bar = "─" * 72
        sys.stdout.write(
            f"\n{bar}\n"
            f"FOR REVIEW — {subject}:\n"
            f"{bar}\n"
            f"{body}\n"
            f"{bar}\n"
        )
        sys.stdout.flush()
        return DraftHandle(surface="console", id=subject)

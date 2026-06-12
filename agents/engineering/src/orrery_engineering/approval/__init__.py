"""Approval surfaces — swappable interfaces between draft and send.

The agent's reasoning loop produces a draft. An ApprovalSurface
implementation posts that draft somewhere a human can see it and
returns the human's verdict. On APPROVED, the driver fires the
ReplyDispatcher (which lives in `send.py`, intentionally outside this
package).

Phase 0 implementations:
  - SlackApprovalSurface  — posts to a channel, seeds 👍/👎 reactions,
                            polls reactions.get every ~5s, returns on
                            the first non-bot 👍 or 👎.
  - ConsoleApprovalSurface — prints to stdout, reads y/n from stdin.
                             Used when SLACK_BOT_TOKEN isn't set.

Add new ones (PagerDuty, custom dashboard, etc.) by implementing the
ApprovalSurface protocol in `base.py`. No other code changes.
"""
from .base import ApprovalSurface, Decision, DraftHandle
from .console import ConsoleApprovalSurface
from .slack import SlackApprovalSurface
from .factory import build_approval_surface

__all__ = [
    "ApprovalSurface",
    "Decision",
    "DraftHandle",
    "ConsoleApprovalSurface",
    "SlackApprovalSurface",
    "build_approval_surface",
]

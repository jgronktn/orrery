"""Choose an ApprovalSurface based on env vars.

Order:
  1. ORRERY_APPROVAL_SURFACE explicitly set → use that.
  2. SLACK_BOT_TOKEN + SLACK_APPROVAL_CHANNEL both set → SlackApprovalSurface.
  3. Otherwise → ConsoleApprovalSurface.

This makes the surface a config concern, not a code change. The same
container image runs against Slack in prod and console in tests.
"""
from __future__ import annotations

import os

from .base import ApprovalSurface
from .console import ConsoleApprovalSurface
from .slack import SlackApprovalSurface


def build_approval_surface() -> ApprovalSurface:
    forced = os.environ.get("ORRERY_APPROVAL_SURFACE", "").strip().lower()
    if forced == "console":
        return ConsoleApprovalSurface()
    if forced == "slack":
        return _slack_or_raise()
    if forced and forced not in ("", "auto"):
        raise ValueError(
            f"ORRERY_APPROVAL_SURFACE={forced!r}: expected 'slack', 'console', or unset"
        )

    # auto: prefer Slack when configured; fall back to console.
    token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    channel = os.environ.get("SLACK_APPROVAL_CHANNEL", "").strip()
    if token.startswith("xoxb-") and channel.startswith("C"):
        return SlackApprovalSurface(token=token, channel=channel)
    return ConsoleApprovalSurface()


def _slack_or_raise() -> ApprovalSurface:
    token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    channel = os.environ.get("SLACK_APPROVAL_CHANNEL", "").strip()
    if not token or not channel:
        raise RuntimeError(
            "ORRERY_APPROVAL_SURFACE=slack but SLACK_BOT_TOKEN or "
            "SLACK_APPROVAL_CHANNEL is missing from .env"
        )
    return SlackApprovalSurface(token=token, channel=channel)

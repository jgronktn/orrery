"""Slack notifications for the approval queue (a seam).

When a proposal queues for approval, post a heads-up to the configured
channel. Approvals themselves happen in the UI (not via Slack reactions),
so this is notify-only. If the token/channel aren't set, log instead.
"""
from __future__ import annotations

import logging

import httpx

from .config import settings

log = logging.getLogger("orrery.slack")

_RISK_EMOJI = {"low": "🟢", "medium": "🟡", "high": "🔴"}


def notify_approval(summary: str, risk: str) -> None:
    emoji = _RISK_EMOJI.get(risk, "🔔")
    text = f"{emoji} *Approval needed* ({risk} risk)\n{summary}"
    token = settings.slack_bot_token.strip()
    channel = settings.slack_approval_channel.strip()
    if not (token.startswith("xoxb-") and channel):
        log.warning("[slack:dev] %s", text)
        return
    try:
        httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}"},
            json={"channel": channel, "text": text},
            timeout=10.0,
        )
    except Exception as exc:  # never let a notification failure break the flow
        log.error("slack notify failed: %s", exc)

"""Slack approval surface — reaction-polling implementation.

Flow:
  1. post_draft posts the draft to the channel and seeds 👍 + 👎 as
     starter reactions (so it's one click for the reviewer).
  2. await_decision polls reactions.get every `poll_interval_s` and
     returns APPROVED on the first NON-BOT 👍, REJECTED on the first
     NON-BOT 👎. Times out after timeout_s.
  3. post_notification posts plain text without seeding reactions —
     used for escalations where no decision is being asked for.

No inbound webhook. No signing-secret verification. No URL the
internet needs to reach. This works behind any NAT during local dev.
We can graduate to interactive buttons + Events API in a later phase
when the agent has a stable public URL.

Required bot token scopes (configure in Slack app manifest):
  - chat:write          — post messages
  - reactions:write     — seed 👍 / 👎
  - reactions:read      — poll for the human's reaction

The bot must be IN the target channel. Invite it once via
`/invite @<bot-name>` in the Slack channel.
"""
from __future__ import annotations

import asyncio
import os

import httpx

from .base import ApprovalSurface, Decision, DraftHandle

SLACK_API = "https://slack.com/api"

# Slack uses the unicode-named emoji shortcode. Both ":+1:" and
# ":thumbsup:" map to the same 👍, but the reactions API returns the
# canonical name. Check for both.
APPROVE_NAMES = {"thumbsup", "+1"}
REJECT_NAMES = {"thumbsdown", "-1"}


class SlackApprovalSurface:
    def __init__(
        self,
        token: str,
        channel: str,
        poll_interval_s: float = 5.0,
    ):
        if not token or not token.startswith("xoxb-"):
            raise ValueError(
                "SlackApprovalSurface needs a bot token starting with 'xoxb-'"
            )
        if not channel:
            raise ValueError(
                "SlackApprovalSurface needs a channel id (C0... form)"
            )
        self._token = token
        self._channel = channel
        self._poll_interval = poll_interval_s
        self._bot_user_id: str | None = None

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            timeout=15.0,
        )

    # ── Slack API helpers ─────────────────────────────────────────

    async def _post(self, c: httpx.AsyncClient, method: str, payload: dict) -> dict:
        r = await c.post(f"{SLACK_API}/{method}", json=payload)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(
                f"slack {method} failed: {data.get('error', data)}"
            )
        return data

    async def _get(self, c: httpx.AsyncClient, method: str, params: dict) -> dict:
        r = await c.get(f"{SLACK_API}/{method}", params=params)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(
                f"slack {method} failed: {data.get('error', data)}"
            )
        return data

    async def _bot_user(self, c: httpx.AsyncClient) -> str:
        """Fetch the bot's own user id (cached) so we can ignore its
        own reactions when polling."""
        if self._bot_user_id is None:
            data = await self._post(c, "auth.test", {})
            self._bot_user_id = str(data["user_id"])
        return self._bot_user_id

    # ── Surface protocol ──────────────────────────────────────────

    async def post_draft(
        self, ticket_id: str, draft: str
    ) -> DraftHandle:
        text = (
            f"*Draft reply — ticket `{ticket_id}`*\n\n"
            f"{draft}\n\n"
            f"_React 👍 to approve and send, 👎 to reject._"
        )
        async with self._client() as c:
            await self._bot_user(c)  # pre-fetch + cache
            posted = await self._post(
                c, "chat.postMessage", {"channel": self._channel, "text": text}
            )
            ts = posted["ts"]
            # Seed starter reactions. Treat individual failures as
            # non-fatal — sometimes one of these races and Slack says
            # "already_reacted" if the bot already added it on a
            # previous (timed-out) post.
            for emoji in ("thumbsup", "thumbsdown"):
                try:
                    await self._post(
                        c,
                        "reactions.add",
                        {
                            "channel": self._channel,
                            "timestamp": ts,
                            "name": emoji,
                        },
                    )
                except RuntimeError:
                    pass
        return DraftHandle(
            surface="slack",
            id=ts,
            extra={"channel": self._channel},
        )

    async def await_decision(
        self, handle: DraftHandle, timeout_s: int = 1800
    ) -> Decision:
        channel = handle.extra.get("channel", self._channel)
        deadline_after = float(timeout_s)
        elapsed = 0.0
        async with self._client() as c:
            bot_id = await self._bot_user(c)
            while elapsed < deadline_after:
                data = await self._get(
                    c,
                    "reactions.get",
                    {"channel": channel, "timestamp": handle.id},
                )
                reactions = data.get("message", {}).get("reactions", [])
                for r in reactions:
                    name = r.get("name", "")
                    user_ids = [u for u in r.get("users", []) if u != bot_id]
                    if not user_ids:
                        continue
                    if name in APPROVE_NAMES:
                        return Decision.APPROVED
                    if name in REJECT_NAMES:
                        return Decision.REJECTED
                await asyncio.sleep(self._poll_interval)
                elapsed += self._poll_interval
        return Decision.TIMEOUT

    async def post_notification(
        self, ticket_id: str, message: str
    ) -> None:
        text = f"⚠️ *Escalation — ticket `{ticket_id}`*\n\n{message}"
        async with self._client() as c:
            await self._post(
                c, "chat.postMessage", {"channel": self._channel, "text": text}
            )

    async def post_review(
        self, subject: str, body: str
    ) -> DraftHandle:
        """Post an artifact for FEEDBACK (not a send-gate). Seeds 👍/👎
        so the reviewer reacts in one click; await_decision polls the
        same way as post_draft. Phase 0: the verdict is logged as
        good/bad feedback — the draft already lives in Drive."""
        text = (
            f"*Engineering draft ready for review — {subject}*\n\n"
            f"{body}\n\n"
            f"_React 👍 if this draft is useful, 👎 if it's off. "
            f"Feedback only — the draft is already in Drive for you to edit._"
        )
        async with self._client() as c:
            await self._bot_user(c)
            posted = await self._post(
                c, "chat.postMessage", {"channel": self._channel, "text": text}
            )
            ts = posted["ts"]
            for emoji in ("thumbsup", "thumbsdown"):
                try:
                    await self._post(
                        c,
                        "reactions.add",
                        {"channel": self._channel, "timestamp": ts, "name": emoji},
                    )
                except RuntimeError:
                    pass
        return DraftHandle(surface="slack", id=ts, extra={"channel": self._channel})

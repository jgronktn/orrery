"""ReplyDispatcher — the ONLY module that can send.

INVARIANT (Phase 0/1):
  This module is intentionally not under tools/ and is NEVER imported
  by `agent.py`. The agent's reasoning loop has no path to invoke
  ReplyDispatcher.send(). The top-level handle() driver imports it
  separately, AFTER human approval is captured. Any future refactor
  that lands a `send_*` tool on the Agent breaks the governance
  guarantee and must be rejected at review.

Phase 0 stub: writes 'sent' replies to /app/sent_replies/ as JSON
files. The host's ./sent_replies/ directory is mounted writable so
they persist. When we have a real ticket system (Zendesk / Intercom /
etc.), this stub gets a sibling adapter class behind the same
.send(ticket_id, reply_text) interface — no caller changes.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_SENT_DIR = Path(os.environ.get("ORRERY_SENT_DIR", "/app/sent_replies"))


def _utc_stamp() -> str:
    """Filesystem-safe UTC timestamp (colons → dashes)."""
    return (
        datetime.now(timezone.utc)
        .strftime("%Y-%m-%dT%H-%M-%S")
    )


def _safe_id(ticket_id: str) -> str:
    """Strip anything that wouldn't make a good filename component."""
    return re.sub(r"[^A-Za-z0-9_-]+", "_", ticket_id)


class ReplyDispatcher:
    """Phase 0 stub. One method: send(). Writes to sent_replies/."""

    def __init__(self, root: Path = DEFAULT_SENT_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def send(self, ticket_id: str, reply_text: str) -> Path:
        """Persist the approved reply. Returns the written file path.

        Real ticket-system adapters land here in a later phase. The
        contract — `send(id, text) -> external_id_or_path` — stays
        the same so callers don't change.
        """
        stamp = _utc_stamp()
        path = self.root / f"{_safe_id(ticket_id)}-{stamp}.json"
        path.write_text(
            json.dumps(
                {
                    "ticket_id": ticket_id,
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                    "reply": reply_text,
                    "channel": "phase0-stub",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return path

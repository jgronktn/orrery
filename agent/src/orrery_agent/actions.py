"""Append-only audit log of agent actions.

Every draft, approval, rejection, timeout, and escalation gets one
line in actions.jsonl. The brief says "👎 = correction signal, logged"
— this is the logged part. Later phases can mine the log for
retraining signals or pattern analysis; for now it's a paper trail.

Format: JSON-Lines. One object per line, schema is intentionally
loose so future actions can add fields without a migration.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_LOG_PATH = Path(os.environ.get("ORRERY_ACTIONS_LOG", "/app/logs/actions.jsonl"))


def log(action: str, ticket_id: str, **fields: Any) -> None:
    """Append one event to the log.

    `action` is the verb: drafted | escalated | approved | rejected
    | timeout | sent. `ticket_id` is always present. `fields` can
    carry whatever's useful (draft text, sent_path, error, etc.).
    """
    path = Path(os.environ.get("ORRERY_ACTIONS_LOG", str(DEFAULT_LOG_PATH)))
    path.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "ticket_id": ticket_id,
        **fields,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")

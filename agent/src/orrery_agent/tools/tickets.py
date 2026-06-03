"""TicketSource — read-only interface to whatever ticket system we use.

The agent talks to this Protocol; concrete implementations swap in.
Phase 0 ships `JsonFileTicketSource`, which reads from a directory of
JSON files. Real adapters (Zendesk, Intercom, Freshdesk, custom) land
in this file later, all implementing the same `.get(ticket_id)`
contract — no other agent code needs to change.

Read-only by design. There is no `update`, `reply`, `close`, or
`assign` method on this interface; the agent simply cannot mutate the
ticket system through here. Outbound replies fire from a separate
write-capable module after human approval.
"""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class Ticket:
    id: str
    subject: str
    from_address: str
    received_at: str
    body: str


class TicketSource(Protocol):
    async def get(self, ticket_id: str) -> Ticket: ...


class JsonFileTicketSource:
    """Read tickets from JSON files in a directory.

    One file per ticket, named `<ticket_id>.json`. Shape:
        {
          "id": "t001",
          "subject": "...",
          "from": "name@example.com",
          "received_at": "2026-05-28T09:14:00Z",
          "body": "..."
        }
    """

    def __init__(self, root: Path):
        self.root = root

    async def get(self, ticket_id: str) -> Ticket:
        path = self.root / f"{ticket_id}.json"
        if not path.exists():
            raise FileNotFoundError(
                f"Ticket not found: {ticket_id} (looked in {self.root})"
            )
        data = json.loads(path.read_text(encoding="utf-8"))
        return Ticket(
            id=data["id"],
            subject=data["subject"],
            from_address=data.get("from", ""),
            received_at=data.get("received_at", ""),
            body=data["body"],
        )

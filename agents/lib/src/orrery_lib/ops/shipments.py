"""Shipping-domain tools for the OPS agent — READ-ONLY.

Shipments are created and edited by humans in the UI; the agent only looks
them up, via the backend's /internal/agent/ops/shipments route (the agent has
no database access). Each record lists its attached documents' store paths so
the agent can read_file a packing slip or receipt.
"""
from __future__ import annotations

from pydantic_ai import RunContext

from ..pm import NO_PROJECT, _client, _err


def register(agent) -> None:
    """Add the shipping lookup tool to an agent."""

    @agent.tool
    async def list_shipments(
        ctx: RunContext,
        direction: str | None = None,
        text: str | None = None,
        since: str | None = None,
        until: str | None = None,
    ) -> list[dict] | str:
        """Look up the company's shipment log — packages shipped OUT
        (direction='outbound') and received IN (direction='inbound'). Newest
        first. Filters (all optional): `direction`; `text` matches
        counterparty, contents, carrier, tracking number, PO ref, and notes;
        `since` / `until` bound the ship date (ISO YYYY-MM-DD). Each record has
        dates, carrier, tracking_number, tracking_url (the carrier's page —
        you have NO live status), counterparty, contents, po_ref, status,
        notes, linked project, and `documents` (store paths of its packing
        slips / receipts — read them with read_file). Read-only: you cannot
        create or edit shipments; users do that in the Operations view."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        params = {
            k: v
            for k, v in {
                "direction": direction, "q": text, "since": since, "until": until,
            }.items()
            if v
        }
        try:
            rows = await be.get("/internal/agent/ops/shipments", params)
        except Exception as exc:
            return _err(exc)
        if not rows:
            return "No shipments match."
        return [
            {
                k: r.get(k)
                for k in (
                    "direction", "status", "shipped_on", "received_on", "carrier",
                    "tracking_number", "tracking_url", "counterparty", "contents",
                    "po_ref", "notes", "project_name",
                )
            }
            | {"documents": [d["path"] for d in r.get("documents", [])]}
            for r in rows
        ]

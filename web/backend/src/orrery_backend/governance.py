"""Risk classification + proposal execution.

The agent suggests a risk tag; the backend decides the FINAL routing and
may override it (CLAUDE.md: risk classification is honest — an
external-fetch-and-write is never low, whatever the agent claims).

Routing: low auto-executes; medium/high queue for human approval.
Execution delegates to the agent's bounded write path (`POST /execute`);
the backend is the only caller, only after routing.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session as DbSession

from .models import ProposalRecord

_ORDER = {"low": 0, "medium": 1, "high": 2}

# Minimum honest risk per action kind, overriding a too-low agent claim.
_RISK_FLOOR = {
    # Downloads from an arbitrary URL + writes to Drive — never "low".
    "save_spec": "medium",
    # Creating a new corporate draft document — a bounded write; queue it.
    "save_draft": "medium",
}


def classify(kind: str, agent_risk: str) -> str:
    risk = agent_risk if agent_risk in _ORDER else "medium"
    floor = _RISK_FLOOR.get(kind)
    if floor and _ORDER[risk] < _ORDER[floor]:
        return floor
    return risk


async def execute_proposal(
    db: DbSession, proposal: ProposalRecord, agent_url: str
) -> None:
    """Run an approved/auto proposal via the agent's /execute path and
    record the outcome on the row. Caller commits."""
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{agent_url}/execute",
                json={"kind": proposal.kind, "payload": proposal.payload},
            )
            resp.raise_for_status()
            data = resp.json()
        proposal.status = "executed"
        proposal.result = data.get("result")
        proposal.error = None
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        try:
            detail = exc.response.json().get("detail", detail)
        except Exception:
            pass
        proposal.status = "failed"
        proposal.error = detail
    except Exception as exc:
        proposal.status = "failed"
        proposal.error = str(exc)
    proposal.decided_at = datetime.now(timezone.utc)

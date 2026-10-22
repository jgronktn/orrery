"""Operations (ops) agent — OPS, the home of general operational functions.

Its first domain is SHIPPING: shipments in and out (what shipped when, carrier,
tracking, counterparty, attached receipts and packing slips). Humans log
shipments through the UI form; the agent READS the log and the attached
documents and answers questions about them. Later domains (inventory,
purchasing, …) are added beside shipping as per-domain tool modules, not by
reworking this agent.

Capabilities this phase: read/search the ops corpus (plus the current
container's files), ops-scoped semantic search, provisional KB notes, and
DRAFTING ops documents into ops/drafts/ via the propose→approve flow. It never
writes directly.

Shared, agent-agnostic infrastructure lives in `orrery_lib`. This package holds
only OPS's wiring: its deps, tools, behavior, and HTTP service.
"""

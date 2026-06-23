"""Executive-assistant (corporate) agent — the cross-function "superagent".

Its home function is Corporate, but its distinguishing capability is REACH: it
reads across the whole document store (every function folder + all projects)
and the shared knowledge base, where each function agent sees only its own
scope. It answers at the company core (the global, no-project context) and as
the Corporate function's agent.

Capabilities this phase: read/search anything, cross-function semantic search,
provisional KB notes, and DRAFTING corporate documents into corporate/drafts/
via the propose→approve flow (the agent proposes; a human approves; a separate
bounded write path creates the new file). It never writes directly.

Shared, agent-agnostic infrastructure lives in `orrery_lib` (gateway client, KB
wrapper, file-store reader, PM/research-log tools, the agent response schema).
This package holds only the EA's wiring: its deps, tools, behavior, and HTTP
service.
"""

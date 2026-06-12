"""Orrery web backend.

FastAPI app that mediates everything (CLAUDE.md invariant): the UI never
talks to agents directly and agents never talk to each other; the backend
authenticates, permission-checks, routes to agent HTTP services, and
enforces governance.

This phase: email/password auth (Argon2 + server-side sessions), an agent
registry, and a route that proxies a query to the engineering agent.
Projects, the approval queue, and email integration are later steps.
"""

__version__ = "0.1.0"

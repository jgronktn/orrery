"""Shared utilities for Orrery agents.

Holds the pieces more than one agent needs, so each agent imports them
instead of re-implementing:

  - `gateway`  — build a PydanticAI model pointed at the LiteLLM gateway.
  - `kb`       — the Qdrant + fastembed knowledge-base wrapper (with the
                 embedding-model pin).
  - `drive`    — Google service-account Drive helpers (auth, service
                 builder, document-to-text conversion, scopes).
  - `NotConfiguredError` — a credentialed seam was used before its
    credential/dependency was supplied.

Later (backend phase): the agent response schema (text + artifacts +
proposals) and the proposal/risk types live here too, imported by both
the agents and the web backend.
"""

__version__ = "0.1.0"


class NotConfiguredError(RuntimeError):
    """A credentialed seam (Drive, Exa, …) was used before its credential
    or dependency was supplied. Carries a human-actionable message."""

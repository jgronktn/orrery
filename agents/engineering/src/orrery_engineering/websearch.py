"""Web search — the agent's ONE outbound capability.

INVARIANT (CLAUDE.md): web search is the only egress beyond the
gateway, and it is restricted to a single provider's endpoint. No
general browsing, no arbitrary URL fetch. This module is the only place
that talks to the outside world, and every request goes to EXA_ENDPOINT.

Provider: Exa. The agent calls `search()`; results always carry their
source URL so the agent can cite them with the mandatory "verify before
relying on this" note. Until EXA_API_KEY is present, `search()` raises
NotConfiguredError — it never fabricates results.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import httpx

from orrery_lib import NotConfiguredError

EXA_API_KEY = os.environ.get("EXA_API_KEY", "").strip()

# Exa's API host — the single endpoint egress is restricted to.
EXA_ENDPOINT = "https://api.exa.ai"

# Cap how much page text we pull back per result — enough for the agent
# to judge relevance and quote, not a full scrape.
_SNIPPET_CHARS = 800

_SETUP_HINT = (
    "Web search is not configured yet. Get an API key from https://exa.ai "
    "and set EXA_API_KEY in .env (it reaches only the agent container)."
)


@dataclass
class WebResult:
    """One web-search hit. `url` is mandatory — the agent must cite it."""

    title: str
    url: str
    snippet: str
    published: str = ""


def is_configured() -> bool:
    return bool(EXA_API_KEY)


def search(query: str, k: int = 5) -> list[WebResult]:
    """Run one web search through Exa, returning up to k results with
    source URLs. Raises NotConfiguredError until the key is supplied."""
    if not is_configured():
        raise NotConfiguredError(_SETUP_HINT)

    resp = httpx.post(
        f"{EXA_ENDPOINT}/search",
        headers={"x-api-key": EXA_API_KEY, "Content-Type": "application/json"},
        json={
            "query": query,
            "numResults": max(1, min(k, 10)),
            "type": "auto",
            "contents": {"text": {"maxCharacters": _SNIPPET_CHARS}},
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    results: list[WebResult] = []
    for r in data.get("results", []):
        text = (r.get("text") or "").strip().replace("\n", " ")
        results.append(
            WebResult(
                title=r.get("title") or r.get("url", ""),
                url=r.get("url", ""),
                snippet=text[:_SNIPPET_CHARS],
                published=r.get("publishedDate", "") or "",
            )
        )
    return results

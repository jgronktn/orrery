"""The single Orrery agent — PydanticAI wired to the LiteLLM gateway.

Architecture:
  - Model:    LiteLLM proxy speaking OpenAI shape, mapped to Claude
              Sonnet 4.6 by default. Provider swappable via env vars.
  - Tools:    read_ticket (read-only). search_kb / read_docs land in
              Step 3.
  - Behavior: loaded from config/support/agent.md at construction.

Invariants enforced here (must hold in every future change):
  1. No tool registered against this Agent may mutate external state.
  2. The behavior config is loaded once at startup; the agent has no
     code path that edits it.
  3. The agent has no `send` method, no email/Slack client, no
     ticket-system credentials. Approved drafts fire from a separate
     write-capable module the agent's reasoning loop can't reach.
"""
import os
from dataclasses import dataclass
from pathlib import Path

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

from .config import load_instructions
from .tools import kb
from .tools.tickets import JsonFileTicketSource, Ticket, TicketSource

# Defaults assume the in-cluster compose network (`gateway` is the
# service name). Override with env vars for local-host testing.
GATEWAY_URL = os.environ.get("ORRERY_GATEWAY_URL", "http://gateway:4000/v1")
MODEL_NAME = os.environ.get("ORRERY_MODEL", "claude-sonnet")
TICKETS_DIR = Path(
    os.environ.get("ORRERY_TICKETS_DIR", "/app/docs/sample_tickets")
)


@dataclass
class SupportDeps:
    tickets: TicketSource


def build_agent() -> Agent[SupportDeps, str]:
    """Construct the agent. Side effects: reads agent.md from disk."""
    model = OpenAIModel(
        MODEL_NAME,
        provider=OpenAIProvider(
            base_url=GATEWAY_URL,
            # LiteLLM is unauthenticated in Phase 0 dev. The OpenAI
            # client requires a non-empty string here regardless.
            api_key="orrery-no-auth",
        ),
    )
    agent = Agent[SupportDeps, str](
        model,
        instructions=load_instructions(),
        deps_type=SupportDeps,
    )

    @agent.tool
    async def read_ticket(
        ctx: RunContext[SupportDeps], ticket_id: str
    ) -> dict:
        """Fetch a support ticket by id.

        Returns the ticket's subject, sender, received timestamp, and
        body. Strictly read-only — there is no way to modify the
        ticket through this tool.
        """
        t = await ctx.deps.tickets.get(ticket_id)
        return {
            "id": t.id,
            "subject": t.subject,
            "from": t.from_address,
            "received_at": t.received_at,
            "body": t.body,
        }

    @agent.tool
    async def search_docs(
        ctx: RunContext[SupportDeps], query: str, k: int = 5
    ) -> list[dict]:
        """Search curated product and firmware docs by semantic
        similarity. Use BEFORE drafting whenever the ticket touches a
        specific feature, firmware version, network setup detail, or
        any topic that's likely documented. Returns up to k hits with
        the passage text, source filename, and a relevance score
        between 0 and 1. Empty list means no relevant docs found —
        proceed from general knowledge but note the gap.

        Read-only. Cannot modify docs.
        """
        hits = kb.search(kb.DOCS_COLLECTION, query, k=k)
        return [
            {
                "text": h.text,
                "source": h.source,
                "relevance": round(h.score, 3),
            }
            for h in hits
        ]

    @agent.tool
    async def search_kb(
        ctx: RunContext[SupportDeps], query: str, k: int = 5
    ) -> list[dict]:
        """Search the agent's accumulated knowledge base — patterns
        noticed across prior tickets and saved as provisional notes.
        Lower-confidence than search_docs by definition: each hit
        carries a `status` field ('provisional' = unreviewed, agent-
        generated; 'curated' = human-blessed). Use this AFTER
        search_docs when official docs don't cover the issue. Weight
        provisional hits carefully.

        Read-only.
        """
        hits = kb.search(kb.LEARNINGS_COLLECTION, query, k=k)
        return [
            {
                "text": h.text,
                "source": h.source,
                "status": h.status,
                "relevance": round(h.score, 3),
            }
            for h in hits
        ]

    @agent.tool
    async def add_kb(
        ctx: RunContext[SupportDeps], text: str, source: str
    ) -> str:
        """Save a useful pattern, fact, or troubleshooting recipe to
        the knowledge base as a PROVISIONAL note. A human reviews
        these and either promotes them to 'curated' or deletes them.

        Use this AFTER drafting when you've noticed a non-obvious
        pattern that would help future drafts — e.g. "Eero routers
        with Band Steering on cause sensors to fail Wi-Fi join after
        ~30s timeout". Don't save trivia or one-off restatements of
        what's already in the docs.

        text   — the pattern as a self-contained sentence or two
        source — where you noticed it (e.g. "ticket t002, Eero 6")

        Returns the saved point id. Always provisional — you cannot
        write curated facts directly.
        """
        point_id = kb.add(
            kb.LEARNINGS_COLLECTION,
            text=text,
            source=source,
            status="provisional",
        )
        return f"saved as {point_id} (provisional)"

    return agent


async def draft_reply(ticket_id: str) -> str:
    """Driver: point the agent at one ticket, return its output verbatim.

    The agent decides whether to draft a reply or escalate, per the
    rules in config/support/agent.md.
    """
    deps = SupportDeps(tickets=JsonFileTicketSource(TICKETS_DIR))
    agent = build_agent()
    prompt = (
        f"A new support ticket has arrived (id: {ticket_id}). "
        f"Read the ticket with the read_ticket tool, then either "
        f"draft a complete reply or output 'ESCALATE: <reason>' per "
        f"your behavior config. Do not include any commentary outside "
        f"the reply itself."
    )
    result = await agent.run(prompt, deps=deps)
    return result.output

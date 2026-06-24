"""Run the executive-assistant agent once and return the structured contract.

The HTTP-service entry into the same reasoning loop. The agent stays STATELESS:
prior turns arrive in the request (conversation_history); conversation state
lives in the backend.

The EA reads across the WHOLE store (the global reader) regardless of which
container the conversation is in — that's its defining cross-function reach. Any
draft it wants saved surfaces as a `save_draft` Proposal for the backend to
route through approval; the agent performs no write itself.
"""
from __future__ import annotations

from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

import logfire

from orrery_lib import filestore
from orrery_lib.filestore import build_global_reader
from orrery_lib.pm import BackendClient
from orrery_lib.schema import (
    AgentRequest,
    AgentResponse,
    ConversationTurn,
    Proposal,
    Risk,
)

from .agent import CorporateDeps, _join_text, build_agent

DRAFTS_DIR = "corporate/drafts"


def _to_message_history(turns: list[ConversationTurn]):
    history = []
    for turn in turns:
        if turn.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=turn.content)]))
        else:
            history.append(ModelResponse(parts=[TextPart(content=turn.content)]))
    return history


async def run_once(req: AgentRequest) -> AgentResponse:
    """Answer one query. Read-only reasoning across the whole store; any draft
    the agent wants saved surfaces as a Proposal for the backend to approve."""
    backend = None
    if req.callback is not None:
        backend = BackendClient(req.callback.backend_url, req.callback.token)

    # The executive assistant sees everything — the global reader spans every
    # function folder + all projects. (Scope is intentionally NOT narrowed by
    # the current container.)
    deps = CorporateDeps(files=build_global_reader(), backend=backend)
    agent = build_agent()
    history = _to_message_history(req.conversation_history)

    # One span per agent run, carrying Orrery domain attributes; the PydanticAI
    # spans (loop, tokens, tool calls) nest underneath it.
    with logfire.span(
        "agent_run",
        agent_name="corporate",
        container=(req.project_context or {}).get("folder"),
        request_id=req.request_id,
    ) as span:
        result = await agent.run(req.query, deps=deps, message_history=history or None)
        text = _join_text(result.new_messages()) or result.output

        proposals = [
            Proposal(
                # A corporate document the EA drafted and wants saved into
                # corporate/drafts/. Medium risk: a bounded create-only write, so
                # it queues for human approval (never auto-executes).
                kind="save_draft",
                summary=f"Save draft '{d['filename']}' to {DRAFTS_DIR}/",
                risk=Risk.MEDIUM,
                payload={
                    "filename": d["filename"],
                    "content": d["content"],
                    "title": d.get("title"),
                },
            )
            for d in deps.pending_drafts
        ]
        span.set_attribute("produced_proposal", bool(proposals))
        if proposals:
            span.set_attribute("proposal_risk", proposals[0].risk.value)

    return AgentResponse(text=text, proposals=proposals)


def execute_action(kind: str, payload: dict) -> dict:
    """Execute an APPROVED proposal — a bounded write path, invoked only by the
    backend after governance routing. The reasoning loop (`run_once`) never
    reaches this; it only proposes. Create-only: writes a NEW file in
    corporate/drafts/ (unique on collision), never overwriting."""
    if kind == "save_draft":
        hit = filestore.write_text(
            DRAFTS_DIR,
            payload["filename"],
            payload["content"],
            f"corporate: add draft {payload['filename']}",
        )
        return {"path": hit.path, "name": hit.name}
    raise ValueError(f"unknown action kind: {kind!r}")

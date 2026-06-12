"""Run the engineering agent once and return the structured contract.

This is the HTTP-service entry into the same reasoning loop the CLI uses.
The agent stays STATELESS: prior turns arrive in the request
(conversation_history); nothing is stored here. Conversation state lives
in the backend.

The response is the shared `AgentResponse` (text + artifacts +
proposals). Proposals come from the agent's propose-only tools — e.g.
`request_spec_save` stages a save in `deps.pending_saves`, which becomes
a `Proposal` the backend routes through its approval flow. The agent
still performs no write/fetch itself.
"""
from __future__ import annotations

from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

from orrery_lib.schema import (
    AgentRequest,
    AgentResponse,
    ConversationTurn,
    Proposal,
    Risk,
)

from .agent import EngineeringDeps, _join_text, build_agent
from .drive import build_drive_reader
from .fetch import fetch_to_drafts


def _to_message_history(turns: list[ConversationTurn]):
    """Rebuild PydanticAI message history from the backend's plain turns."""
    history = []
    for turn in turns:
        if turn.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=turn.content)]))
        else:
            history.append(ModelResponse(parts=[TextPart(content=turn.content)]))
    return history


async def run_once(req: AgentRequest) -> AgentResponse:
    """Answer one query. Read-only reasoning; any write the agent wants
    surfaces as a Proposal for the backend to approve."""
    deps = EngineeringDeps(drive=build_drive_reader())
    agent = build_agent()
    history = _to_message_history(req.conversation_history)

    result = await agent.run(
        req.query, deps=deps, message_history=history or None
    )
    text = _join_text(result.new_messages()) or result.output

    proposals = [
        Proposal(
            # A web-found datasheet the agent wants saved into drafts/.
            # Medium risk: it's a bounded write + outbound fetch, so it
            # queues for human approval (never auto-executes).
            kind="save_spec",
            summary=f"Save '{s.get('filename') or s['url']}' to engineering/drafts/",
            risk=Risk.MEDIUM,
            payload={"url": s["url"], "filename": s.get("filename")},
        )
        for s in deps.pending_saves
    ]

    return AgentResponse(text=text, proposals=proposals)


def execute_action(kind: str, payload: dict) -> dict:
    """Execute an APPROVED proposal — a bounded write path, invoked only by
    the backend after governance routing (low-risk auto, or human approval).
    The reasoning loop (`run_once`) never reaches this; it only proposes.

    Returns a JSON-able result describing what was done.
    """
    if kind == "save_spec":
        created = fetch_to_drafts(payload["url"], name=payload.get("filename"))
        return {
            "file_id": created.file_id,
            "name": created.name,
            "web_view_link": created.web_view_link,
        }
    raise ValueError(f"unknown action kind: {kind!r}")

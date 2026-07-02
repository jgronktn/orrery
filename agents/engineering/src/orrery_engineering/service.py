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

import logfire

from orrery_lib.filestore import build_reader
from orrery_lib.pm import BackendClient

from .agent import EngineeringDeps, _join_text, build_agent
from .fetch import fetch_to_drafts


def _with_linked_note(query: str, linked: list[dict]) -> str:
    """Prepend a note listing the project's linked files so the agent treats
    them as project materials (reading them by their real path when relevant)."""
    if not linked:
        return query
    lines = "\n".join(f"- {lf['path']}" for lf in linked)
    return (
        "[Project context] These files are linked into this project — treat "
        "them as part of the project's materials. Read them with read_file when "
        "relevant, and cite their real path:\n"
        f"{lines}\n\n{query}"
    )


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
    backend = None
    if req.callback is not None:
        backend = BackendClient(req.callback.backend_url, req.callback.token)
    # Scope the file tools to the current container's folder (where dropped
    # files + emails live) plus the engineering corpus. Outside a project the
    # folder is absent, so the reader is engineering-only.
    folder = (req.project_context or {}).get("folder")
    linked = (req.project_context or {}).get("linked_files") or []
    # Widen the reader with the specific files linked into this project — they
    # may live in another function's corpus — so read_file can reach them.
    reader = build_reader(
        [folder] if folder else [],
        extra_paths=[lf["path"] for lf in linked],
    )
    deps = EngineeringDeps(files=reader, backend=backend)
    agent = build_agent()
    history = _to_message_history(req.conversation_history)
    query = _with_linked_note(req.query, linked)

    # One span per agent run, carrying Orrery domain attributes; the PydanticAI
    # spans (loop, tokens, tool calls) nest underneath it.
    with logfire.span(
        "agent_run",
        agent_name="engineering",
        container=folder,
        request_id=req.request_id,
    ) as span:
        result = await agent.run(
            query, deps=deps, message_history=history or None
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
        span.set_attribute("produced_proposal", bool(proposals))
        if proposals:
            span.set_attribute("proposal_risk", proposals[0].risk.value)

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

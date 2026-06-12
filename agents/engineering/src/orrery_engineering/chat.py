"""Interactive chat driver for the engineering agent.

Lives apart from agent.py on purpose: this is the driver that bridges
the read-only reasoning loop to the write/egress path. It imports
fetch.py (the downloader); agent.py never does. The agent can only
PROPOSE a save (the request_spec_save tool stages a {url, filename} in
deps.pending_saves); after each turn this driver shows the proposal,
asks the human to approve, and only then calls fetch_to_drafts. So the
agent has no write or fetch capability — every download is human-gated.

Conversation context persists across turns (in-memory only; gone on
exit, by design — durable facts belong in the KB). Per-turn and session
token usage is printed after each answer.

Exit with 'exit', 'quit', or Ctrl-D.
"""
from __future__ import annotations

import asyncio

from . import actions
from .agent import EngineeringDeps, _join_text, build_agent
from orrery_lib.filestore import build_engineering_reader
from .fetch import fetch_to_drafts


async def _process_pending_saves(deps: EngineeringDeps, loop) -> None:
    """Ask the human to approve each proposed save; fetch+store on yes."""
    if not deps.pending_saves:
        return
    for save in deps.pending_saves:
        url = save["url"]
        filename = save.get("filename")
        label = filename or url
        try:
            ans = await loop.run_in_executor(
                None, input, f"  ⤷ save '{label}' to drafts/? [y/N]: "
            )
        except (EOFError, KeyboardInterrupt):
            print("\n  · skipped.", flush=True)
            break
        if ans.strip().lower() not in ("y", "yes"):
            print("  · skipped.\n", flush=True)
            continue
        try:
            created = fetch_to_drafts(url, name=filename)
        except Exception as exc:  # network / validation / Drive errors
            print(f"  ✗ save failed: {exc}\n", flush=True)
            continue
        actions.log(
            "eng_spec_fetched",
            created.file_id,
            url=url,
            name=created.name,
            link=created.web_view_link,
            via="chat-approval",
        )
        print(f"  ✓ saved to drafts/: {created.web_view_link}\n", flush=True)
    deps.pending_saves.clear()


async def chat() -> None:
    deps = EngineeringDeps(files=build_engineering_reader())
    agent = build_agent()
    history: list = []
    loop = asyncio.get_event_loop()
    session_in = 0
    session_out = 0

    print(
        "Engineering agent — interactive chat.\n"
        "Ask about your Drive docs, research parts, etc. Context carries "
        "across turns.\nType 'exit' or press Ctrl-D to quit.\n",
        flush=True,
    )
    while True:
        try:
            line = await loop.run_in_executor(None, input, "you › ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        line = line.strip()
        if not line:
            continue
        if line.lower() in ("exit", "quit", ":q"):
            break
        try:
            result = await agent.run(
                line, deps=deps, message_history=history or None
            )
        except Exception as exc:  # keep the session alive on a bad turn
            print(f"\n[error] {exc}\n", flush=True)
            continue

        # Only the latest turn's text — new_messages() excludes history.
        answer = _join_text(result.new_messages()) or result.output
        print(f"\nagent › {answer}\n", flush=True)

        # Token feedback. Each turn re-sends the growing history, so the
        # per-turn input count climbs — that's the real cost, shown so
        # it's never a surprise. (cr = cache-read input tokens.)
        u = result.usage()
        turn_in = getattr(u, "input_tokens", 0) or 0
        turn_out = getattr(u, "output_tokens", 0) or 0
        cache_read = (getattr(u, "details", None) or {}).get(
            "cache_read_input_tokens", 0
        )
        session_in += turn_in
        session_out += turn_out
        print(
            f"  [tokens] turn: in {turn_in:,} (cr {cache_read:,}) / "
            f"out {turn_out:,} / total {turn_in + turn_out:,}"
            f"  ·  session total {session_in + session_out:,}\n",
            flush=True,
        )

        # Any saves the agent proposed this turn — human approves here.
        await _process_pending_saves(deps, loop)

        history = result.all_messages()

    print("bye.", flush=True)

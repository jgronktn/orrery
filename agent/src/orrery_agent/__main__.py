"""CLI entry. Usage:

    python -m orrery_agent draft --ticket t001

Invoked from the host via `make draft TICKET=t001`, which runs the
container with this entrypoint.
"""
import argparse
import asyncio
import json
import sys

from . import cli as kb_cli
from .agent import draft_reply
from .engineering.agent import ask as eng_ask
from .engineering.chat import chat as eng_chat
from .engineering.fetch import fetch_to_drafts as eng_fetch_to_drafts
from .engineering.handle import handle_draft as eng_handle_draft
from .handle import handle_ticket


def main() -> int:
    parser = argparse.ArgumentParser(prog="orrery_agent")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # ── draft (read-only — produce a draft, print, exit) ─────────
    p_draft = sub.add_parser(
        "draft", help="Draft a reply for a single ticket (no approval flow)"
    )
    p_draft.add_argument(
        "--ticket",
        required=True,
        help="Ticket id (e.g. t001). Looked up in the TicketSource.",
    )

    # ── handle (full loop — draft → approve → maybe send) ────────
    p_handle = sub.add_parser(
        "handle",
        help="Full pipeline: draft, post for approval, send on 👍",
    )
    p_handle.add_argument(
        "--ticket",
        required=True,
        help="Ticket id (e.g. t001).",
    )
    p_handle.add_argument(
        "--timeout",
        type=int,
        default=1800,
        help="Seconds to wait for the human's reaction (default 1800).",
    )

    # ── eng-ask (engineering agent, read-only Q&A) ───────────────
    p_eng_ask = sub.add_parser(
        "eng-ask",
        help="Ask the engineering agent a question (read-only).",
    )
    p_eng_ask.add_argument(
        "question",
        help="Free-text question, e.g. 'find our FCC cert for the V2 board'.",
    )

    # ── eng-chat (interactive multi-turn conversation, read-only) ──
    sub.add_parser(
        "eng-chat",
        help="Interactive chat with the engineering agent (keeps context).",
    )

    # ── eng-draft (template → draft → new doc in drafts/ → 👍/👎) ──
    p_eng_draft = sub.add_parser(
        "eng-draft",
        help="Draft a doc from a template into engineering/drafts/.",
    )
    p_eng_draft.add_argument(
        "--template",
        required=True,
        help="Template name (or fragment) in the templates folder.",
    )
    p_eng_draft.add_argument(
        "--purpose",
        required=True,
        help="What the draft is for (drives how the template is filled).",
    )
    p_eng_draft.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Seconds to wait for 👍/👎 feedback (default 600).",
    )

    # ── eng-save-spec (human-invoked: download a URL into drafts/) ──
    p_eng_save = sub.add_parser(
        "eng-save-spec",
        help="Download a file from a URL into engineering/drafts/ "
        "(human-invoked write path; the agent never fetches directly).",
    )
    p_eng_save.add_argument(
        "--url", required=True, help="The file URL to download (http/https)."
    )
    p_eng_save.add_argument(
        "--name",
        default=None,
        help="Optional filename for the stored draft (else derived from URL).",
    )

    # ── kb subcommands (index-docs, kb-search, kb-list, kb-delete) ──
    kb_cli.register_subparsers(sub)

    args = parser.parse_args()

    if args.cmd == "draft":
        try:
            output = asyncio.run(draft_reply(args.ticket))
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(output)
        return 0

    if args.cmd == "handle":
        try:
            result = asyncio.run(
                handle_ticket(args.ticket, timeout_s=args.timeout)
            )
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(result, indent=2))
        return 0

    if args.cmd == "eng-ask":
        try:
            output = asyncio.run(eng_ask(args.question))
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(output)
        return 0

    if args.cmd == "eng-chat":
        try:
            asyncio.run(eng_chat())
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        return 0

    if args.cmd == "eng-draft":
        try:
            result = asyncio.run(
                eng_handle_draft(
                    args.template, args.purpose, timeout_s=args.timeout
                )
            )
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(result, indent=2))
        return 0

    if args.cmd == "eng-save-spec":
        from . import actions

        try:
            created = eng_fetch_to_drafts(args.url, name=args.name)
        except Exception as exc:  # network / validation / Drive errors
            print(f"error: {exc}", file=sys.stderr)
            return 2
        actions.log(
            "eng_spec_fetched",
            created.file_id,
            url=args.url,
            name=created.name,
            link=created.web_view_link,
        )
        print(
            json.dumps(
                {
                    "action": "spec_saved",
                    "name": created.name,
                    "link": created.web_view_link,
                },
                indent=2,
            )
        )
        return 0

    # KB subcommands set _kb_fn via set_defaults — dispatch and return.
    if hasattr(args, "_kb_fn"):
        return int(args._kb_fn(args) or 0)

    return 1


if __name__ == "__main__":
    sys.exit(main())

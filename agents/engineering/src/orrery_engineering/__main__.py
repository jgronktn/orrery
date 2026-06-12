"""CLI entry for the engineering agent. Usage:

    python -m orrery_engineering chat
    python -m orrery_engineering ask "find our FCC cert for the V2 board"

Invoked from the host via `make chat` / `make ask Q="..."`, which run the
container with this entrypoint.
"""
import argparse
import asyncio
import json
import sys

from . import cli as kb_cli
from .agent import ask
from .chat import chat
from .fetch import fetch_to_drafts
from .handle import handle_draft


def main() -> int:
    parser = argparse.ArgumentParser(prog="orrery_engineering")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # ── ask (read-only one-shot Q&A) ─────────────────────────────
    p_ask = sub.add_parser(
        "ask", help="Ask the engineering agent a question (read-only)."
    )
    p_ask.add_argument(
        "question",
        help="Free-text question, e.g. 'find our FCC cert for the V2 board'.",
    )

    # ── chat (interactive multi-turn conversation, read-only) ────
    sub.add_parser(
        "chat",
        help="Interactive chat with the engineering agent (keeps context).",
    )

    # ── draft (template → draft → new doc in drafts/ → 👍/👎) ─────
    p_draft = sub.add_parser(
        "draft",
        help="Draft a doc from a template into engineering/drafts/.",
    )
    p_draft.add_argument(
        "--template",
        required=True,
        help="Template name (or fragment) in the templates folder.",
    )
    p_draft.add_argument(
        "--purpose",
        required=True,
        help="What the draft is for (drives how the template is filled).",
    )
    p_draft.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Seconds to wait for 👍/👎 feedback (default 600).",
    )

    # ── save-spec (human-invoked: download a URL into drafts/) ───
    p_save = sub.add_parser(
        "save-spec",
        help="Download a file from a URL into engineering/drafts/ "
        "(human-invoked write path; the agent never fetches directly).",
    )
    p_save.add_argument(
        "--url", required=True, help="The file URL to download (http/https)."
    )
    p_save.add_argument(
        "--name",
        default=None,
        help="Optional filename for the stored draft (else derived from URL).",
    )

    # ── kb subcommands (index-docs, kb-search, kb-list, kb-delete) ──
    kb_cli.register_subparsers(sub)

    args = parser.parse_args()

    if args.cmd == "ask":
        try:
            output = asyncio.run(ask(args.question))
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(output)
        return 0

    if args.cmd == "chat":
        try:
            asyncio.run(chat())
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        return 0

    if args.cmd == "draft":
        try:
            result = asyncio.run(
                handle_draft(args.template, args.purpose, timeout_s=args.timeout)
            )
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(result, indent=2))
        return 0

    if args.cmd == "save-spec":
        from . import actions

        try:
            created = fetch_to_drafts(args.url, name=args.name)
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

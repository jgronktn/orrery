"""End-to-end engineering draft flow: draft → create doc → review.

This is the ONLY place that ties the read-only reasoning loop to the
write-capable DriveDraftCreator. The agent (agent.py) does not import
draft.py; this driver does, AFTER the draft text is produced. Mirrors
the support agent's handle.py / send.py split.

Flow:
  1. draft_document() runs the agent (read-only) to produce the draft
     text from the named template.
  2. DriveDraftCreator creates a NEW Google Doc in engineering/drafts/
     (the only write capability; create-only; never overwrites).
  3. Post the draft + link to the approval surface for 👍/👎 FEEDBACK.
     Per CLAUDE.md this is feedback at this phase, not a hard gate —
     the draft already lives in Drive for the human to edit. The hard
     gate arrives with bookkeeping in Phase 2.
  4. Log every step to the actions audit trail.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from . import actions
from .approval import Decision, build_approval_surface
from .agent import draft_document
from .draft import DriveDraftCreator


def _draft_name(template_name: str, purpose: str) -> str:
    """A descriptive, unique name for the new draft doc."""
    base = template_name.rsplit(".", 1)[0]  # drop any extension
    short = purpose.strip().split("\n")[0][:60]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"[DRAFT] {base} — {short} ({stamp})"


async def handle_draft(
    template_name: str, purpose: str, timeout_s: int = 600
) -> dict:
    """Drive one drafting request end to end. Returns a summary dict."""

    # 1. Draft (read-only reasoning).
    body = await draft_document(template_name, purpose)
    actions.log("eng_drafted", template_name, purpose=purpose, chars=len(body))

    # 2. Create the NEW doc in drafts/ (separate write path).
    name = _draft_name(template_name, purpose)
    creator = DriveDraftCreator()
    created = creator.create(name=name, body=body)
    actions.log(
        "eng_draft_created",
        created.file_id,
        name=created.name,
        link=created.web_view_link,
    )

    # 3. Post for 👍/👎 feedback. Keep the message concise — the full
    # draft lives in Drive; post a preview + the link.
    preview = body if len(body) <= 1200 else body[:1200] + "\n…(truncated — see Drive)"
    review_body = (
        f"📄 *{created.name}*\n{created.web_view_link}\n\n{preview}"
    )
    surface = build_approval_surface()
    surface_name = type(surface).__name__
    handle = await surface.post_review(created.name, review_body)
    print(
        f"[eng-draft] created {created.web_view_link}\n"
        f"[eng-draft] posted for feedback via {surface_name}; "
        f"waiting up to {timeout_s}s for a 👍/👎 (Ctrl-C to skip)...",
        file=sys.stderr,
        flush=True,
    )

    # 4. Capture the feedback verdict (good / bad / none) and log it.
    decision = await surface.await_decision(handle, timeout_s=timeout_s)
    feedback = {
        Decision.APPROVED: "positive",
        Decision.REJECTED: "negative",
        Decision.TIMEOUT: "none",
    }[decision]
    actions.log("eng_feedback", created.file_id, feedback=feedback)

    return {
        "action": "drafted",
        "draft_name": created.name,
        "link": created.web_view_link,
        "feedback": feedback,
    }

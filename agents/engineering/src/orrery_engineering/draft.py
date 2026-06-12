"""DraftCreator — the engineering agent's template-drafting write path.

INVARIANT (CLAUDE.md): NEVER imported by agent.py. The agent's reasoning
loop has no path to create or modify a file. The top-level driver
(handle.py / the `draft` command) imports it separately, to turn an
already-produced draft into a NEW document.

Two hard rules:
  - NEVER overwrite. Every call CREATES a NEW file (unique name on
    collision).
  - New drafts land ONLY in engineering/drafts/.

The draft is written as Markdown (the format the agent produces) to the
local file store, and the change is git-committed for versioning.
"""
from __future__ import annotations

from dataclasses import dataclass

from orrery_lib import filestore

# Where drafts land, relative to ORRERY_FILES_ROOT.
DRAFTS_DIR = "engineering/drafts"


@dataclass
class CreatedDraft:
    """Result of creating a new draft. `path`/`web_view_link` are the
    file's location in the store (no Drive URL anymore)."""

    file_id: str  # the file's store-relative path
    name: str
    web_view_link: str  # also the store-relative path


class DraftCreator:
    """Creates a NEW Markdown draft in engineering/drafts/. Create-only."""

    def create(self, name: str, body: str) -> CreatedDraft:
        """Write `body` (Markdown) as a new .md file in drafts/, commit,
        and return its location. Never touches an existing file."""
        filename = name if name.lower().endswith(".md") else f"{name}.md"
        hit = filestore.write_text(
            DRAFTS_DIR,
            filename,
            body,
            message=f"engineering: created draft {filename}",
        )
        return CreatedDraft(file_id=hit.path, name=hit.name, web_view_link=hit.path)

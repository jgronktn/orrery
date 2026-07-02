"""The executive-assistant (corporate) agent — PydanticAI via the gateway.

Invariants (must hold in every future change):
  1. The reasoning tools are READ-ONLY (file read/search/list, KB read,
     cross-function doc search). The ONLY write is creating a NEW doc in
     corporate/drafts/, and it lives behind the propose→approve flow:
     `propose_draft` only STAGES a draft; the actual write happens in
     service.execute_action, invoked by the backend AFTER human approval.
  2. The behavior config is loaded once at startup from
     config/corporate/agent.md; the agent has no path to edit it.
  3. The EA reads across EVERYTHING (all functions + projects) — its reader is
     the global reader, set in service.run_once.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelResponse, TextPart

from orrery_lib import docstore, kb, pm
from orrery_lib.filestore import FileStoreReader
from orrery_lib.gateway import build_model
from orrery_lib.pm import BackendClient

from .config import CORPORATE_CONFIG_PATH, load_instructions


@dataclass
class CorporateDeps:
    """Per-run dependencies. `files` is a read-only reader (the global reader,
    spanning the whole store). `backend` is set inside a container conversation
    (corporate stream or a project) for PM + research-log callbacks.

    `pending_drafts` is a PROPOSAL queue, not a write capability: the
    `propose_draft` tool only appends a {title, filename, content} dict here. No
    file write happens in the agent — service.run_once turns these into
    Proposals the backend routes through approval, and service.execute_action
    performs the bounded write only after a human approves."""

    files: FileStoreReader
    backend: BackendClient | None = None
    pending_drafts: list[dict] = field(default_factory=list)
    # Files linked into the current project: {path (real, for reading), name,
    # target_dir (the project folder they appear in)}. list_directory surfaces
    # them at their target folder even though they live in a function corpus.
    linked: list[dict] = field(default_factory=list)


def build_agent() -> Agent[CorporateDeps, str]:
    """Construct the executive-assistant agent. Side effect: reads agent.md."""
    agent = Agent[CorporateDeps, str](
        build_model(),
        instructions=load_instructions(CORPORATE_CONFIG_PATH),
        deps_type=CorporateDeps,
    )

    # ── Read across everything ─────────────────────────────────────

    @agent.tool
    async def search_files(
        ctx: RunContext[CorporateDeps], query: str, k: int = 5
    ) -> list[dict] | str:
        """Search documents across the WHOLE company by keyword — every
        function (corporate, engineering, IT, HR, accounting) and all
        projects. Matches filenames and the text content of
        Markdown/text/Word/email(.eml)/ODT files (PDFs match by filename
        only). Use this FIRST to find what's documented anywhere. Returns up
        to k hits, each with the file's `path` (relative to the store root,
        e.g. 'engineering/specs/x.pdf' or 'projects/foo/research-log.md'),
        name, and a snippet. Read-only.
        """
        try:
            hits = ctx.deps.files.search(query, k=k)
        except Exception as exc:  # pragma: no cover - surfaced to the model
            return f"FILE SEARCH ERROR: {exc}"
        return [{"path": h.path, "name": h.name, "snippet": h.snippet} for h in hits]

    @agent.tool
    async def list_directory(
        ctx: RunContext[CorporateDeps], path: str = ""
    ) -> list[dict] | str:
        """List the contents of a folder anywhere in the document store. Omit
        `path` (or pass '') to see the top-level folders — the function
        folders (corporate, engineering, it, hr, accounting) and 'projects'.
        Pass a folder `path` (e.g. 'corporate', 'projects/condensate-probe',
        'engineering/specs') to list it. Returns each entry's `name`, `type`
        ('dir' or 'file'), and `path` — feed a file path to read_file, or a
        folder path back into list_directory to go deeper. Files LINKED into a
        project show up here too (name marked "(linked)") — their `path` is the
        real location in a function corpus; read_file that path. Read-only.
        """
        try:
            entries = ctx.deps.files.list_dir(path)
            missing = False
        except (FileNotFoundError, NotADirectoryError):
            entries, missing = [], True
        except Exception as exc:  # pragma: no cover - surfaced to the model
            return f"LIST DIRECTORY ERROR: {exc}"
        norm = (path or "").strip().strip("/")
        linked_here = [
            {"name": f"{lf['name']} (linked)", "type": "file", "path": lf["path"]}
            for lf in ctx.deps.linked
            if (lf.get("target_dir") or "").strip().strip("/") == norm
        ]
        if missing and not linked_here:
            return (
                f"No folder at '{path}'. It may be a file (use read_file) or "
                "may not exist — list a parent folder or use search_files."
            )
        return entries + linked_here

    @agent.tool
    async def read_file(ctx: RunContext[CorporateDeps], path: str) -> str:
        """Read a document by its `path` (from search_files or list_directory,
        e.g. 'corporate/governance/charter.md' or
        'projects/condensate-probe/attachments/note.eml'). Returns text for
        Markdown/text/Word/ODT, PDF, and parsed email files (.eml — headers,
        body, attachment names). Scanned/image-only PDFs have no text layer and
        may return little or nothing. Other binaries (images, archives) return
        the file's location to open directly — don't guess those. Read-only.
        """
        try:
            return ctx.deps.files.read(path)
        except FileNotFoundError:
            return f"No file found at '{path}'. Use search_files to find the right path."
        except Exception as exc:  # pragma: no cover
            return f"FILE READ ERROR: {exc}"

    @agent.tool
    async def search_docs(
        ctx: RunContext[CorporateDeps], query: str, k: int = 5
    ) -> list[dict]:
        """Semantic search over indexed document passages across ALL functions
        (the catalog-backed `documents` index, unscoped). Returns up to k hits
        with the passage text, its file path, and a relevance score. Empty list
        = nothing relevant indexed. Read-only.
        """
        hits = docstore.search(query, k=k)
        return [
            {"text": h.text, "source": h.path, "relevance": round(h.score, 3)}
            for h in hits
        ]

    @agent.tool
    async def search_kb(
        ctx: RunContext[CorporateDeps], query: str, k: int = 5
    ) -> list[dict]:
        """Search the shared knowledge base — provisional facts agents have
        saved while working. Each hit carries a `status` ('provisional' =
        unreviewed; 'curated' = human-blessed). Weight provisional hits
        carefully. Read-only.
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
    async def add_kb(ctx: RunContext[CorporateDeps], text: str, source: str) -> str:
        """Save a durable, non-obvious cross-functional fact to the knowledge
        base as a PROVISIONAL note (a human curates it later). Use this ONLY
        after you have already written your full, cited answer — it is internal
        bookkeeping, never the response itself. Always include where it came
        from. Don't save trivia or restatements of a document.
        """
        point_id = kb.add(
            kb.LEARNINGS_COLLECTION, text=text, source=source, status="provisional"
        )
        return (
            f"Saved as {point_id} (provisional). This was a silent internal "
            "action — do NOT mention it to the user. If you have not already "
            "given your complete cited answer, write it now in full."
        )

    # ── The one write: PROPOSE a corporate draft (no direct write) ──

    @agent.tool
    async def propose_draft(
        ctx: RunContext[CorporateDeps], title: str, filename: str, content: str
    ) -> str:
        """PROPOSE saving a drafted corporate document (a brief, memo, board
        update, summary you've composed) as a NEW file in corporate/drafts/.

        This does NOT write anything — you cannot write to the store. It records
        a proposal; the user is then asked to approve, and a separate step
        creates the new file on approval (never overwriting anything). Pass the
        full document `content` (Markdown) and a descriptive `filename` (e.g.
        'board-update-2026Q2.md'). After calling this, tell the user you've
        proposed the draft and they'll be asked to approve it.
        """
        name = filename.strip() or "draft.md"
        ctx.deps.pending_drafts.append(
            {"title": title.strip() or name, "filename": name, "content": content}
        )
        return (
            f"Proposed saving draft '{name}' to corporate/drafts/. I cannot "
            "write it myself — the user will be asked to approve, and a separate "
            "step will create it on approval."
        )

    # Shared PM + research-log tools (active only inside a container
    # conversation, where deps.backend is set). The EA logs to "Decisions".
    pm.register(agent, default_log_section="Decisions")

    return agent


def _join_text(messages) -> str:
    """Join every assistant text block across the given messages (so the full
    answer survives even when the agent writes text and then calls a tool)."""
    chunks: list[str] = []
    for message in messages:
        if isinstance(message, ModelResponse):
            for part in message.parts:
                if isinstance(part, TextPart) and part.content.strip():
                    chunks.append(part.content.strip())
    return "\n\n".join(chunks)

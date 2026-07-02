"""The engineering agent — PydanticAI wired to the LiteLLM gateway.

Mirrors the support agent's construction, but owns the engineering
function: Drive docs (inward) + parts/vendor research (outward).

Invariants enforced here (must hold in every future change):
  1. Every tool registered against this Agent is READ-ONLY. The one
     write capability (create a new doc in engineering/drafts/) lives in
     engineering/draft.py and is NEVER imported here.
  2. The behavior config is loaded once at startup from
     config/engineering/agent.md; the agent has no path to edit it.
  3. Web search is the only outbound capability, through one provider
     (engineering/websearch.py). No other egress, no arbitrary fetch.

Build state: the KB tools are live. The Drive and web-search tools are
wired to their seams (drive.py / websearch.py); until credentials are
supplied they return a clear "not configured" message to the model so
it tells the user honestly instead of inventing an answer.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelResponse, TextPart

from orrery_lib import NotConfiguredError, docstore, kb, pm
from orrery_lib.filestore import FileStoreReader, build_engineering_reader
from orrery_lib.gateway import build_model
from orrery_lib.pm import BackendClient

from .config import ENGINEERING_CONFIG_PATH, load_instructions
from . import websearch


@dataclass
class EngineeringDeps:
    """Per-run dependencies. The file reader is read-only; the write
    path is deliberately absent from deps so the agent can't reach it.

    `pending_saves` is a PROPOSAL queue, not a write capability: the
    request_spec_save tool only appends a {url, filename} dict here. No
    download or file write happens in the agent — a separate driver
    (chat.py) reads this queue, asks the human to approve, and only then
    invokes the separate fetch module. Empty for one-shot ask/draft."""

    files: FileStoreReader
    # Set when running inside a project conversation: a client for the
    # backend's /internal/agent API (tasks + research log). None otherwise.
    backend: BackendClient | None = None
    pending_saves: list[dict] = field(default_factory=list)
    # Files linked into this project: {path (real, for reading), name,
    # target_dir (the project folder they appear in)}. list_directory surfaces
    # them at their target folder even though they live in a function corpus.
    linked: list[dict] = field(default_factory=list)


def build_agent() -> Agent[EngineeringDeps, str]:
    """Construct the engineering agent. Side effect: reads agent.md."""
    agent = Agent[EngineeringDeps, str](
        build_model(),
        instructions=load_instructions(ENGINEERING_CONFIG_PATH),
        deps_type=EngineeringDeps,
    )

    # ── Inward: the company's own documents ────────────────────────

    @agent.tool
    async def search_files(
        ctx: RunContext[EngineeringDeps], query: str, k: int = 5
    ) -> list[dict] | str:
        """Search the documents you can see (specs, SOWs, design docs,
        testing checklists, certifications, templates, and — inside a
        project conversation — that project's own files and emails) by
        keyword. Matches filenames and the text content of
        Markdown/text/Word/email(.eml) files (PDFs match by filename only).
        Use this FIRST for any question about what's documented. Returns up
        to k hits, each with the file's `path` (relative to the file-store
        root, e.g. 'projects/leak-sensor/attachments/note.eml'), name, and a
        snippet. Read-only.
        """
        try:
            hits = ctx.deps.files.search(query, k=k)
        except Exception as exc:  # pragma: no cover - surfaced to the model
            return f"FILE SEARCH ERROR: {exc}"
        return [{"path": h.path, "name": h.name, "snippet": h.snippet} for h in hits]

    @agent.tool
    async def list_directory(
        ctx: RunContext[EngineeringDeps], path: str = ""
    ) -> list[dict] | str:
        """List the contents of a folder in the document store. Omit `path`
        (or pass '') to see the top-level folders you can reach — the
        engineering corpus and, in a project conversation, that project's
        folder ('projects/<slug>'). Pass a folder `path` (e.g.
        'projects/leak-sensor/attachments' or 'engineering/specs') to list it.
        Returns each entry's `name`, `type` ('dir' or 'file'), and `path` —
        feed a file path to read_file, or a folder path back into
        list_directory to go deeper. Dropped files and emails land in the
        container's 'attachments/' folder. Files LINKED into this project show
        up here too (name marked "(linked)") — their `path` is the real
        location in a function corpus; read_file that path. Read-only.
        """
        try:
            entries = ctx.deps.files.list_dir(path)
            missing = False
        except (FileNotFoundError, NotADirectoryError):
            entries, missing = [], True
        except Exception as exc:  # pragma: no cover - surfaced to the model
            return f"LIST DIRECTORY ERROR: {exc}"
        # Merge in files linked into this project at this folder. They live in a
        # function corpus (their `path`), but appear where they were linked.
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
    async def read_file(
        ctx: RunContext[EngineeringDeps], path: str
    ) -> str:
        """Read a document by its `path` (from search_files or list_directory,
        e.g. 'engineering/specs/spec-relay-5A.pdf' or
        'projects/leak-sensor/attachments/note.eml'). Returns the text for
        Markdown/text/Word/ODT, PDF, and parsed email files (.eml — headers,
        body, and attachment names). Scanned/image-only PDFs have no text layer
        and may return little or nothing; when quoting a datasheet spec, cite the
        file and flag that the source should be verified. Other binaries (images,
        archives) return the file's location to open directly. Read-only.
        """
        try:
            return ctx.deps.files.read(path)
        except FileNotFoundError:
            return f"No file found at '{path}'. Use search_files to find the right path."
        except Exception as exc:  # pragma: no cover
            return f"FILE READ ERROR: {exc}"

    @agent.tool
    async def search_docs(
        ctx: RunContext[EngineeringDeps], query: str, k: int = 5
    ) -> list[dict]:
        """Search source documents (the catalog-backed `documents` index) by
        semantic similarity. Returns up to k hits with the passage text, its
        file path, and a relevance score. Empty list = nothing relevant
        indexed. Read-only.
        """
        hits = docstore.search(query, k=k)
        return [
            {"text": h.text, "source": h.path, "relevance": round(h.score, 3)}
            for h in hits
        ]

    @agent.tool
    async def search_kb(
        ctx: RunContext[EngineeringDeps], query: str, k: int = 5
    ) -> list[dict]:
        """Search the agent's accumulated knowledge base — provisional
        facts saved while working (parts that fit recurring needs,
        vendor quirks, cross-design specs). Each hit carries a `status`
        ('provisional' = unreviewed; 'curated' = human-blessed). Weight
        provisional hits carefully. Read-only.
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
        ctx: RunContext[EngineeringDeps], text: str, source: str
    ) -> str:
        """Save a durable, non-obvious engineering fact to the knowledge
        base as a PROVISIONAL note (a human curates it later). Use this
        ONLY after you have already written your full, cited answer to
        the user — it is internal bookkeeping, never the response itself.
        e.g. "Part X meets the -40C spec our sensors recur on; see <url>".
        Always include where it came from. Don't save trivia or
        restatements of a document.
        """
        point_id = kb.add(
            kb.LEARNINGS_COLLECTION, text=text, source=source, status="provisional"
        )
        # The return value steers the model's next step: saving is silent
        # bookkeeping and must NOT become the user-facing answer.
        return (
            f"Saved as {point_id} (provisional). This was a silent internal "
            "action — do NOT mention it to the user. If you have not already "
            "given your complete cited answer, write it now in full."
        )

    # ── Outward: the open world (one provider, cite everything) ────

    @agent.tool
    async def web_search(
        ctx: RunContext[EngineeringDeps], query: str, k: int = 5
    ) -> list[dict] | str:
        """Research parts, vendor options, and reference information on
        the web. This is the ONLY outbound capability. Every result
        carries its source URL — you MUST cite it and add "verify before
        relying on this" when you report any spec, price, or part number.
        You are a finder, not an oracle. Returns up to k results.
        """
        try:
            results = websearch.search(query, k=k)
        except NotConfiguredError as exc:
            return (
                "WEB SEARCH UNAVAILABLE — not configured in this build. "
                "Do not invent parts, specs, or prices. Tell the user web "
                f"research isn't wired up yet.\n\n{exc}"
            )
        return [
            {
                "title": r.title,
                "url": r.url,
                "snippet": r.snippet,
                "published": r.published,
            }
            for r in results
        ]

    @agent.tool
    async def request_spec_save(
        ctx: RunContext[EngineeringDeps], url: str, filename: str = ""
    ) -> str:
        """PROPOSE saving a file (e.g. a datasheet you found via web
        search) into engineering/drafts/. Use this when the user asks to
        save/store/keep a spec sheet or document from a URL.

        This does NOT download or store anything itself — you have no
        ability to fetch files or write to Drive. It only records the
        proposal; the user is then asked to approve, and a separate step
        performs the download and store on approval. After calling this,
        tell the user you've proposed the save and that they'll be asked
        to approve it. Pass the direct file URL and, if helpful, a
        descriptive filename (e.g. 'spec-ic-ina228.pdf').
        """
        ctx.deps.pending_saves.append(
            {"url": url, "filename": filename.strip() or None}
        )
        label = filename.strip() or url
        return (
            f"Proposed saving '{label}' to drafts/. I cannot fetch or "
            "store it myself — the user will be asked to approve, and a "
            "separate step will store it on approval."
        )

    # Shared project-management + research-log tools (active only inside a
    # project conversation, where deps.backend is set).
    pm.register(agent, default_log_section="Engineering")

    return agent


def _join_text(messages) -> str:
    """Join every assistant text block across the given messages.

    PydanticAI's `result.output` is only the LAST text part. When the
    agent writes its full answer and then calls a tool (e.g. add_kb) and
    signs off, `.output` would drop the real answer. We concatenate all
    assistant text parts in order so the substantive answer is never
    lost, regardless of where tool calls land in the turn.
    """
    chunks: list[str] = []
    for message in messages:
        if isinstance(message, ModelResponse):
            for part in message.parts:
                if isinstance(part, TextPart) and part.content.strip():
                    chunks.append(part.content.strip())
    return "\n\n".join(chunks)


def _full_answer(result) -> str:
    """All assistant text from a single-turn run."""
    return _join_text(result.all_messages()) or result.output


def _longest_text(result) -> str:
    """Return the single largest text block the model produced.

    For document drafting the output is one dominant block; taking the
    longest part cleanly drops interim status chatter ("I'll find the
    template first…") and any short trailing note, which `_full_answer`
    would otherwise concatenate into the document.
    """
    best = ""
    for message in result.all_messages():
        if isinstance(message, ModelResponse):
            for part in message.parts:
                if isinstance(part, TextPart):
                    content = part.content.strip()
                    if len(content) > len(best):
                        best = content
    return best or result.output


async def ask(question: str) -> str:
    """Driver: answer one engineering question. Read-only end to end."""
    deps = EngineeringDeps(files=build_engineering_reader())
    agent = build_agent()
    result = await agent.run(question, deps=deps)
    return _full_answer(result)


async def draft_document(template_name: str, purpose: str) -> str:
    """Driver: produce the TEXT of a draft document from a template.

    Read-only end to end. The agent finds the named template in
    templates/ (search_drive), reads it (read_drive), may research
    parts/specs to fill it, and returns the completed draft text. It has
    NO ability to create the Drive file — the caller (handle.py) passes
    this text to the separate write module. That preserves the
    governance split: the reasoning loop drafts, a separate path writes.
    """
    deps = EngineeringDeps(files=build_engineering_reader())
    agent = build_agent()
    prompt = (
        f"Draft a new '{template_name}' document for this purpose:\n"
        f"{purpose}\n\n"
        f"Steps: find the template named like '{template_name}' in the "
        f"templates folder using search_drive, read it with read_drive to "
        f"learn its structure and sections, then write a COMPLETE filled "
        f"draft that follows that structure. Use clearly-marked "
        f"placeholders like [TBD: ...] wherever you lack the information "
        f"rather than inventing specifics. If you cite any external part "
        f"or spec, include its source URL and a verify-before-relying "
        f"note.\n\n"
        f"Format the draft in Markdown: '#'/'##'/'###' for section "
        f"headings, '**bold**' for emphasis, '-' for bullet lists, and "
        f"'| col | col |' pipe tables where a table fits (it will be "
        f"rendered into a formatted Google Doc). "
        f"Respond with ONLY the draft document in Markdown — no preamble, no "
        f"commentary, no 'here is your draft'. Do not save anything to the "
        f"knowledge base."
    )
    result = await agent.run(prompt, deps=deps)
    return _longest_text(result)

# CLAUDE.md — project guide for Claude Code

## What this is
Internal AI-agent system for a tiny hardtech company. **Phase 0/1 (minimal cut)**: one
function-scoped agent for **engineering** that helps with documents and parts research.
The agent reads, finds, and drafts — a human reviews and edits the actual work.
We are building the smallest honest slice to prove the premise, **not** the full system.
Bias toward less.

## The destination (context only — do NOT build all of this now)
Long-term function sequence:
1. **Engineering agent** (this phase) — document Q&A, parts research, template-based drafting.
2. **Bookkeeping agent** — adds the proper approval queue, because bookkeeping proposes
   changes that affect the books and warrants a hard gate.
3. **Corporate documents + Executive Assistant agent** (combined) — corporate is the
   EA's home function; the EA's distinguishing capability is cross-agent reach via the
   shared knowledge base. **In its initial phase, the EA is available only to
   founder / CEO / CFO roles.** Broader role access waits for proper scope inheritance.
4. **Phase 4+** — multi-user scope inheritance for the EA, then the remaining function
   agents (support, marketing, IT-ops, customer-service), and the full governance
   infrastructure.

Everything later is added *to* this shape, not a redesign of it.

## Principles — honor even in the minimal version
1. **Function-shaped, not chat-shaped** — the agent owns engineering, with its own
   config and memory; it is not a generic assistant.
2. **Governed autonomy** — the agent DRAFTS, FINDS, PROPOSES. A human reviews and edits
   the actual artifact. The agent never modifies or sends finalized work.
3. **Behavior in git, facts in memory, kept separate** — behavior lives in a versioned
   markdown config file; facts the agent learns live in the vector DB. Never mix them.

## Invariants — enforce these in code, always
- The agent **never overwrites** an existing Drive document. Drafts are always **new**
  files created in `engineering/drafts/`. Drive's own permissions enforce this at the
  API level; the code should not even try.
- The agent is a **finder, not an oracle**. Any spec, price, or part number from web
  search must include the source URL and a "verify before relying on this" note. Never
  assert external technical facts as authoritative.
- The agent's reasoning tools are **read-only** (Drive read, KB read, web search). The
  only write capability is creating a new doc in `engineering/drafts/`, kept as a
  separate code path from the reasoning tools.
- Config is **read-only to the agent** at runtime. Only the human edits it, via git.
- Everything the agent learns lands in the KB as `status="provisional"`, tagged with
  the source document (or URL) and its version/date.
- **Web search is the agent's ONE outbound capability** beyond the gateway. Egress
  restricted to the search-provider endpoint(s) only. No general internet browsing.
  - **Sanctioned exception (added 2026-06-03, user-approved):** a *human-invoked*
    file download into `engineering/drafts/` is allowed, for saving a web datasheet
    the agent found. The **agent itself still has no fetch or write tool** — it only
    *proposes* a URL (the `request_spec_save` tool stages it, does no I/O). The
    download + store happens in a separate module (`engineering/fetch.py`,
    `fetch_to_drafts`) only after a human approves (the `eng-save-spec` command, or
    the y/N prompt in `eng-chat`). This widens egress to arbitrary hosts at that
    moment; it is bounded by guards (http/https only, SSRF guard rejecting
    private/loopback hosts, 30 MB cap, 30 s timeout, create-only in `drafts/`). Do
    not extend this into an agent-callable tool — that would break the invariant.
- Secrets live in `.env` (gitignored) and reach only the container that needs them.
  Never hardcode a key. Never commit `.env` or the Google service-account JSON.

## Scope — build ONLY this
- **LiteLLM gateway** (Docker) → our Anthropic account. All model and embedding calls
  route through it.
- **One engineering agent** (~one Python file, PydanticAI) in its own container, via
  the gateway.
- **Four tools** in the agent:
  - Drive search over `engineering/` and subfolders (via the Google Workspace MCP if
    available, or the Drive API directly with a service account).
  - KB search and add — Qdrant, with local embeddings (fastembed); pin the embedding
    model name in metadata.
  - Web search through **one** controlled tool (Tavily by default — designed for
    agents); egress restricted to that provider only.
  - Drive draft creation — creates a new doc in `engineering/drafts/` from a template
    in `engineering/templates/`. Never modifies existing files.
- **Behavior config**: `config/engineering/agent.md`, in a local git repo, read at startup.
- **Approval surface**: post drafts/summaries to Slack with 👍/👎. At this phase, reactions
  are mainly **feedback** (good output / bad output) rather than a hard safety gate,
  because engineering drafts are inherently low-risk (the human edits them in Drive
  anyway). The hard-gating role of the approval queue arrives in Phase 2 with
  bookkeeping. Build the pattern anyway. Fall back to console output if Slack isn't ready.

## Drive permissions — the read/write split is enforced by Google, not by code
The agent uses a Google service account. The human shares folders with it like this:

- `engineering/` and most subfolders → **read-only** share
- `engineering/templates/` → **read-only** share
- `engineering/drafts/` → **edit** share (so the agent can create new docs here)

Google enforces this at the API level. The agent literally cannot modify a read-only
file. The code should still treat "never overwrite" as a rule, not rely on Google
catching mistakes.

## Do NOT build yet — deferred to later phases; leave clean seams, not implementations
- No second agent. No bookkeeping, corporate, EA, support, marketing, IT-ops, or
  customer-service yet.
- No agent-to-agent communication (the EA arrives in Phase 3).
- No multi-user permissions or role-based access (the founder/CEO/CFO restriction on
  the EA is a Phase 3+ feature; not now).
- No structured spec-sheet extraction. The agent surfaces datasheet links; the human
  reads the PDF for design-relevant numbers.
- No paid vendor APIs (Octopart, Digi-Key, Mouser). Web search via one provider is enough.
- No Postgres approval store, no web console — Slack 👍/👎 *is* the approval surface.
- No separate MCP layer service — a small set of agent-owned tools is fine for one agent.
- No document repo / git-LFS layer — Drive *is* the document home for now; Drive's
  native version history is the version control.
- No trust/decay engine on the KB — just timestamps and source/version tags.
  Manual curation (deletion) is fine.

If a task tempts you toward any of the above, **stop and ask** — it is almost certainly
out of scope for this phase.

## Conventions
- Stack: Ubuntu 24.04, Docker + docker compose, Python 3.12, type hints, small focused files.
- Layout:
  ```
  docker-compose.yml             # gateway, qdrant, agent
  gateway/                       # LiteLLM config
  agent/                         # loop, tools, kb wrapper, approval surface
  config/engineering/agent.md    # the agent's behavior (git-tracked)
  .env                           # secrets (gitignored)
  service-account.json           # Google credentials (gitignored)
  ```
- **Naming:** the agent's behavior file is `config/engineering/agent.md`. *This* file
  (`CLAUDE.md`) is your instructions as the coding assistant. They are different things —
  never conflate them.
- Keep the agent file small and readable; someone who didn't write it should understand it.

## How to work
- Build incrementally; explain choices briefly.
- **Ask before assuming** any credential or external service: Anthropic key handling,
  Drive integration approach (Workspace MCP vs. Drive API + service account), web-search
  provider choice, Slack token presence, the engineering folder structure to set up.
- Order: **gateway first** — verify a test call routes through it, then **pause for my
  confirmation** — then agent skeleton + Drive read in console → KB + ingest engineering
  folder → web search (one provider) → template-based draft creation → Slack 👍/👎.
- When unsure whether something is in scope, prefer the smaller option and ask.

## Definition of done (this phase)
The engineering agent can answer "find me X in our docs" with citations, "research vendor
options for Y" with cited links and verify-the-source notes, and "draft a [template] for
[purpose]" creating a new Drive doc in `drafts/`. The KB accumulates provisional, source-
tagged facts. Then we judge: **did it actually help my engineering work?** No scope
expansion until that question is answered.

# Decisions log

Append-only log of major decisions and the reasoning behind them.
Format: date, decision, rationale, what would cause us to reconsider.

The trailing **Where we left off** section is the only mutable part —
it gets edited as work progresses so a new session can orient quickly.

---

## 2026-05-28 — Python + Docker + PydanticAI as the stack

Considered: Node + Vercel AI SDK; OpenAI's Agents SDK; LangGraph;
LlamaIndex.

Picked Python + Docker because:
- The brief specified Python 3.12 + Docker as the host conventions.
- PydanticAI gives strong tool-typing without locking us into an
  agent framework with strong opinions about loops, state, or
  prompting — the agent stays "~1 Python file" per the brief.
- Containers per service makes the invariant "the agent has no Slack
  client, no DB credentials" enforceable at the image boundary, not
  just code review.

Would reconsider when: the agent loop grows complex enough that
we want graph-shaped orchestration (LangGraph), OR if we end up
needing the Vercel ecosystem for a frontend (unlikely — Slack is
the surface).

## 2026-05-28 — LiteLLM as the LLM gateway

Considered: calling Anthropic SDK directly from the agent; running
the agent against the new Claude Platform on AWS endpoint.

Picked LiteLLM because:
- One container holds the Anthropic key. Agents (now and future)
  hold no provider credentials.
- The agent talks the OpenAI chat-completions shape. If we ever
  swap providers (Gemini, internal model, multi-provider routing),
  agent code doesn't change.
- LiteLLM gives rate-limit handling, retries, and observability
  for free.

Cost: the container is one more thing to keep healthy. Acceptable.

Would reconsider when: LiteLLM's maintenance burden exceeds the
indirection benefit (very unlikely at this scale), or if we add
features that LiteLLM doesn't pass through cleanly (extended
thinking content blocks were a concern; for support drafting
they're not needed).

## 2026-05-28 — Behavior in git, facts in Qdrant, kept separate

This is the brief's third principle, made concrete:

- **Behavior** lives in `config/<function>/agent.md` (markdown,
  human-edited, git-tracked). Loaded once at startup; restart to
  pick up edits. No hot-reload — behavior changes should be
  deliberate and version-controllable.
- **Facts** live in Qdrant collections: `docs` (curated, indexed
  from `docs/`) and `learnings` (provisional, written by the agent
  itself via `add_kb`).

The agent has search tools against both collections. It has ONE
write tool: `add_kb`, hardcoded to the `learnings` collection with
`status="provisional"`. There is no code path through which the
agent can modify `docs` or `agent.md`.

Would reconsider when: real usage shows the provisional/curated
distinction is too coarse (we may need "verified by X person on
date Y" provenance), or behavior config needs hot-reload (would
sacrifice the git-deliberateness on purpose).

## 2026-05-28 — Qdrant + fastembed, not OpenAI embeddings

Considered: OpenAI text-embedding-3-small via LiteLLM; Cohere
embeddings; pgvector + Postgres.

Picked Qdrant + fastembed because:
- The brief said "use local embeddings to avoid another API
  dependency". `fastembed` runs in-process on CPU with no external
  call. Cost: zero. Latency: low. Offline-friendly.
- Qdrant has a clean Docker image, persistent storage, and a REST
  + gRPC API. Curation tools (`kb-list`, `kb-delete`) work without
  writing migrations.
- `BAAI/bge-small-en-v1.5` (384 dim, ~30 MB) is the default. Pinned
  via env var, recorded per point as `embed_model` payload — if we
  swap models, we can identify and reindex affected points.

Would reconsider when: corpus grows past ~100K passages where
in-process embedding becomes a bottleneck (unlikely in Phase 1),
OR when multilingual support requires a different model family.

## 2026-05-28 — Slack reaction-polling, not Events API + webhooks

Considered: Slack Events API with an inbound webhook server +
signing-secret verification.

Picked reaction-polling because:
- Phase 0 runs locally. We don't have a stable public URL to give
  Slack as a webhook endpoint. ngrok during dev → "ngrok URL"
  every restart → friction.
- Polling `reactions.get` every 5s is well within Slack's rate
  limits (Tier 3, ~50/min — we use ~12/min while waiting).
- Zero infrastructure surface: no signing-secret to leak, no port
  to expose, no inbound traffic.

Cost: agent process must stay alive during the polling window
(default 30 min). If it crashes, the human's reaction is silently
ignored until the next `make handle` run.

Would reconsider when: we deploy to a real host with a stable URL
AND the agent runs as a daemon AND we want interactive Slack
buttons (richer than 👍/👎). All three need to be true together.

## 2026-05-28 — `add_kb` writes provisional only; human curates by deleting

Considered: a "promote to curated" command; weighting search hits
by status so the model implicitly trusts curated more.

Picked the minimal version:
- The agent's `add_kb` tool is hardcoded to `status="provisional"`.
- Search returns the status field; the agent's `agent.md` tells it
  to "weight provisional hits lower".
- Human curation = `make kb-list STATUS=provisional` to browse,
  `make kb-delete ID=...` to remove. Useful provisional notes can
  stay provisional indefinitely.

Would reconsider when: the provisional pile grows large enough
that browse-and-delete is painful, or when we want an analytics
trail on curation decisions.

## 2026-05-28 — `send.py` separate from `tools/`; agent never imports it

The brief's invariant: "the only write/send is the approved-reply
path, triggered by 👍, and it must be separate from the agent's
reasoning tools."

Enforcement at three levels:
1. **Code**: `send.py` is a sibling of `agent.py`, not under
   `tools/`. `agent.py` does not import it.
2. **Tool registration**: only four tools are registered on the
   `Agent` instance — `read_ticket`, `search_docs`, `search_kb`,
   `add_kb`. No `send_*` tool exists.
3. **Runtime path**: only `handle.py` (the top-level driver)
   imports both `agent` and `send`, and only invokes the
   dispatcher after the approval surface returns `APPROVED`.

If a future change lands a `send_*` tool on the Agent, code review
must reject it. This is the governance invariant.

Would reconsider when: never, while the propose-then-approve
principle holds. Even multi-agent fleets in later phases keep this
shape.

## 2026-05-28 — JsonFileTicketSource stub, not real Zendesk/Intercom yet

The brief: "ASK me what ticket system we use; if unknown, stub
behind a clean interface." Answer: don't know yet.

`TicketSource` is a Python Protocol with one method, `get(id) →
Ticket`. `JsonFileTicketSource` reads from `docs/sample_tickets/`.
Real adapters (Zendesk, Intercom, Freshdesk) plug in here when we
have a ticket system without changing any agent code.

Would reconsider when: never — the Protocol stays. We just add
implementations.

## 2026-05-28 — Slack reaction polling needs only outbound HTTPS

Required bot scopes: `chat:write`, `reactions:write`,
`reactions:read`. Bot must be `/invite`d to the approval channel.

Token + channel ID live in `.env` (gitignored). No signing secret
needed (we don't receive webhooks). Channel ID is the `C0...`
form, not the human-readable name — IDs don't rename when the
channel does.

## 2026-05-28 — Scoped sudoers NOPASSWD for `apt` + `docker`

Wrote `/etc/sudoers.d/jronk-orrery` granting NOPASSWD for `apt`,
`apt-get`, `apt-cache`, `dpkg`, `usermod`, `groupadd`,
`systemctl`, `docker`. Notably NOT scoped: `tee`, `curl`, `chmod`,
`install` — granting any of those as root effectively gives full
root via file writes.

In practice: the install required a few interactive password
prompts (GPG key + repo file setup uses `tee`/`curl`). After
install, the `docker` group covers most needs, and `sudo apt`
runs passwordless for future updates.

NOTE: the actual sudoers drop-in did NOT take effect in the
session it was created — `sudo -n` still prompts. We worked
around it via the `docker` group + interactive sudo when needed.
Re-run the install snippet from the relevant message if it
matters; otherwise leave it.

Would reconsider when: deploying to the cloud host, where the
trade-off is different (and where running services as a dedicated
user with a tighter sudoers profile is the norm anyway).

## 2026-05-28 — `profiles: [cli]` on the agent container

The agent container is not part of `docker compose up`. It runs
per-invocation via `docker compose run --rm agent <subcommand>`.

Why: the agent is a CLI-shaped thing in Phase 0, not a daemon.
Each `make draft / handle` call is a fresh container, gets the
latest mounted source (no rebuild needed), exits cleanly.

Would reconsider when: we move to autonomous polling of an
incoming ticket queue — then it becomes a long-running service
and the profile comes off.

## 2026-06-01 — Redirected to the ENGINEERING agent; kept support alongside

The prior session built a complete tech-SUPPORT agent (tickets → draft
→ Slack → send). But CLAUDE.md defines Phase 0/1 as the ENGINEERING
agent (Drive Q&A + parts research + template drafting); a support agent
is Phase 4+.

Picked: build the engineering agent as the real Phase 0/1 deliverable
and — at the user's explicit call — KEEP the support agent in place
rather than repurpose or delete it. The two coexist; support is frozen,
not extended.

Cost: the repo holds two agents, which diverges from CLAUDE.md's "ONE
agent" scope. Accepted deliberately by the user.

Would reconsider when: never by default — do NOT "fix" the repo down to
one agent to match CLAUDE.md. The coexistence is intentional.

## 2026-06-01 — Engineering reuses shared infra; lives in an `engineering/` subpackage

Function-agnostic modules are shared by both agents: `tools/kb.py`,
`approval/`, `actions.py`, `config.py`, `cli.py`, the gateway, and
docker-compose. The engineering domain layer lives under
`agent/src/orrery_agent/engineering/` (agent, drive, draft, fetch, chat,
handle). `config.load_instructions(path)` takes an explicit path so each
function loads its own `config/<function>/agent.md`.

Would reconsider when: a third agent makes the shared/domain split worth
extracting into a firmer package boundary.

## 2026-06-01 — Drive via service account on a Shared Drive; read/write split = Google ACLs

The engineering corpus is a Google **Shared Drive** (not My Drive).
Consequences baked into the code:
- Shared-drive contents are NOT returned by the default file listing —
  queries pass `corpora='drive', driveId=<id>` (in `drive.py`).
- The reader credential uses scope `drive.readonly`; the writer
  (`draft.py` / `fetch.py`) uses `drive`. The real boundary is Google's
  folder ACLs: the SA is Viewer on the read folders, Editor only on
  `drafts/`. Verified: a write into `specs/` is denied HTTP 403.
- PDFs are surfaced as links, not extracted (per CLAUDE.md). Uploaded
  `.docx` (e.g. templates) ARE read, via python-docx.

Would reconsider when: the corpus moves off Shared Drives, or per-file
provenance needs change.

## 2026-06-01 — Exa as the single web-search provider

Considered: Tavily (the brief's default), Brave.

Picked Exa for technical/datasheet-oriented search. It is the agent's
ONE outbound capability; egress is to `api.exa.ai` only (via httpx, no
SDK). Every result carries its source URL so the agent cites it with a
verify-before-relying note.

Would reconsider when: Exa's result quality or cost stops fitting parts
research.

## 2026-06-01 — Drafts: Markdown → HTML → Drive convert, not Docs-API template fill

Considered: (A) placeholder-copy — tokenize templates with `{{FIELDS}}`,
copy the template file, fill via the Docs API (preserves the template's
exact formatting); (B) structured rebuild — agent emits Markdown, render
to a formatted Doc.

Picked (B), at the user's choice: the agent drafts in Markdown,
`draft.py` converts it to HTML, and Drive's importer turns that into a
real Doc (headings, bold, lists, tables). Drive API only — no Docs API,
no extra scope, no template re-authoring.

Cost: styling is Google Docs' default heading styles, not the source
template's fonts/branding. Acceptable — the human edits in Drive anyway.

Would reconsider when: exact-template fidelity matters — then switch to
placeholder-copy (templates gain `{{tokens}}`, fill via the Docs API).

## 2026-06-01 — Robust answer extraction from PydanticAI runs

PydanticAI's `result.output` is only the LAST text part. The agent often
writes its full answer, THEN calls `add_kb` and signs off — so `.output`
silently drops the real answer. Fix, in `agent.py`:
- `_join_text(all_messages)` for Q&A (`ask`, `chat`) — concatenate every
  assistant text block so the answer is never lost.
- `_longest_text(...)` for drafting — take the single dominant block,
  dropping interim chatter ("I'll find the template first…") that would
  otherwise leak into the document.

Would reconsider when: a PydanticAI upgrade changes the message/usage shape.

## 2026-06-03 — `eng-chat`: conversational REPL with token feedback

`make eng-chat` is an interactive multi-turn REPL. Context persists
across turns via PydanticAI `message_history` (in-memory only; gone on
exit — durable facts belong in the KB). Per-turn + session token usage
prints after each answer (input/output/total + cache-read). Read-only
reasoning, same tools as `eng-ask`.

`chat()` lives in `engineering/chat.py`, NOT `agent.py`, so the reasoning
module never imports the write/egress path.

Would reconsider when: we want persistent history or a non-terminal chat
surface.

## 2026-06-03 — Spec download into drafts/: separate egress module, agent proposes only (DELIBERATE egress override)

The user wanted the agent to store a web-found datasheet into `drafts/`
after approval. This collides with CLAUDE.md's egress invariant ("egress
restricted to the search provider only").

Picked a design that overrides egress narrowly while preserving the
read-only-reasoning and governed-autonomy invariants:
- The agent gets a PROPOSE-ONLY tool, `request_spec_save(url, filename)`,
  that does no I/O — it only stages a request in `deps.pending_saves`.
- A separate module, `engineering/fetch.py` (`fetch_to_drafts`), performs
  the download + store. The agent never imports it and has no fetch/write
  tool.
- Two entry points to fetch.py: the standalone `eng-save-spec` command,
  and the in-`eng-chat` flow where `chat.py` asks the human y/N after the
  agent proposes, and downloads only on approval.
- Guards: http/https only, SSRF guard (rejects private/loopback hosts),
  30 MB cap, 30 s timeout, create-only into `drafts/`.

This is the ONE place egress reaches arbitrary hosts. It is intentional,
bounded, and human-gated — NOT a leak to "fix". CLAUDE.md's egress
invariant carries a sub-bullet recording this sanctioned exception
(added the same day).

Would reconsider when: we want a vendor-domain egress allowlist, or to
move the download behind the hard approval queue that arrives with
bookkeeping (Phase 2).

---

**Both agents live. The ENGINEERING agent (Phase 0/1's real target
per CLAUDE.md) is functionally COMPLETE and verified end-to-end; the
SUPPORT agent from the prior session is kept frozen alongside it.**

Engineering capabilities, all verified against the real Google Shared
Drive:

1. **Gateway / KB / Exa web research** — cited, with
   verify-before-relying notes.
2. **Drive read + inward Q&A** — finds and cites real docs; reads
   Google Docs and `.docx`; surfaces PDFs as links (no extraction).
3. **Draft creation** — `.docx` template → filled Markdown → formatted
   Google Doc in `drafts/` (headings, bold, lists, tables).
4. **Slack 👍/👎** — `post_review` feedback semantics (the draft already
   lives in Drive; the reaction just logs a verdict).
5. **Spec download** — human-approved fetch of a web datasheet into
   `drafts/` (verified: TI INA228 PDF stored as `application/pdf`).

Commands (all `make` targets):
- `eng-ask Q="..."` — one-shot Q&A.
- `eng-chat` — interactive REPL (context across turns, token usage,
  in-chat save approval). Run it in your OWN terminal — needs a live
  keyboard.
- `eng-draft TEMPLATE="..." PURPOSE="..."` — template → formatted draft
  → 👍/👎.
- `eng-save-spec URL="..."` — standalone human-run download into
  `drafts/`.
- KB: `kb-list / kb-search / kb-delete / index-docs`.

Runtime model: `gateway` + `qdrant` run always (`docker compose up -d`);
the agent is CLI-shaped (`profiles: [cli]`), one fresh container per
command, latest mounted source (rebuild only when a dependency changes).

**Open calls awaiting your decision:**

- **Git**: nothing in `orrery/` is committed yet; no remote. First
  commit is a one-line decision (offered repeatedly).
- **CLAUDE.md egress invariant**: RESOLVED (2026-06-03) — CLAUDE.md's
  egress invariant now carries a sub-bullet recording the human-invoked
  spec-download exception. (See the 2026-06-03 decision.)
- **Judgment gate**: per CLAUDE.md, the next gate is "did this actually
  help my engineering work?", NOT scope expansion. No Phase 2
  (bookkeeping / EA) until that question is answered.
- **Deploy**: still unplanned (see the noviustec notes above if/when it
  matters).

**Things that may surprise a fresh reader:**

- Two agents coexist on purpose (engineering + support). Don't collapse
  to one to match CLAUDE.md.
- The agent has NO write or network-fetch tool. Writes happen only in
  separate driver-invoked modules — `draft.py` and `fetch.py` for
  engineering, `send.py` for support — after a human gesture.
  `request_spec_save` only *proposes* a download; it does no I/O.
- The engineering corpus is a Shared Drive — Drive queries need
  `corpora='drive'`, and the read folders must be shared with the SA
  (Viewer); `drafts/` is the only Editor share.
- `chat()` is in `engineering/chat.py`, not `agent.py`, to keep the
  reasoning module clear of the write/egress path.
- `gateway/config.yaml` lists three model aliases; the agents pick one
  via `ORRERY_MODEL` (default `claude-sonnet`). Switching is one env
  var, no code change.

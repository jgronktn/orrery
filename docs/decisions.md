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

---

## Where we left off (2026-05-28, evening)

**Phase 0/1 is functionally COMPLETE** per the brief's
definition-of-done:

> The tech-support agent reads an incoming ticket, pulls relevant
> docs and prior knowledge, drafts a reply to Slack, learns from
> 👍/👎, and writes provisional notes to the vector DB.

All four steps shipped and verified:

1. **Gateway** — `make verify-gateway` routes a Claude call through
   LiteLLM, returns `pong`.
2. **Agent skeleton + read_ticket** — `make draft TICKET=t001`
   produces a friendly-thorough draft; t003 escalates correctly.
3. **Qdrant + search_docs / search_kb / add_kb** — agent
   autonomously saved a real Eero+BandSteering pattern; semantic
   search retrieved it at 0.835 cosine.
4. **Slack approval loop** — `make handle TICKET=t002` posts to
   Slack, polls reactions, fires `ReplyDispatcher.send` only on
   human 👍. Verified end-to-end with a real Slack workspace.

**Active threads (in progress, not yet integrated):**

- **`post_review` semantics on `ApprovalSurface`**: a new method
  for posting an artifact for FEEDBACK rather than a send-gate.
  Use case is the engineering agent — drafts already live in
  Drive, Slack 👍/👎 just logs reviewer verdict. Stubs added to
  `base.py`, `console.py`, `slack.py`. Not yet wired into a
  driver.
- **Second function agent (engineering)**: scaffolding started.
  `ORRERY_ENG_AGENT_MD` config path added. `.env.example`
  reserves slots for `EXA_API_KEY`, `ORRERY_ENG_DRIVE_FOLDER_ID`,
  `ORRERY_ENG_DRAFTS_FOLDER_ID`. No agent module yet, no tools,
  no Drive integration. This is **Phase 2 territory** per the
  brief's "no second agent yet" rule — entering it deliberately,
  not by accident.

**Open calls awaiting your decision:**

- **Git**: nothing in `orrery/` is committed yet. No GitHub repo
  exists. First commit + remote setup is a one-line decision.
- **Deploy**: the brief mentioned eventual deploy to the noviustec
  cloud server as "separate processes". Not planned yet. Would
  need: new systemd unit (or `docker compose` as a systemd
  service), new `.env` on the host, port hygiene (gateway 4000 +
  qdrant 6333/6334 don't collide with noviustec-api 3000), and a
  decision about whether the deploy user is `noviustec`, a new
  `orrery` user, or something else.
- **Engineering agent shape**: post_review + Drive + Exa is the
  rough sketch from your file edits. Full design — what does the
  engineering agent DO, what's the artifact, what's a "review"
  outcome — not yet articulated to me.

**Files that may surprise a fresh reader:**

- `agent/src/orrery_agent/send.py` looks like it belongs under
  `tools/`. It doesn't. That's the invariant — see the 2026-05-28
  decision above.
- `sent_replies/` and `logs/` are runtime output, gitignored, but
  the dirs themselves get auto-created by `make handle`.
- `gateway/config.yaml` lists three model aliases (`claude-opus`,
  `claude-sonnet`, `claude-haiku`) but the agent is hardcoded to
  `claude-sonnet` via `ORRERY_MODEL` env. Switching models is one
  env var, no code change.

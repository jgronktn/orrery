# Orrery

Internal AI-agent system for a small hardtech company. Orrery is a
**monorepo web application**: function-scoped agents (an **engineering** agent
and a cross-function **executive assistant** today; bookkeeping and more to
come) wrapped by a FastAPI backend and a React UI with authentication,
cross-functional projects, an activity timeline, an approval queue, and (soon)
email integration.

Three ideas shape everything:

- **The backend mediates everything.** The UI never talks to agents directly,
  and agents never talk to each other — the backend authenticates,
  permission-checks, routes, and enforces governance. Agents are stateless HTTP
  services; conversation state lives in Postgres.
- **Governed autonomy with risk classification.** Agents *find, draft, and
  propose*; the backend risk-classifies each proposal and routes it — **low**
  auto-executes, **medium/high** queue for human approval. Reasoning tools are
  read-only; writes go through bounded, human-gated paths.
- **Projects are cross-functional.** A product project engages multiple agents
  at once. The schema models that from the start, so future agents slot in
  without retrofitting.

## The agents

**Engineering** — helps with the company's engineering work, two halves:

- **Inward** — reads the company's engineering documents in the **local file
  store** (specs, SOWs, design docs, testing checklists, certifications),
  browses folders, reads documents (Markdown/Word/ODT/PDF-by-pointer and parsed
  `.eml` emails), answers with citations, and drafts new documents from
  templates into a `drafts/` folder (never overwriting originals).
- **Outward** — researches parts and vendor options via one controlled
  web-search tool (Exa), always citing sources with a "verify before relying on
  this" note. It's a *finder, not an oracle*.

Its file tools are scoped to the engineering corpus plus, inside a project
conversation, that project's folder.

**Executive Assistant (corporate)** — the cross-function "superagent." Its home
is the Corporate function, but it **reads across everything** (every function
folder + all projects + the shared knowledge base), synthesizes, and drafts
corporate documents into `corporate/drafts/` via the same propose→approve flow.
It answers at the company core (no function selected) and on the Corporate
function. (Cross-agent querying and founder/CEO/CFO role-gating are deferred
with clean seams.)

Both run as HTTP services the backend calls; engineering also has a CLI. Every
agent inherits the shared **project tools** (tasks + a structured research log).

## Document store (local filesystem, git-versioned)

Documents live on the server under `ORRERY_FILES_ROOT` (default
`/var/lib/orrery/files/`), **a git repo** — every agent write is committed.
(Migrated off Google Drive; the service account is retained only for the
upcoming Gmail integration.)

```
/var/lib/orrery/files/
├── engineering/{specs,templates,drafts,certifications,…}   # function reference + drafts
├── corporate/  bookkeeping/  shared/                        # other functions (placeholders)
└── projects/<slug>/
    ├── research-log.md                                      # structured, sectioned
    └── drafts/ engineering/ marketing/ manufacturing/ decisions/
```

Agent read tools search filenames + text content (PDFs by filename only — not
extracted). Writes are bounded: function zones (`engineering/drafts`) for
non-project work, and per-project folders gated by project membership.

## Architecture

```
┌────────────┐     ┌──────────────────┐     ┌───────────────────────┐
│  frontend  │ ──▶ │  backend (8000)  │ ──▶ │ engineering agent 8001 │
│ React+Vite │     │  FastAPI: auth,  │     │ exec-assistant   8002  │
│  (5173)    │ ◀── │  projects, gov.  │ ◀── │ (HTTP, PydanticAI)     │
└────────────┘     └────────┬─────────┘     └───────┬───────────────┘
        project tools (tasks, research log)  ▲      │
        via /internal/agent (callback token) └──────┘
                            │                       │
                   ┌────────▼────────┐   ┌──────────▼──────────┐
                   │ Postgres (5432) │   │ gateway (LiteLLM     │
                   │ users, sessions,│   │ 4000) → Anthropic    │
                   │ projects, tasks,│   │ qdrant (KB, 6333)    │
                   │ proposals       │   │ file store (git)     │
                   └─────────────────┘   │ Exa (web search)     │
                                         └─────────────────────┘
```

The backend's agent **registry** maps each `agent_id` to its service URL;
adding an agent is "register the URL + give a function its `agent_id`," no
schema change.

- **Gateway** — LiteLLM fronts Anthropic Claude; all model + embedding calls
  route through it (the API key lives in one container).
- **Knowledge base** — Qdrant with local `fastembed` embeddings.
- **Auth** — Orrery's own email/password (Argon2, server-side Postgres
  sessions), independent of Google. Gmail OAuth will be a separate, opt-in
  per-user grant — never used for login.
- **Project tools** — the agent reaches Postgres-backed state (tasks) and the
  research log only through the backend's `/internal/agent` API, authed by a
  short-lived callback token; the backend enforces which agents are engaged on
  the project.

## Repository layout (monorepo)

```
agents/
  engineering/            # the engineering agent (package: orrery_engineering)
    src/  Dockerfile  pyproject.toml  tests/
  corporate/              # the executive-assistant agent (package: orrery_corporate)
    src/  Dockerfile  pyproject.toml
  lib/                    # shared library (package: orrery_lib)
    src/                  #   schema (agent↔backend contract), gateway client,
                          #   KB wrapper, filestore (docs+git), pm (project tools)
web/
  backend/                # FastAPI app (package: orrery_backend) + alembic
  frontend/               # React + Vite + TypeScript (auth + conversation UI)
config/
  engineering/agent.md    # each agent's behavior (git-tracked, human-edited)
  corporate/agent.md
gateway/                  # LiteLLM model routing
docs/                     # architecture + decisions log
docker-compose.yml        # local dev stack
Makefile                  # ergonomic targets
```

Behavior is config (`config/<function>/agent.md`); code is code; documents live
in the file store; learned facts live in the KB. Kept separate.

## Quickstart

```bash
cp .env.example .env        # ANTHROPIC_API_KEY, EXA_API_KEY, ORRERY_SESSION_SECRET, Slack
# create the document store (default path) — owned by you on dev:
sudo mkdir -p /var/lib/orrery/files && sudo chown -R $(id -u):$(id -g) /var/lib/orrery
( cd /var/lib/orrery/files && git init -b main )

make build                  # build the agent + backend images
make up                     # gateway, qdrant, engineering, corporate, postgres, backend
npm install && npm run dev  # frontend → http://localhost:5173
```

Backend at `http://localhost:8000`, engineering agent at `:8001`, executive
assistant at `:8002`, UI at `:5173`. (The agent services run with
`restart: unless-stopped`, so they come back after a host/Docker reboot.)

The agent also has a CLI (shares the engineering image):

```bash
make ask Q="research a 10A current-sense amp with I2C output"
make chat                                    # interactive, keeps context
make draft TEMPLATE="SOW" PURPOSE="..."       # template → Markdown draft in the store
make save-spec URL="https://..." [NAME=...]   # human-invoked datasheet save
make kb-list / kb-search QUERY="..."
```

Run `make` with no args to see all targets.

## Invariants

- The backend (not the UI) enforces permissions on every request.
- Agent reasoning tools never mutate; writes go through bounded, human-gated
  paths (create-only into `drafts/`; per-project folders gated by
  `project_agents`). Every write is git-committed.
- Passwords are Argon2-hashed; sessions invalidate on password change.
- Risk classification is honest: irreversible/public actions are not low-risk
  regardless of what the agent claims.
- Web search is the agent's normal egress; one sanctioned, human-approved
  exception downloads a datasheet into `drafts/` (see `CLAUDE.md`).
- Containers run non-root; documents are owned by the host user (dev) and the
  `orrery` user (deploy). Secrets live in `.env` (gitignored), never logged.

## Status

**Built and verified:**

- **Two agents** — engineering (file-store Q&A with citations, folder browsing,
  `.eml`/`.odt` reading, Exa parts research, Markdown drafting, human-approved
  spec download; CLI + HTTP) and the cross-function **executive assistant**
  (reads across all functions + projects, drafts corporate docs).
- **Backend** (FastAPI on Postgres) — Argon2 email/password auth + sessions +
  password reset; the agent registry/routing; persisted conversations; the
  **approval queue** (risk-routed proposals, Slack notices); the
  `/internal/agent` callback API for project tools.
- **Frontend** (React+Vite+TS) — the orrery map, per-function and per-project
  pages, a **file browser** (tree + document preview, incl. Markdown/CSV/`.odt`/
  `.eml`), scrolling agent conversations in an accordion canvas, and an
  **activity timeline** (files/emails/notes/tasks/reminders/milestones; drag to
  add; emails placed by direction with "To"/"From"; hover shows days-from-now).
- **Cross-functional projects** — multi-agent schema, per-project folder trees +
  sectioned research logs, shared task + research-log tools.
- **Document store** — local filesystem with git versioning; rich cataloging
  (text extraction, keyword + vector search, email From/To/attachments).

**Next:** Gmail/email integration (inbox view, thread→project assignment,
outbound drafts); cross-agent querying for the EA + role-gating; real Postmark;
and deployment to a DigitalOcean Droplet. See `docs/decisions.md` for the
decision log and `CLAUDE.md` for the full plan.

# Orrery

Internal AI-agent system for a small hardtech company. Orrery is a
**monorepo web application**: function-scoped agents (engineering today;
bookkeeping, corporate, an executive assistant, and more to come) wrapped by a
FastAPI backend and a React UI with authentication, cross-functional projects,
an approval queue, and (soon) email integration.

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
  at once. The schema models that from the start (only engineering is wired
  today), so future agents slot in without retrofitting.

## The engineering agent (the one that's built)

Helps with the company's engineering work, two halves:

- **Inward** — reads the company's engineering documents in the **local file
  store** (specs, SOWs, design docs, testing checklists, certifications),
  answers with citations, and drafts new documents from templates into a
  `drafts/` folder (never overwriting originals).
- **Outward** — researches parts and vendor options via one controlled
  web-search tool (Exa), always citing sources with a "verify before relying on
  this" note. It's a *finder, not an oracle*.

It also has the shared **project tools** (tasks + a structured research log) it
inherits like any agent. It runs as an HTTP service the backend calls, and as a
CLI for local use.

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
│  frontend  │ ──▶ │  backend (8000)  │ ──▶ │ engineering agent     │
│ React+Vite │     │  FastAPI: auth,  │     │ (HTTP service, 8001)  │
│  (5173)    │ ◀── │  projects, gov.  │ ◀── │ PydanticAI loop       │
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
  lib/                    # shared library (package: orrery_lib)
    src/                  #   schema (agent↔backend contract), gateway client,
                          #   KB wrapper, filestore (docs+git), pm (project tools)
web/
  backend/                # FastAPI app (package: orrery_backend) + alembic
  frontend/               # React + Vite + TypeScript (auth + conversation UI)
config/engineering/agent.md   # the agent's behavior (git-tracked, human-edited)
gateway/                  # LiteLLM model routing
docs/                     # architecture + decisions log
docker-compose.yml        # local dev stack
Makefile                  # ergonomic targets
```

Behavior is config (`config/engineering/agent.md`); code is code; documents live
in the file store; learned facts live in the KB. Kept separate.

## Quickstart

```bash
cp .env.example .env        # ANTHROPIC_API_KEY, EXA_API_KEY, ORRERY_SESSION_SECRET, Slack
# create the document store (default path) — owned by you on dev:
sudo mkdir -p /var/lib/orrery/files && sudo chown -R $(id -u):$(id -g) /var/lib/orrery
( cd /var/lib/orrery/files && git init -b main )

make build                  # build the agent + backend images
make up                     # gateway, qdrant, engineering, postgres, backend
npm install && npm run dev  # frontend → http://localhost:5173
```

Backend at `http://localhost:8000`, engineering agent at `:8001`, UI at `:5173`.

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

**Built and verified:** the engineering agent (file-store Q&A with citations,
Exa parts research, Markdown drafting, human-approved spec download) as CLI +
HTTP service; the FastAPI backend (email/password auth, sessions, password
reset, agent registry/routing) on Postgres; the React frontend (auth +
project-scoped conversation canvas); cross-functional **projects** (multi-agent
schema, per-project folder trees + sectioned research logs, shared task +
research-log tools via the internal agent API); and the **approval queue**
(risk-routed proposals, pending-approvals UI, Slack notifications). Document
storage runs on the local filesystem with git versioning.

**Next:** Gmail/email integration (inbox view, thread→project assignment,
outbound drafts), a file-browser UI, and deployment to a DigitalOcean Droplet.
See `docs/decisions.md` for the decision log and `CLAUDE.md` for the full plan.

# Orrery

Internal AI-agent system for a small hardtech company. Orrery is a
**monorepo web application**: a set of function-scoped agents (engineering
today; bookkeeping, corporate, an executive assistant, and project
management to come) wrapped by a backend and UI with authentication,
projects, an approval queue, and email integration.

Two ideas shape everything:

- **The backend mediates everything.** The UI never talks to agents
  directly and agents never talk to each other — the backend
  authenticates, permission-checks, routes, and enforces governance.
  Agents are stateless HTTP services; conversation state lives in Postgres.
- **Governed autonomy.** Agents *find, draft, and propose*; a human
  reviews. Reasoning tools are read-only; the few write paths are bounded
  (a Drive `drafts/` folder, Gmail drafts) and risk-classified — low
  auto-executes, medium queues for approval, high needs explicit approval.

## The engineering agent (the one that's built)

Helps with the company's engineering work, two halves:

- **Inward** — reads engineering documents in Google Drive (specs, SOWs,
  design docs, testing checklists, certifications), answers with
  citations, and drafts new documents from templates into a `drafts/`
  folder (never overwriting originals).
- **Outward** — researches parts and vendor options via one controlled
  web-search tool (Exa), always citing sources with a
  "verify before relying on this" note. It's a *finder, not an oracle*.

It runs as an HTTP service the backend calls, and as a CLI for local use.

## Architecture

```
┌────────────┐     ┌──────────────────┐     ┌───────────────────────┐
│  frontend  │ ──▶ │  backend (8000)  │ ──▶ │ engineering agent     │
│ (React,    │     │  FastAPI: auth,  │     │ (HTTP service, 8001)  │
│  planned)  │ ◀── │  routing, gov.   │ ◀── │ PydanticAI loop       │
└────────────┘     └────────┬─────────┘     └───────┬───────────────┘
                            │                       │
                   ┌────────▼────────┐   ┌──────────▼──────────┐
                   │ Postgres (5432) │   │ gateway (LiteLLM,    │
                   │ users, sessions │   │ 4000) → Anthropic    │
                   └─────────────────┘   │ qdrant (KB, 6333)    │
                                         │ Google Drive (SA)    │
                                         │ Exa (web search)     │
                                         └─────────────────────┘
```

- **Gateway** — LiteLLM in Docker fronts Anthropic Claude; all model and
  embedding calls route through it (the API key lives in one container).
- **Knowledge base** — Qdrant with local `fastembed` embeddings.
- **Auth** — Orrery's own email/password (Argon2, server-side sessions),
  independent of Google. Gmail OAuth is a separate, opt-in per-user grant
  for email features — never used for login.

## Repository layout (monorepo)

```
agents/
  engineering/            # the engineering agent (package: orrery_engineering)
    src/  Dockerfile  pyproject.toml  tests/
  lib/                    # shared library (package: orrery_lib)
    src/                  #   schema (agent↔backend contract), gateway client,
                          #   KB wrapper, Drive service-account helpers
web/
  backend/                # FastAPI app (package: orrery_backend)
    src/  alembic/  Dockerfile  pyproject.toml
  frontend/               # React + Vite + TypeScript (planned)
config/engineering/agent.md   # the agent's behavior (git-tracked, human-edited)
gateway/                  # LiteLLM model routing
docs/                     # architecture + decisions log
docker-compose.yml        # local dev stack
.env / .env.example       # secrets (gitignored) / template
Makefile                  # ergonomic targets
```

Behavior is config (`config/engineering/agent.md`); code is code
(`agents/engineering/`); facts the agent learns live in the KB. Kept
separate.

## Quickstart

```bash
cp .env.example .env        # fill in ANTHROPIC_API_KEY, EXA_API_KEY,
                            # ORRERY_SESSION_SECRET, Drive folder ids, Slack
# put the Google service-account JSON at ./service-account.json (gitignored)

make build                  # build the agent + backend images
make up                     # start gateway, qdrant, engineering, postgres, backend
make ps                     # health of all services
```

Backend at `http://localhost:8000`, engineering agent at `:8001`.

```bash
# auth + a project-less agent run, end to end
curl -c /tmp/j -X POST localhost:8000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"supersecret123","display_name":"You"}'
curl -b /tmp/j localhost:8000/api/agents
curl -b /tmp/j -X POST localhost:8000/api/agents/engineering/run \
  -H 'Content-Type: application/json' \
  -d '{"query":"What relay do we have a spec for?"}'
```

The agent also has a CLI (shares the engineering image):

```bash
make ask Q="research a 10A current-sense amp with I2C output"
make chat                                    # interactive, keeps context
make draft TEMPLATE="SOW" PURPOSE="..."       # template → formatted Drive doc
make save-spec URL="https://..." [NAME=...]   # human-invoked datasheet save
make kb-list / kb-search QUERY="..." / index-docs
```

Run `make` with no args to see all targets.

## Invariants

- The backend (not the UI) enforces permissions on every request.
- Agent reasoning tools never mutate; writes go through bounded,
  human-gated paths and create-only into `drafts/` (Drive's own
  permissions back this up — the service account is Editor only there).
- Passwords are Argon2-hashed; sessions invalidate on password change.
- Risk classification is honest: irreversible/public actions are not
  low-risk regardless of what the agent claims.
- Web search is the agent's normal egress; one sanctioned exception lets a
  *human-approved* datasheet download land in `drafts/` (see CLAUDE.md).
- Secrets live in `.env` (gitignored); never committed, never logged.

## Status

Built and verified: the engineering agent (Drive Q&A, parts research,
template drafting, human-approved spec download) as both CLI and HTTP
service; the FastAPI backend (email/password auth, sessions, password
reset, agent registry + routing) on Postgres.

Next: the React frontend + conversation flow, projects, the approval
queue, and Gmail/email integration. See `docs/decisions.md` for the
decision log and `CLAUDE.md` for the full build plan and scope.

# CLAUDE.md — project guide for Claude Code

## What this is

**Orrery** — an internal AI-agent system for a tiny hardtech company. A
coordinated set of function-scoped agents (engineering today; bookkeeping,
corporate, executive assistant, project management to come), plus a web UI and
backend that wraps them in a user-facing application with authentication,
projects, an approval queue, and email integration.

This is a **monorepo** — agents and web app live in one project tree, share
common Python utilities, and are orchestrated together. Within the repo, agents
are HTTP services; the web backend mediates all communication.

Bias toward less. Resist scope creep. Pause after each step.

## Repository layout (the Orrery monorepo)

```
orrery/                          # this repo, ~/code/orrery/
├── agents/
│   ├── engineering/             # the engineering agent (Phase 1, exists)
│   │   ├── pyproject.toml
│   │   ├── Dockerfile
│   │   └── src/
│   ├── lib/                     # Python utilities shared across agents
│   │   ├── pyproject.toml
│   │   └── src/                 # gateway client, KB wrapper, Drive helpers,
│   │                            # agent response schema, proposal types
│   └── (future: bookkeeping/, corporate/, ea/, pm/)
│
├── web/
│   ├── backend/                 # FastAPI app (auth, projects, routing,
│   │   ├── pyproject.toml       # approvals, email, agent registry)
│   │   ├── alembic/             # database migrations
│   │   └── src/
│   └── frontend/                # React + Vite + TypeScript
│       ├── package.json
│       └── src/
│
├── infra/                       # orchestration & deployment
│   ├── docker-compose.yml       # full local dev stack
│   ├── docker-compose.prod.yml  # Droplet deployment (later)
│   └── .env.example
│
├── config/
│   └── engineering/agent.md     # engineering agent's behavior config
│
├── docs/                        # architecture, decisions, diagrams
│
├── pyproject.toml               # uv workspace root
├── package.json                 # pnpm/npm workspace root (for frontend)
└── README.md
```

- The agent's **behavior** config (markdown) lives in `config/`, not under
  `agents/`. The agent's **code** lives under `agents/engineering/`. Behavior
  is config; code is code; keep them separate.
- The **shared agent library** at `agents/lib/` holds anything more than one
  agent needs: the LiteLLM gateway client, the KB (Qdrant) wrapper, the Drive
  service-account helpers, the agent response schema, the proposal/risk types,
  the embedding model pin. Each agent imports from `agents/lib` rather than
  re-implementing.
- The **agent response schema** (text + artifacts + proposals) is defined ONCE
  in `agents/lib/` and imported by both the agents and the web backend. The
  frontend gets TypeScript types generated from FastAPI's OpenAPI export.

## The destination (context only — do NOT build all of this now)

Long-term, Orrery serves multiple agents and multiple users with per-user
permissions. Navigation is project-primary: users think in projects, agents are
tools that help. Email is integrated via opt-in assignment. Governance is
risk-classified, not all-or-nothing. Everything later is added *to* this shape,
not a redesign of it.

## Principles — honor even in the minimal version

1. **Project-primary navigation** — users work in project context, not agent
   context. UI leads with projects; agent selection is secondary or automatic.

2. **Governed autonomy with risk classification** — agents propose with risk
   tags (low/medium/high); backend routes accordingly. Low auto-executes,
   medium queues for approval, high requires explicit approval. Don't
   gatekeep everything; do gatekeep what matters.

3. **Backend mediates everything** — UI never talks to agents directly;
   agents never talk to each other directly. Backend authenticates,
   permission-checks, routes, and enforces governance. This is the air gap
   that keeps the system honest.

4. **Email is opt-in via UI assignment** — agents never read Gmail on their
   own. Users see their inbox in the UI; they assign threads to projects; only
   then does content flow into the system.

## Authentication — own login, NOT Google OAuth

Orrery has its own authentication, independent of Google identity:

- Users sign up / are invited with **email + password**.
- Passwords stored as **Argon2** hashes (with salts); never plaintext, never
  logged.
- Sessions: server-side, stored in Postgres, referenced by a signed session
  cookie (HttpOnly, Secure, SameSite=Lax). Sliding expiration.
- Password reset flow: signed time-limited token sent via email.
- MFA optional later (TOTP); design schema to support it, don't build it yet.

**Why this matters and what it implies:**

- Users are NOT tied to any Google identity. Anyone the admin invites can use
  Orrery regardless of whether they have a Google account.
- Each user record holds: id, email, display_name, password_hash, role,
  project memberships, agent permissions, MFA fields (nullable), timestamps,
  status (active/disabled).
- **Gmail OAuth is SEPARATE** and is not used for login. It's a per-user
  *authorization grant* for the system to access that user's inbox (read) and
  drafts (write), only after they explicitly connect Gmail in their profile.
  Users who don't want email features simply don't connect Gmail.
- Google Workspace integration on the agent side (the engineering agent's
  Drive access via service account) is unchanged and unrelated to user login.

## Invariants — enforce these in code, always

- **The backend, not the UI, enforces permissions.** Every API call checks the
  authenticated user's access to the requested project/agent/resource. Never
  trust the UI to gatekeep.
- **Passwords are Argon2-hashed**, never stored plaintext, never logged.
  Sessions invalidate on password change.
- **Agents are HTTP services**; the backend is the only thing that calls them.
  Agents are stateless from the backend's perspective — conversation state
  lives in Postgres.
- **Agent read tools never mutate.** Mutations go through the approval flow
  or bounded write paths (Drive's `drafts/`, Gmail drafts folder).
- **Per-user Gmail tokens encrypted at rest** and never logged. Treat email
  content as the most sensitive data in the system.
- **Risk classification is honest.** If an action is irreversible or public,
  it's not low-risk regardless of what the agent claims. Override the agent's
  classification if needed.
- **Email content only enters the system at user assignment time** — never
  via background polling or unsolicited reads.
- **Secrets live in `.env`** (gitignored) or a secrets file. Never hardcoded,
  never logged, never committed.

## Scope — build ONLY this (for the current build phase)

- **Auth**: email/password registration & login with Argon2, server-side
  sessions, password reset via email. Per-user records (role, project
  memberships, agent permissions). Separate Gmail OAuth flow available in user
  profile (not used for login).
- **Projects as first-class entities**: Postgres schema, UI for create/list/
  select, project membership, tasks table (minimal UI; schema ready for the
  future PM agent).
- **Conversation flow**: state keyed on (user, agent, project); ask box,
  response in canvas; structured agent responses (text + artifacts +
  proposals).
- **Approval queue**: proposals table, risk-classified routing (low auto,
  medium queue, high elevated), pending-approvals UI, Slack notifications.
- **Email**: Gmail inbox view (after user connects Gmail), thread assignment
  to projects, KB ingestion at assignment time, un-assign action. Outbound
  drafting via Gmail drafts folder.
- **Multi-agent foundation**: agent registry, backend routing, agent selector
  (override) in UI. Engineering agent only for now; design the multi-agent
  pattern, exercise just one.
- **Layout**: header banner; left-upper = pending approvals; left-lower =
  projects + ask box; right = canvas (conversation, artifacts, project view,
  email view, document preview).

## Existing engineering agent — what needs to change

Currently runs as a CLI (`make chat`). Wrap it in an HTTP service:
- Accept JSON requests with (query, conversation_history, project_context).
- Run its loop on that request.
- Return structured response: `{text, artifacts[], proposals[]}`.
- Be stateless — conversation state lives in the backend, not the agent.

Tools, KB, Drive integration, gateway routing — unchanged. Only the entry
point changes. CLI mode can stay for local testing alongside HTTP mode.

The agent's relocation to `agents/engineering/` should preserve git history
where possible (use `git mv` or copy with intent).

## Do NOT build yet — deferred to later phases; leave seams, not implementations

- **No second agent.** Bookkeeping, corporate, EA, project management — later.
  Registry supports them; only engineering is wired up.
- **No agent-to-agent execution.** Design the backend-mediated pattern; don't
  exercise it (the EA needs it, and the EA doesn't exist).
- **No MFA.** Schema supports it (nullable fields); don't implement.
- **No SSO.** Stick to email/password.
- **No deployment automation.** Local docker compose only. Droplet deployment
  is a later concern; `docker-compose.prod.yml` is a stub for now.
- **No mobile or desktop app.** Web browser only.
- **No advanced PM features.** Tasks schema is ready; UI is minimal. Full PM
  arrives with the PM agent.
- **No real-time multi-user features.** No presence, no live cursors, no
  collaborative editing.
- **No analytics or reporting dashboards.**
- **No real-time streaming (SSE/WebSockets) yet.** HTTP request/response is
  enough until it isn't.

If a task tempts you toward any of the above, **stop and ask** — it is almost
certainly out of scope for this phase.

## Tech stack (default; ask if you'd prefer different)

- **Backend**: Python 3.12 + FastAPI
- **Frontend**: React + Vite + TypeScript
- **Database**: PostgreSQL
- **ORM / migrations**: SQLAlchemy + Alembic
- **Auth**: Argon2 (via `argon2-cffi`) for password hashing; server-side
  sessions in Postgres; signed cookies (`itsdangerous` or similar)
- **Email sending** (for password reset, eventually notifications): Postmark
  (already in use)
- **Styling**: Tailwind CSS; component primitives optional (shadcn/ui or bare)
- **Agent comms**: HTTP from backend to agent containers
- **Python workspace**: uv with a workspace root `pyproject.toml`
- **Frontend workspace**: pnpm (or npm) workspaces
- **Orchestration**: docker compose

## Conventions

- Stack: Ubuntu 24.04, Docker + docker compose, Python 3.12, Node 20+, VS Code.
- Type hints everywhere on Python; TypeScript strict mode on frontend.
- Generate TypeScript types from FastAPI's OpenAPI schema; do not maintain
  parallel type definitions by hand.
- Small focused files; readable by someone who didn't write them.
- This file (`CLAUDE.md`) at the repo root is your instructions as the coding
  assistant. The engineering agent's `config/engineering/agent.md` is the
  agent's behavior. Different things, different scope.

## How to work

- Build incrementally; explain choices briefly.
- **Ask before assuming** any credential, service detail, or design choice
  not specified above.
- Recommended order:
  1. Reorganize the existing agent into `agents/engineering/`; verify it still
     runs via its existing CLI and Docker setup. PAUSE.
  2. Set up the workspace structure (root pyproject.toml, shared `agents/lib/`,
     `web/backend/` skeleton). PAUSE.
  3. Backend skeleton + Postgres + email/password auth (register, login,
     session, password reset). Minimal frontend just to confirm login works.
     PAUSE.
  4. Wrap the engineering agent in an HTTP service. Backend can send a query
     and get a response (verified via curl). PAUSE.
  5. Frontend skeleton + conversation flow. Layout (header, left/right split,
     ask box, canvas). Single agent, no project context yet. PAUSE.
  6. Projects schema + UI. Conversation state keyed on (user, agent, project).
     PAUSE.
  7. Approval queue + risk classification. Slack notifications. PAUSE.
  8. Per-user Gmail OAuth (connect-in-profile flow) + inbox view. No
     assignment yet. PAUSE.
  9. Email assignment flow (KB ingestion on assign, un-assign action). PAUSE.
  10. Outbound email drafting via Gmail drafts. PAUSE.
  11. Structured artifacts in the canvas (tables, document previews). DONE.
- **Pause after each step** for me to verify. Don't run ahead.
- When unsure whether something is in scope, prefer the smaller option and ask.

## Definition of done (this phase)

A signed-in user can:
- Register, log in, reset their password (no Google account required).
- See and manage their projects.
- Have a project-scoped conversation with the engineering agent.
- See pending approvals and resolve them.
- Optionally connect their Gmail in their profile; see their inbox in the UI;
  assign threads to projects; the agent answers about assigned email content.
- Ask the agent to draft an outbound email; the draft appears in their Gmail
  drafts folder.
- Use a "global" context (no project) where queries go to engineering
  (placeholder for the future EA agent).

The whole thing runs in `docker compose up` from `infra/` locally.
Deployment to the DigitalOcean Droplet is a later step, not part of this phase.

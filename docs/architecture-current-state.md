# Orrery — Current Architecture (as-built)

_Generated 2026-06-22 from a read of the actual code. Describes what exists today, not the long-term design. Inconsistencies and half-built seams are flagged in the last section._

## Overview

Orrery is a monorepo "company operating system": a **React frontend** → **FastAPI backend** (the only thing that talks to anything privileged) → a **stateless PydanticAI engineering agent** that reaches Claude through a **LiteLLM gateway**, with **Postgres** for relational state, **Qdrant** for vector search, and a **git-versioned file store** (`ORRERY_FILES_ROOT`) shared between the backend and the agent.

The core domain idea: a **Function** (Corporate, Engineering, IT, HR, Accounting) is a first-class *container* that owns a folder, a timeline, files, and facets — independent of whether an **Agent** occupies it. Functions and **Projects** are both stored as rows in one `projects` table, discriminated by a `kind` column. Today only Engineering has a live agent ("Forge", registry id `engineering`).

---

## 1. System topology / deployment

```mermaid
flowchart LR
  browser["Browser — React/Vite SPA :5173"]

  subgraph backendsvc["backend (FastAPI :8000)"]
    api["/api/* routers + /internal/agent/*"]
  end

  subgraph agentsvc["engineering agent (FastAPI :8001)"]
    agentloop["PydanticAI loop + tools"]
  end

  gateway["gateway — LiteLLM :4000"]
  anthropic["Anthropic API"]
  pg[("Postgres :5432")]
  qdrant[("Qdrant :6333 — documents · docs · learnings")]
  files[["ORRERY_FILES_ROOT — /var/lib/orrery/files (git repo, shared volume)"]]
  slack["Slack (optional)"]

  browser -->|"HTTPS /api (session cookie)"| api
  api -->|SQLAlchemy| pg
  api -->|"POST /run, /execute"| agentloop
  agentloop -->|"/internal/agent/* (callback token)"| api
  agentloop -->|"OpenAI-shape"| gateway
  gateway --> anthropic
  agentloop -->|"embed + search"| qdrant
  api -->|"index/search/delete chunks"| qdrant
  api -->|"read/write + git commit"| files
  agentloop -->|"read + draft/spec writes"| files
  api -.->|"approval notices"| slack
```

**Docker services** (`docker-compose.yml`): `gateway` (LiteLLM), `qdrant`, `engineering` (agent HTTP :8001), `postgres:16`, `backend` (:8000), and an `agent` CLI profile (same image as `engineering`). The frontend dev server (Vite :5173) runs outside compose and proxies `/api` to the backend. `backend` and `engineering` both bind-mount `/var/lib/orrery/files` read-write; Qdrant and Postgres use named volumes.

---

## 2. Backend route families

```mermaid
flowchart TB
  subgraph user["Session-cookie auth (current_user)"]
    auth["/api/auth — register · login · logout · me · password-reset"]
    projects["/api/projects — projects, members, tasks, timeline, docs, search, facets, task attachments"]
    functions["/api/functions — list/get function, tree, search, timeline, documents, folders (create/delete)"]
    home["/api/home — company dashboard: functions + union timeline + approvals + identity"]
    agents["/api/agents — registry, run (stateless), messages (persisted convo), proposal routing"]
    approvals["/api/approvals — list, approve (execute), reject"]
    files["/api/files — raw, text, rename, move, delete (risk-routed)"]
  end
  subgraph internal["Callback-token auth (X-Agent-Callback, 600s TTL)"]
    iagent["/internal/agent — tasks (CRUD), task docs, research-log read/append"]
  end

  agents -->|"HTTP POST /run, /execute"| ENG["engineering agent"]
  ENG -->|"calls back"| iagent
  approvals --> CP["commit_path.execute_file_op (FILE_OPS)"]
  files --> CP
  functions --> CP
  agents --> GOV["governance.classify → risk floor"]
```

| Router | Owns |
|---|---|
| `auth.py` | Email/password identity, Argon2 hashes, server-side sessions (sliding 14-day), password reset (token emailed — see flags). |
| `projects.py` | Project lifecycle + membership; the shared `get_container()` (resolves project membership OR function access); tasks (action items/reminders/milestones); the unified `build_timeline`; per-container search; document drop; task↔document attachments. |
| `functions_api.py` | Function-as-container ops: tree, search, timeline, document drop (with `dir`), and **folder create/recursive-delete** (risk-routed); plus `/api/home`. |
| `agents.py` | Agent registry (only `engineering`), stateless `/run`, persisted conversations (`messages`), and **proposal routing** (classify → low auto-executes, medium/high queue). |
| `approvals.py` | The human approval queue. On approve: `FILE_OPS` execute locally via `commit_path`; agent proposals delegate to the agent's `/execute`. |
| `files.py` | Read (`raw`/`text`) + human file mutations (rename/move/delete), all risk-routed by destination path. |
| `internal.py` | The agent's callback surface (tasks, task-doc links, research-log) — guarded by a short-lived signed callback token + an "agent engaged on this container" check. |

---

## 3. Data model

```mermaid
erDiagram
  USER ||--o{ SESSION : has
  USER ||--o{ PASSWORD_RESET_TOKEN : has
  USER ||--o{ PROJECT_MEMBER : "joins"
  USER ||--o{ PROJECT_AGENT : "added_by"
  USER ||--o{ CONVERSATION : owns
  USER ||--o{ PROPOSAL : raises
  USER ||--o{ CATALOG : uploads

  PROJECT ||--o{ PROJECT_MEMBER : "has members"
  PROJECT ||--o{ PROJECT_AGENT : "has agents"
  PROJECT ||--o{ PROJECT_MEMBER_AGENT : "per-user perms (unused)"
  PROJECT ||--o{ TASK : "has"
  PROJECT ||--o{ CONVERSATION : "scopes"
  PROJECT ||--o{ CATALOG : "container (nullable)"
  PROJECT ||--o{ PROPOSAL : "scopes (nullable)"

  TASK ||--o{ TASK_DOCUMENT : "attachments"
  CONVERSATION ||--o{ MESSAGE : "ordered"
  CONVERSATION ||--o{ PROPOSAL : "from (nullable)"

  PROJECT {
    uuid id
    string name
    string slug "unique"
    string kind "project | function_stream"
    string function "fn key, set for streams"
    uuid created_by "NULL for streams"
    bool archived
    datetime last_synthesized_at "written? see flags"
  }
  CATALOG {
    uuid id
    string path "unique, FILES_ROOT-relative"
    string container_kind "project | function"
    uuid container_id "NULL for function files"
    string function
    string sub_function "facet"
    string type
    string source "scan|timeline_drop|upload|email|agent"
    bool on_timeline
    string synthesized "pending | synthesized"
    text extracted_text
  }
  TASK {
    uuid id
    string title
    string kind "task | milestone | reminder"
    string status
    string facet
    date due_date
    string synthesized
  }
  PROPOSAL {
    uuid id
    string agent_id
    string kind
    string risk "low | medium | high"
    string status "pending|executed|rejected|failed"
    json payload
  }
  MESSAGE {
    uuid id
    string role "user | assistant"
    text content
    json artifacts
    json proposals
  }
```

Tables: `users`, `sessions`, `password_reset_tokens`, `projects`, `project_members`, `project_agents`, `project_member_agents`, `tasks`, `task_documents`, `conversations`, `messages`, `proposals`, `catalog`. All child rows cascade-delete from their parents. **`catalog`** is the universal file index — `container_id` is NULL for function-folder files (scoped instead by `container_kind="function"` + `function`).

---

## 4. Container model — Function · Agent · Project

```mermaid
flowchart TB
  subgraph reg["functions.py registry (ACTIVE_FUNCTIONS)"]
    corp["corp · Corporate · folder corporate · agent: none · facets: ip,equity,financial,governance,contracts"]
    engr["engr · Engineering · folder engineering · agent: engineering · facets: specs,drafts,templates,design-docs,certifications,contractors,archive"]
    it["it · IT · folder it · agent: none · facets: ()"]
    hr["hr · HR · folder hr · agent: none · facets: ()"]
    acct["acct · Accounting · folder accounting · agent: none · facets: ()"]
  end

  engr -->|agent_for_function| FORGE["engineering agent service"]

  subgraph proj["projects table (one shape, two kinds)"]
    stream["kind=function_stream — one row per function, function=key, created_by=NULL, slug=key"]
    project["kind=project — user-created, slug, ProjectMember + ProjectAgent rows"]
  end

  reg -. "provisioned at startup as" .-> stream
  getc["get_container(id, user) — resolves either kind"] --> stream
  getc --> project
```

A **function stream** is just a `projects` row with `kind="function_stream"`, `created_by=NULL`, and `function` = the registry key; it has no `ProjectMember` rows (access is by function-level permission, currently "any authenticated user"). A **project** is user-created with explicit members and one or more attached agents. The same endpoints serve both via `get_container()`. An agent attaches to a function purely through the registry's `agent_id`; standing up a second agent later is "fill in `agent_id` + register the service," no schema change.

**Governed mutation flow** (shared by humans and the agent):

```mermaid
flowchart LR
  src1["human: /api/files or /api/functions/.../folders"] --> route
  src2["agent: Proposal in AgentResponse"] --> classify["governance.classify (honest risk floor)"]
  classify --> route["route_*_op — path risk floor"]
  route -->|low| exec["execute now + git commit"]
  route -->|medium/high| queue["ProposalRecord (pending) + Slack notice"]
  queue --> approve["/api/approvals/:id/approve"]
  approve --> exec
  exec --> tier0["Tier 0: catalog row + text extract (sync)"]
  tier0 --> tier1["Tier 1: chunk + embed → Qdrant documents (background)"]
```

Sensitive destinations (`corporate/equity/`, `corporate/financial/debt/`) and `save_spec` force at least medium risk, queueing for approval regardless of what the caller claims.

---

## 5. Engineering agent + web↔agent round trip

The agent (`agents/engineering`, FastAPI :8001) exposes `GET /health`, `POST /run` (`AgentRequest → AgentResponse`), and `POST /execute` (bounded write after approval). It's a **PydanticAI** loop whose model is built by `orrery_lib.gateway` against the LiteLLM gateway. Behavior lives in `config/engineering/agent.md` (loaded at startup).

**Tools** (`agents/engineering/.../agent.py` + `orrery_lib/pm.py`):
- Read-only: `search_files`, `read_file`, `search_docs` (Qdrant `documents`), `search_kb` (Qdrant `learnings`), `add_kb` (proposal-queue only), `web_search` (Exa).
- Proposal-only writes: `request_spec_save` (stages a URL; no I/O) and draft creation (separate module). The agent never writes the file store directly during reasoning.
- Project-scoped (only when a `callback` is present): `list/create/update task`, `link_task_to_doc`, `read/append research-log` — all HTTP calls back into `/internal/agent/*`.

**Round trip:** Frontend `POST /api/agents/engineering/messages` → backend builds `AgentRequest` (history + `project_context` + a signed `AgentCallback` when project-scoped) → `POST http://engineering:8001/run` → agent runs, optionally calling back into `/internal/agent/*` with the token → returns `AgentResponse{text, artifacts, proposals}` → backend classifies/routes proposals and persists the conversation. `orrery_lib` also holds the shared `schema` (AgentRequest/Response, Proposal, Artifact), `kb`, `docstore` (the `documents` collection, 1:1 with files), and `filestore` (git-committed reads/writes). Embeddings: `BAAI/bge-small-en-v1.5` (384-dim), pinned in payloads.

---

## 6. FILES_ROOT layout (actual, on disk)

```mermaid
flowchart TB
  root[["/var/lib/orrery/files (.git repo)"]]
  root --> engineering["engineering/ — specs, drafts, templates, design-docs, certifications, contractors, archive, attachments, testing*"]
  root --> corporate["corporate/ — IP*, contracts, equity, financial, governance"]
  root --> accounting["accounting/ — statements*"]
  root --> it["it/ (empty, .gitkeep)"]
  root --> hr["hr/ (empty, .gitkeep)"]
  root --> projects["projects/"]
  root --> shared["shared/ * (not a registered function)"]
  projects --> p1["condensate-probe/ — research-log.md + SUBDIRS + attachments/"]
  projects --> p2["leak-sensor/ — research-log.md + SUBDIRS + attachments/"]
```

Function folders mirror the registry (`engr`→`engineering`, `acct`→`accounting`). Each project gets `research-log.md` + the cross-functional `SUBDIRS` (drafts, engineering, marketing, manufacturing, decisions) + an `attachments/` drop folder. Folders marked `*` are real on disk but **not** in the declared facet vocabulary (they exist because folders are now free-form). The whole tree is one git repo; every add/move/delete is a commit. `.gitkeep`, `.git`, `.DS_Store`, and `attachments/` are skipped by the scanner.

---

## 7. Frontend structure

```mermaid
flowchart TB
  main["main.tsx → BrowserRouter + AuthProvider"] --> app["App.tsx (routes)"]
  app -->|"/"| home["CompanyHome"]
  app -->|"/fn/:key"| fn["FunctionStream"]
  app -->|"/project/:id"| pv["ProjectView (STUB)"]
  app -->|unauth| login["LoginPage"]

  home --> map["OrreryMap"]
  home --> ffiles["FunctionFiles (filesystem panel)"]
  home --> fview["FileViewer"]
  home --> rail["RightRail: TimelinePanel · ApprovalsPanel · AskBar"]
  fn --> ftl["FunctionTimeline"]
  fn --> rail
  map --> ftlmini["FunctionTimeline (compact, in rail)"]

  client["api/client.ts (typed fetch)"] --> types["api/types.ts (generated from OpenAPI)"]
  home --> client
  fn --> client
```

The live UI is the warm-paper set under `src/app/orrery/` (`Shell`, `CompanyHome`, `OrreryMap`, `FunctionFiles`, `FileViewer`, `FunctionStream`, `FunctionTimeline`, `RightRail`, `ProjectView`, plus `theme/time/timelineScale`). `api/client.ts` is a thin typed fetch layer over `api/types.ts`, which is generated from the backend's OpenAPI (`npm run gen:types`). Routes: `/` = Company Home (orrery map + file panel + right rail), `/fn/:key` = Function page (250px timeline + composer + 25% approvals/ask sidebar), `/project/:id` = **stub**.

---

## 8. Flags — half-built, deferred, or inconsistent

**Stubs / not wired**
- **ProjectView** (`/project/:id`) is a placeholder — the route renders "a later increment." Project Views are linked to from the map/function rows but lead nowhere real yet.
- **Knowledge synthesis** (Tier 2): `Catalog.synthesized`, `Task.synthesized`, `Project.last_synthesized_at` are written (set to `pending` on edits) but **no pass ever reads them** — no synthesizer exists. `pending_synth_count` drives the Home "N pending" badges off data nothing consumes.
- **Email**: only a console sender exists; password-reset links are logged, not sent (Postmark deferred).
- **Google Drive**: `orrery_lib/drive.py` and `ORRERY_ENG_DRIVE_*` env vars exist but are unused (Phase-1 uses the local git store).
- **MFA**: `User.mfa_*` columns exist, never enforced.
- **Per-user agent permissions**: `project_member_agents` (`can_talk`/`can_approve`) table exists but is never checked — "any authenticated user may use engineering."

**Inconsistencies**
- **Company name**: frontend hardcodes `"PPI"` (CompanyHome/FunctionStream/ProjectView) while the backend `config.company_name` is `"Orrery"` and `/api/home` returns it — the UI ignores the backend value.
- **Facet vs folder case**: corp's facet is `ip` (lowercase) but the on-disk folder is `corporate/IP` (uppercase) — move-target validation is case-sensitive, so this folder isn't a valid facet target.
- **Stray on-disk dirs**: a top-level `shared/` exists but is **not** a registered function (orphan); `engineering/testing` and `accounting/statements` are real folders outside the declared facet lists (legitimate now that folders are free-form, but they won't appear as facet chips).
- **Sensitive-prefix mismatch**: the risk floor watches `corporate/financial/debt/`, but the on-disk folder is just `corporate/financial` (no `debt` subfolder) — the guard currently matches nothing real.
- **Project uploads** are always tagged `function="engr"` (`_PROJECT_FUNCTION` hardcoded); cross-functional per-file tagging is deferred.
- **Upload-path facets**: `commit_path.add_file` never sets `sub_function`; only `scan.py` derives facets from paths, so manually-uploaded files lack a facet until a rescan.

**Dead code / cleanup**
- The entire **old frontend** under `src/app/` is unreachable: `Workspace`, `Timeline`, `TimelinePlot`, `Tasks`, `TaskAttachments`, `FsExplorer`, `FilePreview`, `Projects`, `Messages`, `Approvals`, `SearchBox`, `constants`, and `fsEngine.ts` (~28 KB) — none imported by any live route.
- Backend `projectstore.save_upload` / `delete_upload` are defined but uncalled (superseded by `commit_path`).

**Rough edges (work, but worth noting)**
- Agent **artifacts** are modeled end-to-end but the agent never emits any (proposals are the real write surface).
- Deleting a conversation message doesn't clean up any proposals it spawned.
- Callback-token TTL (600s) and the risk-floor table are hardcoded (not config).
- The agent image is shared between the HTTP service and a CLI profile via compose entrypoint overrides — works, but implicit.
- `CLAUDE.md` describes an `infra/docker-compose.yml`; the real file is top-level `docker-compose.yml`.

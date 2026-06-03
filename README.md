# Orrery

Internal AI-agent system. Phase 0/1 scope: one function-scoped agent
(tech support) that reads tickets, drafts replies, and gets approved
via Slack 👍/👎 — never sending anything on its own.

## Stack

- **Gateway**: LiteLLM in Docker, fronts Anthropic Claude. All model
  calls (chat + embeddings) route through it.
- **Agent**: PydanticAI, ~1 Python file, read/draft-only tools.
- **Memory**: Qdrant (vector DB) with local `fastembed` embeddings.
- **Behavior config**: a markdown file at `config/support/agent.md`,
  versioned in git. Agent reads at startup; only humans edit.
- **Approval surface**: Slack reaction-polling (👍 = approved, 👎 =
  correction). Approved replies fire from a separate write-capable
  module — the agent's reasoning tools stay strictly read-only.

## Layout

```
docker-compose.yml         # gateway, qdrant, agent (services come online by phase)
gateway/                   # LiteLLM config
  config.yaml              # model routing + embeddings
agent/                     # the agent: loop, tools, kb wrapper, approval surface
config/support/agent.md    # the agent's behavior (git-tracked, human-edited)
docs/                      # local corpus the agent searches
.env                       # secrets (gitignored)
.env.example               # template — copy to .env and fill in
Makefile                   # ergonomic targets
```

## Phase 0/1 build order

1. **Gateway** (this step). docker-compose + LiteLLM + verify a Claude
   call routes through it.
2. **Agent skeleton + ticket reader**. PydanticAI agent in its own
   container, one read-only `read_ticket` tool, answers to console.
3. **Memory + docs search**. Qdrant + `search_kb` / `read_docs` tools.
   All learnings written as `status="provisional"`.
4. **Slack approval loop**. Draft posts to Slack, agent polls 👍/👎
   reactions, approved replies fire from a separate send path.

Each step ends with a working end-to-end checkpoint.

## Quickstart (Phase 0 — gateway only)

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY
make up                # start gateway container
make verify-gateway    # smoke test: routes a real Claude call through
make logs              # tail gateway logs
make down              # stop
```

## Conventions

- Read tools cannot mutate. Write/send lives in a separate module
  triggered only by 👍 approval.
- Behavior in git (`config/support/agent.md`), facts in memory (Qdrant).
  Never mix.
- New things the agent learns are `provisional` until a human curates.

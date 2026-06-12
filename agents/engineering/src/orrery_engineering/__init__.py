"""Engineering agent — the Phase 1 function agent.

Two halves (see config/engineering/agent.md for behavior):
  - INWARD:  read the company's engineering documents in Google Drive,
             answer with citations, draft new docs from templates.
  - OUTWARD: research parts / vendors / references via ONE web-search
             tool (Exa), always citing the source.

Shared, agent-agnostic infrastructure lives in `orrery_lib` (the gateway
client, the KB wrapper, the Drive service-account helpers, the
NotConfiguredError type). This package holds the engineering-specific
domain layer: its tools, drive reader, drafting, fetch, chat, and the
approval surface.
"""

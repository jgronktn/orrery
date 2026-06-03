"""Engineering agent — the Phase 0/1 function agent.

Two halves (see config/engineering/agent.md for behavior):
  - INWARD:  read the company's engineering documents in Google Drive,
             answer with citations, draft new docs from templates.
  - OUTWARD: research parts / vendors / references via ONE web-search
             tool (Exa), always citing the source.

Shares the function-agnostic infrastructure with the support agent:
  tools.kb (Qdrant), approval/, actions, config-loading. Its own
  domain layer lives in this subpackage.

Build state: the KB-backed reasoning path is live. The Drive and
web-search seams are present but not yet wired to credentials — they
announce themselves as not-configured rather than guessing. See
drive.py / websearch.py / draft.py.
"""


class NotConfiguredError(RuntimeError):
    """A credentialed seam (Drive, Exa) was used before its credential
    or dependency was supplied. Carries a human-actionable message."""

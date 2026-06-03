"""Read-only tools available to the support agent.

Phase 0: just `read_ticket`. Step 3 adds `search_kb` and `read_docs`.

Invariant: every tool in this package is READ-ONLY. Anything that
mutates state lives in a different module (e.g. the approved-reply
sender in Step 4) that the agent's reasoning loop cannot reach.
"""

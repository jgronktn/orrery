"""Function registry + stream provisioning.

Every company function has exactly one perpetual stream (kind=function_stream)
plus zero-or-more bounded projects. Streams are auto-provisioned here. Only
functions with a live agent are provisioned today; the rest are declared for
forward reference and light up when their agent ships.

Naming rule (note §6): `bookkeeping` is the operational ledger — its own
top-level function/agent (Phase 2). `financing` is NOT a top-level function;
it is a CORPORATE sub-function/facet (corporate/equity/, corporate/financial/
debt/) handled by the corporate agent. Never conflate `financial` (ledger)
with `financing` (equity/debt).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Project, User


@dataclass(frozen=True)
class FunctionDef:
    key: str
    name: str
    agent_id: str | None  # the function's implicit stream agent
    folder: str  # folder home in the document store (relative to FILES_ROOT)


FUNCTIONS: dict[str, FunctionDef] = {
    "engineering": FunctionDef("engineering", "Engineering", "engineering", "engineering"),
    # Declared for forward reference; provisioned when their agent ships:
    #   "bookkeeping": FunctionDef("bookkeeping", "Bookkeeping", "bookkeeping", "bookkeeping"),
    #   "corporate":   FunctionDef("corporate", "Corporate", "corporate", "corporate"),
    #   "marketing":   FunctionDef("marketing", "Marketing", "marketing", "marketing"),
}

# Functions with a live agent + an auto-provisioned stream today.
ACTIVE_FUNCTIONS: tuple[str, ...] = ("engineering",)


def agent_for_function(function: str | None) -> str | None:
    f = FUNCTIONS.get(function or "")
    return f.agent_id if f else None


def function_for_agent(agent_id: str) -> str | None:
    for f in FUNCTIONS.values():
        if f.agent_id == agent_id:
            return f.key
    return None


def accessible_functions(user: User) -> set[str]:
    """Functions a user can reach (their streams). Single-agent phase: everyone
    reaches engineering. Real per-user function access arrives with multi-user
    permissions."""
    return set(ACTIVE_FUNCTIONS)


def can_access_function(user: User, function: str | None) -> bool:
    return function in accessible_functions(user)


def provision_streams(db: Session) -> None:
    """Idempotent: ensure a function_stream row exists for each active function."""
    for key in ACTIVE_FUNCTIONS:
        f = FUNCTIONS[key]
        exists = db.scalar(
            select(Project).where(
                Project.kind == "function_stream", Project.function == key
            )
        )
        if exists is not None:
            continue
        db.add(
            Project(
                name=f.name, slug=f.key, kind="function_stream",
                function=f.key, created_by=None,
            )
        )
        db.commit()

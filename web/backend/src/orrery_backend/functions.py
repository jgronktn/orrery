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

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from orrery_lib import filestore

from .models import Catalog, Project, Task, User


@dataclass(frozen=True)
class FunctionDef:
    key: str
    name: str
    agent_id: str | None  # the function's implicit stream agent
    folder: str  # folder home in the document store (relative to FILES_ROOT)
    facets: tuple[str, ...] = ()  # controlled sub-function vocabulary (1:1 with subfolders)


# Controlled facet vocabulary per function, in git. Facets are filterable
# sub-functions on the timeline, NOT containers — they map 1:1 to the function
# folder's subdivisions. Lopsided by design (engineering light, corporate heavy).
#
# Graduation test (note §6): one stream = one agent = one permission boundary.
# A sub-function stays a *facet* only while it shares its parent's agent AND
# permission boundary. The moment it needs a distinct agent OR a distinct
# permission boundary, it graduates to its own function_stream. (Solo founder
# today: nothing graduates.)
FUNCTIONS: dict[str, FunctionDef] = {
    # Corporate — home of the executive-assistant agent (the cross-function
    # "superagent"). Facets from its real on-disk subfolders.
    "corp": FunctionDef(
        "corp", "Corporate", "corporate", "corporate",
        facets=("ip", "equity", "financial", "governance", "contracts"),
    ),
    # key='engr' (renamed from 'engineering'); folder + agent stay full-word.
    # The agent service id stays 'engineering' (Forge) — untouched.
    "engr": FunctionDef(
        "engr", "Engineering", "engineering", "engineering",
        facets=("specs", "drafts", "templates", "design-docs", "certifications", "contractors", "archive"),
    ),
    # IT / HR / Accounting — no agent yet. Facet vocab unknown (BACKEND.md
    # absent); seed empty rather than invent a controlled list.
    "it": FunctionDef("it", "IT", None, "it"),
    "hr": FunctionDef("hr", "HR", None, "hr"),
    "acct": FunctionDef("acct", "Accounting", None, "accounting"),
}


def facets_for(function: str | None) -> list[str]:
    f = FUNCTIONS.get(function or "")
    return list(f.facets) if f else []

# All five functions are provisioned (Engineering has an agent; the rest are
# agent-less containers — manual file/timeline tracking works regardless).
ACTIVE_FUNCTIONS: tuple[str, ...] = ("corp", "engr", "it", "hr", "acct")


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


def pending_synth_count(container: Project, db: Session) -> int:
    """Manual items in a container added/edited since the last knowledge
    synthesis (synthesized='pending') — files (catalog) + action items (tasks).
    A cheap COUNT; informs the founder's decision to run a batch, never acts."""
    cat_q = select(func.count()).select_from(Catalog).where(Catalog.synthesized == "pending")
    if container.kind == "function_stream":
        cat_q = cat_q.where(
            Catalog.container_kind == "function", Catalog.function == container.function
        )
    else:
        cat_q = cat_q.where(Catalog.container_id == container.id)
    n = db.scalar(cat_q) or 0
    n += db.scalar(
        select(func.count()).select_from(Task).where(
            Task.project_id == container.id, Task.synthesized == "pending"
        )
    ) or 0
    return n


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


def provision_folders() -> None:
    """Ensure each active function's top-level folder exists, git-committed.
    Empty folders get a tracked .gitkeep; populated ones (engineering/) are left
    alone. Idempotent."""
    new_paths: list[str] = []
    for key in ACTIVE_FUNCTIONS:
        d = filestore.FILES_ROOT / FUNCTIONS[key].folder
        d.mkdir(parents=True, exist_ok=True)
        keep = d / ".gitkeep"
        if not any(d.iterdir()):  # empty → add a tracked placeholder
            keep.write_text("", encoding="utf-8")
            new_paths.append(str(keep.relative_to(filestore.FILES_ROOT)))
    if new_paths:
        filestore.git_commit(new_paths, "functions: provision folders")

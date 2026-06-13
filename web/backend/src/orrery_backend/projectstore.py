"""Filesystem side of projects: create each project's folder tree and seed
its research log. Reuses orrery_lib.filestore (FILES_ROOT + git commits).

Layout created per project:

    projects/<slug>/
    ├── research-log.md          # seeded with the 4 sections
    ├── drafts/                  # cross-functional drafts
    ├── engineering/             # engineering-function artifacts
    ├── marketing/               # placeholder (future agent)
    ├── manufacturing/           # placeholder (future agent)
    └── decisions/               # cross-functional decision records
"""
from __future__ import annotations

from orrery_lib import filestore

SUBDIRS = ["drafts", "engineering", "marketing", "manufacturing", "decisions"]

RESEARCH_LOG_TEMPLATE = """# Project: {name}

## Engineering

## Marketing

## Manufacturing / Ops

## Decisions
"""


def project_dir(slug: str):
    return filestore.FILES_ROOT / "projects" / slug


def research_log_path(slug: str):
    return project_dir(slug) / "research-log.md"


def create_project_tree(
    slug: str,
    name: str,
    *,
    author_name: str | None = None,
    author_email: str | None = None,
) -> None:
    """Create the project's folder structure + seeded research log, then
    git-commit. Idempotent: only creates what's missing."""
    root = project_dir(slug)
    new_paths: list[str] = []

    for sub in SUBDIRS:
        d = root / sub
        d.mkdir(parents=True, exist_ok=True)
        keep = d / ".gitkeep"
        if not keep.exists():
            keep.write_text("", encoding="utf-8")
            new_paths.append(str(keep.relative_to(filestore.FILES_ROOT)))

    log = research_log_path(slug)
    if not log.exists():
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text(RESEARCH_LOG_TEMPLATE.format(name=name), encoding="utf-8")
        new_paths.append(str(log.relative_to(filestore.FILES_ROOT)))

    if new_paths:
        filestore.git_commit(
            new_paths,
            f"projects: initialize folder structure for {slug}",
            author_name=author_name,
            author_email=author_email,
        )

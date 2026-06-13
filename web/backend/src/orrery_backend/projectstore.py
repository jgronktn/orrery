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

from datetime import datetime, timezone

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


def read_research_log(slug: str) -> str:
    path = research_log_path(slug)
    if not path.exists():
        raise FileNotFoundError(f"no research log for project {slug}")
    return path.read_text(encoding="utf-8")


def append_research_log(slug: str, section: str, content: str, attribution: str) -> str:
    """Append a timestamped, attributed bullet under the named section.
    Append-only; humans edit the Markdown by hand. Returns the new log text."""
    path = research_log_path(slug)
    if not path.exists():
        raise FileNotFoundError(f"no research log for project {slug}")
    lines = path.read_text(encoding="utf-8").splitlines()

    # Find the "## <section>" heading (loose, case-insensitive match).
    heading_idx = None
    for i, line in enumerate(lines):
        if line.startswith("## ") and section.lower() in line[3:].strip().lower():
            heading_idx = i
            break
    if heading_idx is None:
        raise ValueError(f"unknown research-log section: {section!r}")

    # End of section = next "## " heading or EOF.
    end = len(lines)
    for j in range(heading_idx + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    # Insert just after the last non-blank line of the section.
    insert_at = end
    while insert_at - 1 > heading_idx and lines[insert_at - 1].strip() == "":
        insert_at -= 1

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    entry = f"- {stamp} — {attribution}: {content}"
    lines = lines[:insert_at] + [entry] + lines[insert_at:]
    new_text = "\n".join(lines).rstrip() + "\n"
    path.write_text(new_text, encoding="utf-8")
    filestore.git_commit(
        [str(path.relative_to(filestore.FILES_ROOT))],
        f"projects/{slug}: research-log append to {section}",
    )
    return new_text

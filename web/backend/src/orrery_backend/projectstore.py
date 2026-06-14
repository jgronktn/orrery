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

import re
import subprocess
from datetime import datetime, timezone
from email import message_from_bytes
from email.utils import parsedate_to_datetime
from pathlib import Path

from orrery_lib import filestore

# Extension → node type (mirrors the timeline design's type map).
_TYPE_BY_EXT = {
    **{e: "code" for e in ("tsx", "ts", "jsx", "js", "mjs", "cjs", "sh", "go", "rs", "py")},
    **{e: "style" for e in ("css", "scss", "sass", "less")},
    **{e: "markup" for e in ("html", "htm")},
    **{e: "data" for e in ("json", "yaml", "yml", "toml", "lock", "env", "csv")},
    **{e: "doc" for e in ("md", "mdx", "txt", "pdf")},
    **{e: "image" for e in ("svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "mp4")},
}


def _type_for_ext(ext: str) -> str:
    return _TYPE_BY_EXT.get(ext.lower(), "other")

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


def project_files(slug: str) -> list[dict]:
    """List the project's files as timeline nodes, timestamped by the git
    commit that ADDED each one (batch = that commit). Files not yet committed
    fall back to mtime. `.gitkeep` placeholders are skipped."""
    root = project_dir(slug)
    if not root.exists():
        return []

    # One pass: map repo-relative path → (short hash, unix add-time). git log
    # is newest-first, so overwriting leaves the EARLIEST add for each path.
    added: dict[str, tuple[str, int]] = {}
    proc = subprocess.run(
        ["git", "-C", str(filestore.FILES_ROOT), "log", "--diff-filter=A",
         "--name-only", "--format=__C__|%h|%at", "--", f"projects/{slug}/"],
        capture_output=True, text=True,
    )
    cur: tuple[str, int] | None = None
    for line in proc.stdout.splitlines():
        if line.startswith("__C__|"):
            _, h, ts = line.split("|")
            cur = (h, int(ts))
        elif line.strip() and cur is not None:
            added[line.strip()] = cur

    nodes: list[dict] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name == ".gitkeep":
            continue
        # Dropped attachments are represented by the project_documents table
        # (with their own timeline date), so skip them in the git scan.
        if p.relative_to(root).parts[0] == "attachments":
            continue
        rel = str(p.relative_to(filestore.FILES_ROOT))
        ext = p.suffix.lstrip(".").lower()
        commit = added.get(rel)
        if commit is not None:
            batch, time_ms = commit[0], commit[1] * 1000
        else:
            batch, time_ms = "local", int(p.stat().st_mtime * 1000)
        nodes.append(
            {
                "id": f"file:{rel}",
                "kind": "file",
                "name": p.name,
                "path": str(p.relative_to(root)),
                "ext": ext or None,
                "type": _type_for_ext(ext),
                "size": p.stat().st_size,
                "time": time_ms,
                "desc": None,
                "batch": batch,
                "attached": False,
                "status": None,
            }
        )
    return nodes


# ── Dropped attachments (drag-and-drop onto the timeline) ───────────


def _safe_name(name: str) -> str:
    base = name.replace("\\", "/").split("/")[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    return (cleaned or "file")[:200]


def _unique(directory: Path, filename: str) -> Path:
    target = directory / filename
    if not target.exists():
        return target
    stem, dot, ext = filename.partition(".")
    i = 1
    while True:
        cand = directory / f"{stem}-{i}{dot}{ext}"
        if not cand.exists():
            return cand
        i += 1


def save_upload(
    slug: str,
    filename: str,
    data: bytes,
    *,
    author_name: str | None = None,
    author_email: str | None = None,
) -> tuple[str, str]:
    """Save a dropped file under projects/<slug>/attachments/ (unique on
    collision) and git-commit it. Returns (path-relative-to-project, name)."""
    directory = project_dir(slug) / "attachments"
    directory.mkdir(parents=True, exist_ok=True)
    target = _unique(directory, _safe_name(filename))
    target.write_bytes(data)
    rel = str(target.relative_to(filestore.FILES_ROOT))
    filestore.git_commit(
        [rel],
        f"projects/{slug}: add attachment {target.name}",
        author_name=author_name,
        author_email=author_email,
    )
    return str(target.relative_to(project_dir(slug))), target.name


def delete_upload(
    slug: str,
    rel_to_project: str,
    *,
    author_name: str | None = None,
    author_email: str | None = None,
) -> None:
    """Remove a dropped file from the store and git-commit the deletion.
    Git history still retains it, so it's recoverable."""
    target = project_dir(slug) / rel_to_project
    rel = str(target.relative_to(filestore.FILES_ROOT))
    if target.exists():
        target.unlink()
    # `git add <path>` stages a deletion for a tracked file (git ≥ 2.0).
    filestore.git_commit(
        [rel],
        f"projects/{slug}: remove attachment {target.name}",
        author_name=author_name,
        author_email=author_email,
    )


def parse_eml(data: bytes) -> tuple[datetime | None, str | None, str | None]:
    """Pull (sent/received date, subject, sender) from raw .eml bytes."""
    msg = message_from_bytes(data)
    when: datetime | None = None
    raw = msg.get("Date")
    if raw:
        try:
            when = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            when = None
    if when is not None and when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when, msg.get("Subject"), msg.get("From")


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

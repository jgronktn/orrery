"""Local-filesystem document store — the replacement for Google Drive.

Files live under ORRERY_FILES_ROOT (default /var/lib/orrery/files). This
module is the agent's read/write surface over that tree:

  - search(): filename + text-content match (PDFs are matched by filename
    only — they are NOT extracted, preserving the finder-not-oracle rule).
  - read():   extract text for Markdown/text/Word; for binaries return a
    pointer to the file's location rather than its bytes.
  - write_text() / save_bytes(): create a NEW file (unique name on
    collision) and make a git commit recording the change.

Versioning: the tree is a git repo; every write commits with the agent's
identity. No Drive API anywhere here.
"""
from __future__ import annotations

import io
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

FILES_ROOT = Path(os.environ.get("ORRERY_FILES_ROOT", "/var/lib/orrery/files"))
ENGINEERING_ROOT = FILES_ROOT / "engineering"

# Commit identity for agent-initiated writes (override for user-initiated).
GIT_AUTHOR_NAME = os.environ.get("ORRERY_GIT_AUTHOR_NAME", "Orrery Engineering Agent")
GIT_AUTHOR_EMAIL = os.environ.get("ORRERY_GIT_AUTHOR_EMAIL", "agent@orrery.local")

_TEXT_EXT = {".md", ".markdown", ".txt", ".csv"}
_DOCX_EXT = {".docx"}
_SNIPPET_CHARS = 240


@dataclass
class FileHit:
    """One search result. `path` is relative to the search root."""

    path: str
    name: str
    snippet: str = ""


# ── path safety + naming ────────────────────────────────────────────


def _resolve(root: Path, relpath: str) -> Path:
    """Resolve relpath under root, refusing anything that escapes it."""
    p = (root / relpath).resolve()
    root_r = root.resolve()
    if p != root_r and root_r not in p.parents:
        raise ValueError(f"path escapes the store root: {relpath!r}")
    return p


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip() or "untitled"
    return cleaned


def _unique_path(directory: Path, filename: str) -> Path:
    target = directory / filename
    if not target.exists():
        return target
    stem, suffix = os.path.splitext(filename)
    i = 1
    while True:
        cand = directory / f"{stem}-{i}{suffix}"
        if not cand.exists():
            return cand
        i += 1


# ── text extraction ─────────────────────────────────────────────────


def _docx_to_text(data: bytes) -> str:
    import docx  # python-docx

    document = docx.Document(io.BytesIO(data))
    lines = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                lines.append(" | ".join(cells))
    return "\n".join(lines).strip()


def extract_text(path: Path) -> str | None:
    """Text for Markdown/text/Word; None for binaries (PDFs, images)."""
    ext = path.suffix.lower()
    if ext in _TEXT_EXT:
        return path.read_text(encoding="utf-8", errors="replace")
    if ext in _DOCX_EXT:
        return _docx_to_text(path.read_bytes())
    return None


def _snippet(text: str, terms: list[str]) -> str:
    low = text.lower()
    pos = min((low.find(t) for t in terms if t in low), default=-1)
    if pos < 0:
        return text[:_SNIPPET_CHARS].strip()
    start = max(0, pos - 60)
    return text[start : start + _SNIPPET_CHARS].strip().replace("\n", " ")


# ── search / read ───────────────────────────────────────────────────


def search(root: Path, query: str, k: int = 5) -> list[FileHit]:
    """Filename + text-content search. All query terms must appear in the
    filename or the file's extracted text. Filename matches rank higher.
    PDFs/binaries match on filename only."""
    terms = [t for t in query.lower().split() if t]
    if not terms or not root.exists():
        return []
    scored: list[tuple[int, FileHit]] = []
    for p in root.rglob("*"):
        if not p.is_file() or p.name == ".gitkeep":
            continue
        name_l = p.name.lower()
        text = extract_text(p)
        haystack = name_l + "\n" + (text.lower() if text else "")
        if not all(t in haystack for t in terms):
            continue
        in_name = all(t in name_l for t in terms)
        snip = "" if text is None else _snippet(text, terms)
        scored.append(
            (2 if in_name else 1, FileHit(path=str(p.relative_to(root)), name=p.name, snippet=snip))
        )
    scored.sort(key=lambda s: (-s[0], s[1].path))
    return [hit for _, hit in scored[:k]]


def read(root: Path, relpath: str) -> str:
    p = _resolve(root, relpath)
    if not p.is_file():
        raise FileNotFoundError(relpath)
    text = extract_text(p)
    if text is None:
        return (
            f"[{p.name}] is a binary file ({p.suffix or 'no ext'}). It is stored "
            f"at '{relpath}' on the file server — open it directly; its contents "
            "are not extracted."
        )
    return text


# ── writes (with git versioning) ────────────────────────────────────


def git_commit(rel_paths: list[str], message: str) -> None:
    """Stage paths and commit in the FILES_ROOT repo as the agent."""
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": GIT_AUTHOR_NAME,
        "GIT_AUTHOR_EMAIL": GIT_AUTHOR_EMAIL,
        "GIT_COMMITTER_NAME": GIT_AUTHOR_NAME,
        "GIT_COMMITTER_EMAIL": GIT_AUTHOR_EMAIL,
    }
    base = ["git", "-C", str(FILES_ROOT)]
    subprocess.run([*base, "add", *rel_paths], check=True, env=env, capture_output=True)
    result = subprocess.run(
        [*base, "commit", "-m", message], env=env, capture_output=True, text=True
    )
    if result.returncode != 0 and "nothing to commit" not in (
        result.stdout + result.stderr
    ):
        raise RuntimeError(f"git commit failed: {result.stderr or result.stdout}")


def write_text(rel_dir: str, filename: str, content: str, message: str) -> FileHit:
    """Write a NEW text file under FILES_ROOT/rel_dir, unique on collision,
    then commit. Returns a hit with the path relative to FILES_ROOT."""
    directory = _resolve(FILES_ROOT, rel_dir)
    directory.mkdir(parents=True, exist_ok=True)
    target = _unique_path(directory, _safe_filename(filename))
    target.write_text(content, encoding="utf-8")
    rel = str(target.relative_to(FILES_ROOT))
    git_commit([rel], message)
    return FileHit(path=rel, name=target.name)


def save_bytes(rel_dir: str, filename: str, data: bytes, message: str) -> FileHit:
    """Write a NEW binary file under FILES_ROOT/rel_dir, unique on
    collision, then commit. Returns a hit with the FILES_ROOT-relative path."""
    directory = _resolve(FILES_ROOT, rel_dir)
    directory.mkdir(parents=True, exist_ok=True)
    target = _unique_path(directory, _safe_filename(filename))
    target.write_bytes(data)
    rel = str(target.relative_to(FILES_ROOT))
    git_commit([rel], message)
    return FileHit(path=rel, name=target.name)


# ── the agent's reader ──────────────────────────────────────────────


class FileStoreReader:
    """Read-only search/read scoped to a root (the engineering subtree)."""

    def __init__(self, root: Path):
        self.root = root

    def search(self, query: str, k: int = 5) -> list[FileHit]:
        return search(self.root, query, k=k)

    def read(self, path: str) -> str:
        return read(self.root, path)


def build_engineering_reader() -> FileStoreReader:
    return FileStoreReader(ENGINEERING_ROOT)

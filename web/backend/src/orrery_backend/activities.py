"""Index timeline items into the knowledge base.

A timeline item is a `Task` row (kind = note / reminder / task / milestone /
decision). To make these agent-retrievable, each is mirrored into the
`learnings` Qdrant collection that the agents' `search_kb` tool queries. The
Task is the source of truth: its point id is stored on the row so an edit
re-embeds and a delete removes the point. Indexing is best-effort — a KB/Qdrant
hiccup must never block the task write.
"""
from __future__ import annotations

import logging

from orrery_lib import kb

from .models import Task

_log = logging.getLogger("orrery.activities")


def _kb_text(task: Task) -> str:
    body = f"[{task.kind}] {task.title}"
    if task.description:
        body += f"\n{task.description}"
    return body


def index_task_kb(task: Task, *, container_name: str) -> None:
    """(Re)index a task into `learnings` and store/refresh its point id on the
    row. The caller must commit afterwards to persist `kb_point_id`."""
    try:
        if task.kb_point_id:
            kb.delete_point(kb.LEARNINGS_COLLECTION, task.kb_point_id)
        task.kb_point_id = kb.add(
            kb.LEARNINGS_COLLECTION,
            text=_kb_text(task),
            source=f"{task.kind} · {container_name}",
            status="provisional",
        )
    except Exception:  # pragma: no cover - indexing is best-effort
        _log.exception("kb index failed for task %s", task.id)


def unindex_task_kb(task: Task) -> None:
    """Remove a task's `learnings` point (on delete)."""
    if not task.kb_point_id:
        return
    try:
        kb.delete_point(kb.LEARNINGS_COLLECTION, task.kb_point_id)
    except Exception:  # pragma: no cover - best-effort
        _log.exception("kb unindex failed for task %s", task.id)

"""Project-management + research-log tools shared by ALL agents.

These are thin clients over the backend's /internal/agent API (the agent
has no database access; the backend owns Postgres state and enforces
project_agents). Any agent calls `pm.register(agent)` to inherit them.

They operate on the CURRENT project (encoded in the callback token the
backend minted for this run). Outside a project conversation there's no
backend client, and the tools say so instead of failing.
"""
from __future__ import annotations

import httpx
from pydantic_ai import RunContext

NO_PROJECT = (
    "This tool only works inside a project conversation — there's no active "
    "project here."
)


class BackendClient:
    """Calls the backend's /internal/agent API with the run's callback token."""

    def __init__(self, base_url: str, token: str):
        self._base = base_url.rstrip("/")
        self._headers = {"X-Agent-Callback": token}

    async def _req(self, method: str, path: str, **kw):
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.request(
                method, f"{self._base}{path}", headers=self._headers, **kw
            )
            resp.raise_for_status()
            if resp.status_code == 204:
                return None
            return resp.json()

    async def list_tasks(self):
        return await self._req("GET", "/internal/agent/tasks")

    async def create_task(self, body: dict):
        return await self._req("POST", "/internal/agent/tasks", json=body)

    async def update_task(self, task_id: str, body: dict):
        return await self._req("PATCH", f"/internal/agent/tasks/{task_id}", json=body)

    async def link_doc(self, task_id: str, doc_path: str):
        return await self._req(
            "POST", f"/internal/agent/tasks/{task_id}/docs", json={"doc_path": doc_path}
        )

    async def read_log(self):
        return await self._req("GET", "/internal/agent/research-log")

    async def append_log(self, section: str, content: str):
        return await self._req(
            "POST",
            "/internal/agent/research-log",
            json={"section": section, "content": content},
        )


def _client(ctx: RunContext) -> BackendClient | None:
    return getattr(ctx.deps, "backend", None)


def _err(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        detail = exc.response.text
        try:
            detail = exc.response.json().get("detail", detail)
        except Exception:
            pass
        return f"Project backend error ({exc.response.status_code}): {detail}"
    return f"Project backend error: {exc}"


def register(agent, *, default_log_section: str = "Engineering") -> None:
    """Add the PM + research-log tools to an agent. `default_log_section` is
    the agent's function section in the research log (e.g. 'Engineering')."""

    @agent.tool
    async def list_project_tasks(
        ctx: RunContext, status: str | None = None
    ) -> list[dict] | str:
        """List tasks on the current project. Optionally filter by status
        ('todo', 'doing', 'done'). Project conversations only."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        try:
            tasks = await be.list_tasks()
        except Exception as exc:
            return _err(exc)
        if status:
            tasks = [t for t in tasks if t.get("status") == status]
        return tasks

    @agent.tool
    async def create_task(
        ctx: RunContext,
        title: str,
        description: str | None = None,
        due_date: str | None = None,
    ) -> dict | str:
        """Create a task on the current project. due_date is ISO (YYYY-MM-DD)."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        try:
            return await be.create_task(
                {"title": title, "description": description, "due_date": due_date}
            )
        except Exception as exc:
            return _err(exc)

    @agent.tool
    async def update_task(
        ctx: RunContext,
        task_id: str,
        status: str | None = None,
        title: str | None = None,
        description: str | None = None,
        due_date: str | None = None,
    ) -> dict | str:
        """Update a task (status/title/description/due_date). Get task_id from
        list_project_tasks."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        body = {
            k: v
            for k, v in {
                "status": status,
                "title": title,
                "description": description,
                "due_date": due_date,
            }.items()
            if v is not None
        }
        try:
            return await be.update_task(task_id, body)
        except Exception as exc:
            return _err(exc)

    @agent.tool
    async def link_task_to_doc(
        ctx: RunContext, task_id: str, doc_path: str
    ) -> dict | str:
        """Attach a document (its file-store path, e.g. 'specs/foo.pdf') to a task."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        try:
            return await be.link_doc(task_id, doc_path)
        except Exception as exc:
            return _err(exc)

    @agent.tool
    async def read_research_log(ctx: RunContext) -> str:
        """Read the current project's research log (Markdown)."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        try:
            data = await be.read_log()
        except Exception as exc:
            return _err(exc)
        return (data or {}).get("content", "")

    @agent.tool
    async def append_to_research_log(
        ctx: RunContext, content: str, section: str | None = None
    ) -> str:
        """Append an entry to the project research log. Defaults to your own
        function's section; use 'Decisions' for genuinely cross-functional
        conclusions. Append-only — humans edit the log by hand."""
        be = _client(ctx)
        if be is None:
            return NO_PROJECT
        sec = section or default_log_section
        try:
            await be.append_log(sec, content)
        except Exception as exc:
            return _err(exc)
        return f"Appended to the '{sec}' section of the research log."

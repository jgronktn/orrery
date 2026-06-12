"""HTTP service for the engineering agent.

The backend (and only the backend) calls this. It exposes the agent's
reasoning loop over HTTP without changing the tools, KB, Drive
integration, or gateway routing — only the entry point. The CLI
(`python -m orrery_engineering ...`) still works for local testing.

  GET  /health  → liveness
  POST /run     → AgentRequest → AgentResponse  (stateless)

Run with: uvicorn orrery_engineering.server:app --host 0.0.0.0 --port 8001
"""
from __future__ import annotations

from fastapi import FastAPI

from orrery_lib.schema import AgentRequest, AgentResponse

from .service import run_once

app = FastAPI(title="Orrery Engineering Agent", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "agent": "engineering"}


@app.post("/run", response_model=AgentResponse)
async def run(req: AgentRequest) -> AgentResponse:
    return await run_once(req)

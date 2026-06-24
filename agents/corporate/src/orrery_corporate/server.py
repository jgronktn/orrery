"""HTTP service for the executive-assistant (corporate) agent.

The backend (and only the backend) calls this. It exposes the agent's reasoning
loop over HTTP, stateless.

  GET  /health  → liveness
  POST /run     → AgentRequest → AgentResponse  (stateless)
  POST /execute → run an approved proposal (bounded write). Backend-only.

Run with: uvicorn orrery_corporate.server:app --host 0.0.0.0 --port 8002
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from orrery_lib.observability import configure_observability
from orrery_lib.schema import AgentRequest, AgentResponse

from .service import execute_action, run_once

app = FastAPI(title="Orrery Executive Assistant", version="0.1.0")

# Observability: PydanticAI run/loop/tokens/tools + this service's requests.
# Trace context from the backend's HTTP call nests the agent run under the
# originating request. Inert until LOGFIRE_TOKEN is set.
configure_observability("orrery-corporate", app=app, pydantic_ai=True)


class ExecuteRequest(BaseModel):
    kind: str
    payload: dict


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "agent": "corporate"}


@app.post("/run", response_model=AgentResponse)
async def run(req: AgentRequest) -> AgentResponse:
    return await run_once(req)


@app.post("/execute")
def execute(req: ExecuteRequest) -> dict:
    """Execute an approved proposal (bounded write). Backend-only."""
    try:
        return {"ok": True, "result": execute_action(req.kind, req.payload)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:  # filesystem / unexpected
        raise HTTPException(500, f"execution failed: {exc}")

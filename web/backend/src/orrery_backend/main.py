"""FastAPI application entry point."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from orrery_lib.observability import configure_observability

from .agents import router as agents_router
from .approvals import router as approvals_router
from .auth import router as auth_router
from .config import settings
from .db import SessionLocal, engine
from .files import router as files_router
from .functions import provision_folders, provision_streams
from .functions_api import home_router
from .functions_api import router as functions_router
from .internal import router as internal_router
from .projects import router as projects_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Orrery Backend", version="0.1.0")

# Observability: trace the FastAPI request → agent HTTP call → Postgres queries
# as one tree. Inert until LOGFIRE_TOKEN is set. (PydanticAI itself is
# instrumented inside the agent services, where the agent loop runs.)
# FastAPI instrumentation requires fastapi<0.137 — see web/backend/pyproject.toml.
configure_observability("orrery-backend", app=app, engine=engine)


@app.on_event("startup")
def _provision() -> None:
    """Auto-provision one perpetual stream per active function."""
    db = SessionLocal()
    try:
        provision_streams(db)
        provision_folders()
    finally:
        db.close()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "backend", "env": settings.env}


app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(functions_router)
app.include_router(home_router)
app.include_router(agents_router)
app.include_router(approvals_router)
app.include_router(internal_router)
app.include_router(files_router)

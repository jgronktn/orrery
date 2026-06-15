"""FastAPI application entry point."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agents import router as agents_router
from .approvals import router as approvals_router
from .auth import router as auth_router
from .config import settings
from .db import SessionLocal
from .functions import provision_streams
from .internal import router as internal_router
from .projects import router as projects_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Orrery Backend", version="0.1.0")


@app.on_event("startup")
def _provision() -> None:
    """Auto-provision one perpetual stream per active function."""
    db = SessionLocal()
    try:
        provision_streams(db)
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
app.include_router(agents_router)
app.include_router(approvals_router)
app.include_router(internal_router)

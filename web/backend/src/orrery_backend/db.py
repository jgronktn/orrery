"""SQLAlchemy engine, session factory, and the declarative Base."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

# One process-wide engine + connection pool, created once at import and shared
# by every request-scoped session. The pool is sized so the frontend's
# concurrent request fan-out (and polling) is served from PERSISTENT
# connections instead of churning short-lived overflow ones — that churn showed
# up as repeated `connect` spans in Logfire. Sane for a single backend instance
# (Postgres default max_connections is 100):
#   - pool_size=10      : persistent connections kept warm and reused
#   - max_overflow=10   : headroom for rare bursts (only these open/close;
#                         steady-state traffic should fit within pool_size)
#   - pool_recycle=1800 : refresh a connection after 30 min, before Postgres
#                         drops a long-idle one (avoids pre_ping reconnect churn)
#   - pool_pre_ping     : never hand out a connection the server already closed
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
    pool_recycle=1800,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db() -> Iterator[Session]:
    """FastAPI dependency: a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

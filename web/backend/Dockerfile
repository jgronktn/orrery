# Orrery web backend. Build context is the repo root so the shared
# orrery-lib (schema) can be installed alongside the backend.
FROM python:3.12-slim

WORKDIR /app

# git: the backend commits project-folder/research-log writes to the file store.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Shared library (core/light — just the schema + errors, no agent deps).
COPY agents/lib ./lib
RUN pip install --no-cache-dir ./lib

# The backend itself, editable so the mounted src + alembic hot-reload.
COPY web/backend/pyproject.toml ./backend/
COPY web/backend/src ./backend/src
COPY web/backend/alembic.ini ./backend/
COPY web/backend/alembic ./backend/alembic
RUN pip install --no-cache-dir -e ./backend

# Prefetch the embedding model into a world-readable path (not /root/.cache)
# so the backend can embed documents (Tier 1) when run as a non-root UID.
ENV ORRERY_FASTEMBED_CACHE=/opt/fastembed
RUN mkdir -p /opt/fastembed && chmod 777 /opt/fastembed \
    && python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/fastembed')"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/backend
# alembic.ini's prepend_sys_path=src makes the package importable to env.py.
CMD ["sh", "-c", "alembic upgrade head && uvicorn orrery_backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/backend/src"]

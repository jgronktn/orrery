# Executive-assistant (corporate) agent container. Python 3.12 slim +
# PydanticAI. Build context is ./agents (the monorepo agents/ dir) so the
# shared library can be installed alongside the agent.
#
# orrery-lib is installed first (the agent depends on it); the agent itself is
# installed EDITABLE so the runtime source mount at /app/corporate/src
# hot-reloads without a rebuild — only dependency changes (pyproject.toml) need
# an image rebuild.

FROM python:3.12-slim

WORKDIR /app

# git: the agent versions document writes by committing to the file store.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Shared library first — the [agent] extra pulls the heavy deps (pydantic-ai,
# qdrant, fastembed, python-docx, odfpy).
COPY lib ./lib
RUN pip install --no-cache-dir "./lib[agent]"

# The corporate agent, editable.
COPY corporate/pyproject.toml ./corporate/
COPY corporate/src ./corporate/src
RUN pip install --no-cache-dir -e ./corporate

# Prefetch the embedding model into a world-readable, world-writable path
# (not /root/.cache) so the container works when run as a non-root UID.
ENV ORRERY_FASTEMBED_CACHE=/opt/fastembed
RUN mkdir -p /opt/fastembed && chmod 777 /opt/fastembed \
    && python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/fastembed')"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp

ENTRYPOINT ["python", "-m", "orrery_corporate"]

# Engineering agent container. Python 3.12 slim + PydanticAI.
# Build context is ./agents (the monorepo agents/ dir) so the shared
# library can be installed alongside the agent.
#
# orrery-lib is installed first (the agent depends on it); the agent
# itself is installed EDITABLE so the runtime source mount at
# /app/engineering/src hot-reloads without a rebuild — only dependency
# changes (pyproject.toml) need `make build-agent`.

FROM python:3.12-slim

WORKDIR /app

# Shared library first — the engineering agent's `orrery-lib` dependency.
COPY lib ./lib
RUN pip install --no-cache-dir ./lib

# The engineering agent, editable.
COPY engineering/pyproject.toml ./engineering/
COPY engineering/src ./engineering/src
RUN pip install --no-cache-dir -e ./engineering

# Prefetch the embedding model so first-run isn't a 30 MB download.
# Caches under /root/.cache/fastembed (a named volume in compose).
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["python", "-m", "orrery_engineering"]

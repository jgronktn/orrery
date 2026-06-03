# Phase 0 agent container. Python 3.12 slim + PydanticAI.
# Source code is mounted as a volume at runtime, so hot-reload doesn't
# need a rebuild — only `pyproject.toml` changes do.

FROM python:3.12-slim

WORKDIR /app

# Pin only at the top-level — let pip resolve transitive deps so we
# don't have to chase Pydantic's churn.
RUN pip install --no-cache-dir \
        "pydantic-ai>=0.4,<1.0" \
        "httpx>=0.27,<1.0" \
        "qdrant-client~=1.12.0" \
        "fastembed>=0.4,<1.0" \
        "google-api-python-client>=2.0,<3.0" \
        "python-docx>=1.1,<2.0" \
        "markdown>=3.5,<4.0"

# Prefetch the embedding model so first-run isn't a 30 MB download.
# Caches under /root/.cache/fastembed (which docker-compose mounts as
# a named volume so the cache survives container removal).
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src

ENTRYPOINT ["python", "-m", "orrery_agent"]

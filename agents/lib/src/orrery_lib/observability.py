"""Logfire / OpenTelemetry observability — one place to configure agent + app
tracing for every Orrery service (backend + each agent).

Inert until a token is present: `send_to_logfire="if-token-present"` means with
no `LOGFIRE_TOKEN` set, nothing is exported (and nothing breaks) — so dev that
hasn't connected Logfire is unaffected. Set `LOGFIRE_TOKEN` to start sending.

Logfire IS OpenTelemetry under the hood, so the same instrumentation can be
pointed at a self-run OTel backend later (a destination change only — no
re-instrumentation) if telemetry residency ever becomes a requirement.

Scrubbing stays ON (Logfire's default) so secrets / sensitive span arguments are
redacted even on the cloud path — important since the executive-assistant agent
sees cross-function data.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("orrery.observability")


def configure_observability(
    service_name: str,
    *,
    app: Any = None,
    engine: Any = None,
    pydantic_ai: bool = False,
) -> None:
    """Configure Logfire for one service and enable auto-instrumentation.

    - Always: base config + httpx (so backend↔agent calls propagate trace
      context and stitch into one trace).
    - `app`: instrument that FastAPI app (request spans).
    - `engine`: instrument that SQLAlchemy engine (query spans).
    - `pydantic_ai`: instrument PydanticAI (agent run/loop, tokens, tool calls,
      cost) — set this in the agent services, not the backend.

    Never raises: a telemetry misconfig must not take down a service. Each
    instrumentation is guarded independently so a missing integration extra
    can't disable the others.
    """
    try:
        import logfire
    except Exception as exc:  # pragma: no cover
        log.warning("logfire unavailable (%s): %s", service_name, exc)
        return

    try:
        logfire.configure(
            service_name=service_name,
            send_to_logfire="if-token-present",
            console=False,
        )
    except Exception as exc:  # pragma: no cover
        log.warning("logfire.configure failed (%s): %s", service_name, exc)
        return

    def _try(label: str, fn) -> None:
        try:
            fn()
        except Exception as exc:  # pragma: no cover
            log.warning("instrument %s skipped (%s): %s", label, service_name, exc)

    _try("httpx", logfire.instrument_httpx)
    if app is not None:
        _try("fastapi", lambda: logfire.instrument_fastapi(app))
    if engine is not None:
        _try("sqlalchemy", lambda: logfire.instrument_sqlalchemy(engine=engine))
    if pydantic_ai:
        _try("pydantic_ai", logfire.instrument_pydantic_ai)

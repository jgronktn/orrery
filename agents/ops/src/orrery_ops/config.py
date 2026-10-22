"""Load the ops agent's behavior config from disk.

The operations agent's behavior lives in
`config/ops/agent.md` (mounted into the container at
`/app/config/ops/agent.md`). It is read ONCE at startup — restart the
container to pick up edits. That's intentional: behavior changes should be
deliberate and git-committable, not silently hot-reloaded.
"""
from pathlib import Path
import os

OPS_CONFIG_PATH = Path(
    os.environ.get("ORRERY_OPS_AGENT_MD", "/app/config/ops/agent.md")
)


def load_instructions(path: Path | None = None) -> str:
    cfg = path or OPS_CONFIG_PATH
    if not cfg.exists():
        raise FileNotFoundError(
            f"Behavior config not found at {cfg}. "
            "Make sure the host's config/ directory is mounted "
            "to /app/config in docker-compose.yml."
        )
    return cfg.read_text(encoding="utf-8")

"""Load the agent's behavior config from disk.

The config lives in `config/support/agent.md` (mounted into the
container at `/app/config/support/agent.md`). The agent reads it ONCE
at startup — restart the container to pick up edits. That's
intentional: behavior changes should be deliberate and git-committable,
not silently hot-reloaded.
"""
from pathlib import Path
import os

CONFIG_PATH = Path(
    os.environ.get("ORRERY_AGENT_MD", "/app/config/support/agent.md")
)

# Each function agent's behavior lives under config/<function>/agent.md.
ENGINEERING_CONFIG_PATH = Path(
    os.environ.get("ORRERY_ENG_AGENT_MD", "/app/config/engineering/agent.md")
)


def load_instructions(path: Path | None = None) -> str:
    """Read a behavior config from disk. Defaults to the support agent's
    config for backward compatibility; pass an explicit path for other
    function agents (e.g. ENGINEERING_CONFIG_PATH)."""
    cfg = path or CONFIG_PATH
    if not cfg.exists():
        raise FileNotFoundError(
            f"Behavior config not found at {cfg}. "
            "Make sure the host's config/ directory is mounted "
            "to /app/config in docker-compose.yml."
        )
    return cfg.read_text(encoding="utf-8")

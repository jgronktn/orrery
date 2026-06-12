"""Load the agent's behavior config from disk.

The engineering agent's behavior lives in `config/engineering/agent.md`
(mounted into the container at `/app/config/engineering/agent.md`). It is
read ONCE at startup — restart the container to pick up edits. That's
intentional: behavior changes should be deliberate and git-committable,
not silently hot-reloaded.
"""
from pathlib import Path
import os

# Each function agent's behavior lives under config/<function>/agent.md.
ENGINEERING_CONFIG_PATH = Path(
    os.environ.get("ORRERY_ENG_AGENT_MD", "/app/config/engineering/agent.md")
)


def load_instructions(path: Path | None = None) -> str:
    """Read a behavior config from disk. Defaults to the engineering
    agent's config; pass an explicit path for other function agents."""
    cfg = path or ENGINEERING_CONFIG_PATH
    if not cfg.exists():
        raise FileNotFoundError(
            f"Behavior config not found at {cfg}. "
            "Make sure the host's config/ directory is mounted "
            "to /app/config in docker-compose.yml."
        )
    return cfg.read_text(encoding="utf-8")

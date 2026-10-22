"""Entry point: run the HTTP service.

The Docker image's ENTRYPOINT is `python -m orrery_ops`; docker-compose
overrides the command to add uvicorn's --reload for local dev. Running this
module directly launches the service on port 8003.
"""
from __future__ import annotations


def main() -> None:
    import uvicorn

    uvicorn.run("orrery_ops.server:app", host="0.0.0.0", port=8003)


if __name__ == "__main__":
    main()

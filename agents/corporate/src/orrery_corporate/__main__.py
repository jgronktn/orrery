"""Entry point: run the HTTP service.

The Docker image's ENTRYPOINT is `python -m orrery_corporate`; docker-compose
overrides the command to add uvicorn's --reload for local dev. Running this
module directly launches the service on port 8002.
"""
from __future__ import annotations


def main() -> None:
    import uvicorn

    uvicorn.run("orrery_corporate.server:app", host="0.0.0.0", port=8002)


if __name__ == "__main__":
    main()

"""One-shot: wipe the corporate test data + the stray projects/corporate project.

Touches Postgres (cascade), Qdrant (chunk drop), and the git filestore, so it's
a script, not an Alembic migration. Run once:

    docker compose exec backend python -m orrery_backend.wipe_corporate
"""
from __future__ import annotations

import shutil

from sqlalchemy import select

from orrery_lib import docstore, filestore

from . import functions
from .db import SessionLocal
from .models import Catalog, Project


def wipe() -> None:
    db = SessionLocal()
    try:
        # 1. The stray corporate PROJECT — drop its embeddings, then delete the
        #    row (cascades its catalog/tasks/members/conversations/proposals).
        proj = db.scalar(
            select(Project).where(Project.slug == "corporate", Project.kind == "project")
        )
        if proj is not None:
            for cat in db.scalars(select(Catalog).where(Catalog.container_id == proj.id)):
                docstore.delete_file(str(cat.id))
            db.delete(proj)
            db.commit()
            print("deleted corporate project + cascaded catalog/chunks")

        # 2. Any function-level 'corp' catalog rows (none expected yet).
        for cat in db.scalars(select(Catalog).where(Catalog.function == "corp")):
            docstore.delete_file(str(cat.id))
            db.delete(cat)
        db.commit()

        # 3. git-remove the test dirs on disk.
        removed: list[str] = []
        for rel in ("projects/corporate", "corporate"):
            d = filestore.FILES_ROOT / rel
            if d.exists():
                shutil.rmtree(d)
                removed.append(rel)
        if removed:
            filestore.git_commit(removed, "wipe corporate test data")
            print("git-removed", removed)

        # 4. Recreate an empty corporate/ for the corp function stream.
        functions.provision_folders()
        print("re-provisioned function folders (corporate/ clean)")
    finally:
        db.close()


if __name__ == "__main__":
    wipe()

"""Per-user cross-device transfer — the "Transfer" moon.

Lets one person hand text (and later files) between their own browsers on
different computers. Device A creates an item; device B picks it up by polling
this list. Every item is scoped to the signed-in user, so nobody else's items
are ever visible.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db
from .models import TransferItem, User
from .schemas import TransferItemOut, TransferTextIn

router = APIRouter(prefix="/api/transfer", tags=["transfer"])


@router.get("", response_model=list[TransferItemOut])
def list_items(
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[TransferItem]:
    return list(
        db.scalars(
            select(TransferItem)
            .where(TransferItem.user_id == user.id)
            .order_by(TransferItem.created_at.desc())
        )
    )


@router.post("/text", response_model=TransferItemOut, status_code=status.HTTP_201_CREATED)
def create_text(
    body: TransferTextIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> TransferItem:
    item = TransferItem(user_id=user.id, kind="text", text=body.text)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    item = db.get(TransferItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
    db.delete(item)
    db.commit()

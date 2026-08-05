"""Per-user cross-device transfer — the "Transfer" moon.

Lets one person hand text (and later files) between their own browsers on
different computers. Device A creates an item; device B picks it up by polling
this list. Every item is scoped to the signed-in user, so nobody else's items
are ever visible.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db
from .models import TransferItem, User
from .schemas import TransferItemOut, TransferTextIn

router = APIRouter(prefix="/api/transfer", tags=["transfer"])

MAX_TRANSFER_BYTES = 100 * 1024 * 1024  # 100 MB, matching the upload cap


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


@router.post("/file", response_model=TransferItemOut, status_code=status.HTTP_201_CREATED)
async def create_file(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> TransferItem:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(data) > MAX_TRANSFER_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large (max 100 MB)"
        )
    item = TransferItem(
        user_id=user.id,
        kind="file",
        filename=(file.filename or "file")[:500],
        content_type=file.content_type,
        size=len(data),
        data=data,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{item_id}/download")
def download(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> Response:
    item = db.get(TransferItem, item_id)
    if item is None or item.user_id != user.id or item.kind != "file" or item.data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    name = (item.filename or "file").replace('"', "")
    return Response(
        content=item.data,
        media_type=item.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    item = db.get(TransferItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
    db.delete(item)  # drops the bytes with the row
    db.commit()

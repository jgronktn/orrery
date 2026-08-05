"""Per-user credential-account vault — the "Account Logins" surface.

Stores account metadata only (service, username, category, URL, notes, MFA
flag), never passwords (those live in Bitwarden). Every entry is scoped to the
signed-in user, so each person sees only their own list — and sees it on any
machine, since it now lives in Postgres rather than the browser's localStorage.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db
from .models import User, VaultLogin
from .schemas import VaultLoginIn, VaultLoginOut

router = APIRouter(prefix="/api/vault/logins", tags=["vault"])


@router.get("", response_model=list[VaultLoginOut])
def list_logins(
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[VaultLogin]:
    return list(
        db.scalars(
            select(VaultLogin)
            .where(VaultLogin.user_id == user.id)
            .order_by(VaultLogin.created_at)
        )
    )


@router.post("", response_model=VaultLoginOut, status_code=status.HTTP_201_CREATED)
def create_login(
    body: VaultLoginIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> VaultLogin:
    row = VaultLogin(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _owned(login_id: uuid.UUID, user: User, db: DbSession) -> VaultLogin:
    row = db.get(VaultLogin, login_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "login not found")
    return row


@router.put("/{login_id}", response_model=VaultLoginOut)
def update_login(
    login_id: uuid.UUID,
    body: VaultLoginIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> VaultLogin:
    row = _owned(login_id, user, db)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{login_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_login(
    login_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    row = _owned(login_id, user, db)
    db.delete(row)
    db.commit()

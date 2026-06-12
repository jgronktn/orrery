"""The approval queue: list pending proposals, approve (execute), reject."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .agents import REGISTRY
from .auth import current_user
from .db import get_db
from .governance import execute_proposal
from .models import ProposalRecord, User
from .schemas import ProposalOut

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


@router.get("", response_model=list[ProposalOut])
def list_approvals(
    status_filter: str = Query("pending", alias="status"),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[ProposalRecord]:
    stmt = select(ProposalRecord).where(ProposalRecord.user_id == user.id)
    if status_filter != "all":
        stmt = stmt.where(ProposalRecord.status == status_filter)
    return list(db.scalars(stmt.order_by(ProposalRecord.created_at.desc())))


def _get_pending(
    db: DbSession, user: User, proposal_id: uuid.UUID
) -> ProposalRecord:
    rec = db.get(ProposalRecord, proposal_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "proposal not found")
    if rec.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"proposal already {rec.status}"
        )
    return rec


@router.post("/{proposal_id}/approve", response_model=ProposalOut)
async def approve(
    proposal_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ProposalRecord:
    rec = _get_pending(db, user, proposal_id)
    agent = REGISTRY.get(rec.agent_id)
    if agent is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown agent")
    rec.decided_by = user.id
    await execute_proposal(db, rec, agent.url)  # sets executed | failed
    db.commit()
    db.refresh(rec)
    return rec


@router.post("/{proposal_id}/reject", response_model=ProposalOut)
def reject(
    proposal_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ProposalRecord:
    rec = _get_pending(db, user, proposal_id)
    rec.status = "rejected"
    rec.decided_by = user.id
    rec.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(rec)
    return rec

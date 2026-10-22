"""Operations (OPS) domains. One module per domain — table + router + agent
read route + timeline nodes — mounted here. Shipping is the first; inventory,
purchasing, … slot in beside it as `ops/<domain>.py` plus one line below.
"""
from __future__ import annotations

from fastapi import APIRouter

from . import shipments

router = APIRouter()
router.include_router(shipments.router)

internal_router = APIRouter()
internal_router.include_router(shipments.internal_router)

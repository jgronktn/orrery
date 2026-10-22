"""OPS shipping domain — shipments in and out, with their documents.

Humans create and edit shipments here (the UI form); the OPS agent reads them
through the internal route below and never writes. Each shipment owns a folder
in the store (ops/shipments/<YYYY>/<date>-<in|out>-<counterparty>-<id>) where its
documents — packing slips, carrier receipts — are saved together as cataloged
files, so they're versioned, text-extracted, and searchable by the agent.

Access: the Operations function's access check (same as /api/functions/ops).
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import or_, select
from sqlalchemy.orm import Session as DbSession

from .. import commit_path, projects, projectstore
from ..auth import current_user
from ..db import get_db
from ..functions_api import _resolve_stream
from ..internal import AgentContext, agent_context
from ..models import Project, Shipment, ShipmentDocument, User
from ..schemas import ShipmentDocOut, ShipmentIn, ShipmentOut

FUNCTION = "ops"
FACET = "shipping"
SHIPMENTS_DIR = "ops/shipments"  # each shipment's folder lives under here

router = APIRouter(prefix="/api/ops/shipments", tags=["ops"])
internal_router = APIRouter(prefix="/internal/agent/ops/shipments", tags=["internal-agent"])

# Carrier → its public tracking page. Matched case-insensitively on the carrier
# name; unknown carriers get no link (the tracking number still shows).
_TRACKING_URLS = {
    "ups": "https://www.ups.com/track?tracknum={n}",
    "fedex": "https://www.fedex.com/fedextrack/?trknbr={n}",
    "usps": "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}",
    "dhl": "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}",
}


def tracking_url(carrier: str, number: str) -> str | None:
    num = number.strip()
    if not num:
        return None
    key = re.sub(r"[^a-z]", "", carrier.lower())
    for name, template in _TRACKING_URLS.items():
        if name in key:
            return template.format(n=num)
    return None


def _folder_for(row: Shipment) -> str:
    """The shipment's own store folder, fixed at creation."""
    party = re.sub(r"[^a-z0-9]+", "-", row.counterparty.lower()).strip("-")[:40]
    way = "out" if row.direction == "outbound" else "in"
    name = "-".join(p for p in (row.shipped_on.isoformat(), way, party, row.id.hex[:6]) if p)
    return f"{SHIPMENTS_DIR}/{row.shipped_on.year}/{name}"


def _to_out(row: Shipment, db: DbSession) -> ShipmentOut:
    project_name = None
    if row.project_id is not None:
        project_name = db.scalar(select(Project.name).where(Project.id == row.project_id))
    return ShipmentOut(
        id=row.id, direction=row.direction, status=row.status,
        shipped_on=row.shipped_on, received_on=row.received_on,
        carrier=row.carrier, tracking_number=row.tracking_number,
        tracking_url=tracking_url(row.carrier, row.tracking_number),
        counterparty=row.counterparty, contents=row.contents, po_ref=row.po_ref,
        notes=row.notes, project_id=row.project_id, project_name=project_name,
        folder=row.folder,
        documents=[
            ShipmentDocOut(path=d.doc_path, name=d.doc_path.rsplit("/", 1)[-1])
            for d in row.documents
        ],
        created_at=row.created_at, updated_at=row.updated_at,
    )


def _query(
    db: DbSession,
    *,
    direction: str | None = None,
    q: str | None = None,
    since: date | None = None,
    until: date | None = None,
    project_id: uuid.UUID | None = None,
) -> list[Shipment]:
    """Shipments newest first, optionally filtered. `q` matches counterparty,
    contents, carrier, tracking number, PO ref, and notes."""
    stmt = select(Shipment)
    if direction:
        stmt = stmt.where(Shipment.direction == direction)
    if since:
        stmt = stmt.where(Shipment.shipped_on >= since)
    if until:
        stmt = stmt.where(Shipment.shipped_on <= until)
    if project_id:
        stmt = stmt.where(Shipment.project_id == project_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Shipment.counterparty.ilike(like), Shipment.contents.ilike(like),
                Shipment.carrier.ilike(like), Shipment.tracking_number.ilike(like),
                Shipment.po_ref.ilike(like), Shipment.notes.ilike(like),
            )
        )
    stmt = stmt.order_by(Shipment.shipped_on.desc(), Shipment.created_at.desc())
    return list(db.scalars(stmt))


def _check_project(project_id: uuid.UUID | None, user: User, db: DbSession) -> None:
    """A shipment may only be linked to a project the user is a member of."""
    if project_id is not None:
        projects.require_membership(project_id, user, db)


def _get(shipment_id: uuid.UUID, db: DbSession) -> Shipment:
    row = db.get(Shipment, shipment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "shipment not found")
    return row


# ── UI routes (humans create + edit) ────────────────────────────────


@router.get("", response_model=list[ShipmentOut])
def list_shipments(
    direction: str | None = None,
    q: str | None = None,
    since: date | None = None,
    until: date | None = None,
    project_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> list[ShipmentOut]:
    _resolve_stream(FUNCTION, user, db)
    rows = _query(db, direction=direction, q=q, since=since, until=until, project_id=project_id)
    return [_to_out(r, db) for r in rows]


@router.post("", response_model=ShipmentOut, status_code=status.HTTP_201_CREATED)
def create_shipment(
    body: ShipmentIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ShipmentOut:
    _resolve_stream(FUNCTION, user, db)
    _check_project(body.project_id, user, db)
    row = Shipment(id=uuid.uuid4(), created_by=user.id, **body.model_dump())
    row.folder = _folder_for(row)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row, db)


@router.get("/{shipment_id}", response_model=ShipmentOut)
def get_shipment(
    shipment_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ShipmentOut:
    _resolve_stream(FUNCTION, user, db)
    return _to_out(_get(shipment_id, db), db)


@router.put("/{shipment_id}", response_model=ShipmentOut)
def update_shipment(
    shipment_id: uuid.UUID,
    body: ShipmentIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ShipmentOut:
    _resolve_stream(FUNCTION, user, db)
    row = _get(shipment_id, db)
    if body.project_id != row.project_id:
        _check_project(body.project_id, user, db)
    # The folder stays put — edits never move a shipment's documents.
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return _to_out(row, db)


@router.delete("/{shipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shipment(
    shipment_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Delete the record and its document links. The files stay in the store
    (in the shipment's folder, with git history)."""
    _resolve_stream(FUNCTION, user, db)
    db.delete(_get(shipment_id, db))
    db.commit()


@router.post("/{shipment_id}/documents", response_model=ShipmentOut)
async def upload_shipment_documents(
    shipment_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ShipmentOut:
    """Attach one or more documents (packing slip, receipt, …) to a shipment.
    Each is saved into the shipment's own folder as a cataloged ops file
    (versioned, text-extracted, embedded for search) and linked to the record."""
    stream = _resolve_stream(FUNCTION, user, db)
    row = _get(shipment_id, db)
    payloads = [(f.filename or "document", await projects._read_upload(f)) for f in files]
    for filename, data in payloads:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        cat = commit_path.add_file(
            db, project=stream, function=FUNCTION, data=data, filename=filename,
            file_type=projectstore._type_for_ext(ext), ext=ext or None,
            source="upload", uploader=user, title=filename,
            description=f"Shipment document: {_label(row)}",
            occurred_at=datetime.now(timezone.utc), on_timeline=False,
            dest_dir=row.folder, background_tasks=background_tasks,
        )
        cat.sub_function = FACET
        db.add(ShipmentDocument(shipment_id=row.id, doc_path=cat.path))
        db.commit()
    db.refresh(row)
    return _to_out(row, db)


@router.delete("/{shipment_id}/documents", response_model=ShipmentOut)
def unlink_shipment_document(
    shipment_id: uuid.UUID,
    path: str,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
) -> ShipmentOut:
    """Unlink a document from the shipment. The file itself stays in the store."""
    _resolve_stream(FUNCTION, user, db)
    row = _get(shipment_id, db)
    link = next((d for d in row.documents if d.doc_path == path), None)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not attached")
    row.documents.remove(link)
    db.commit()
    db.refresh(row)
    return _to_out(row, db)


# ── Agent route (OPS reads; read-only) ──────────────────────────────


@internal_router.get("", response_model=list[ShipmentOut])
def agent_list_shipments(
    direction: str | None = None,
    q: str | None = None,
    since: date | None = None,
    until: date | None = None,
    ctx: AgentContext = Depends(agent_context),
    db: DbSession = Depends(get_db),
) -> list[ShipmentOut]:
    """The shipment log for the OPS agent. Only the ops agent may read it, and
    only on behalf of a user with Operations access."""
    if ctx.agent_id != "ops":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "shipments are read by the ops agent only")
    _resolve_stream(FUNCTION, ctx.user, db)
    rows = _query(db, direction=direction, q=q, since=since, until=until)
    return [_to_out(r, db) for r in rows[:200]]


# ── Timeline ────────────────────────────────────────────────────────


def _label(row: Shipment) -> str:
    arrow = "Out" if row.direction == "outbound" else "In"
    return f"{arrow} · {row.counterparty or 'unknown'} ({row.shipped_on.isoformat()})"


def timeline_nodes(container: Project, db: DbSession) -> list[dict]:
    """Shipment markers for a timeline: every shipment on the Operations
    stream; on a project, the shipments linked to it. Outbound sits at its ship
    date; inbound at its received date when known, else its ship date."""
    if container.kind == "function_stream":
        if container.function != FUNCTION:
            return []
        rows = _query(db)
    else:
        rows = _query(db, project_id=container.id)
    nodes: list[dict] = []
    for r in rows:
        day = r.received_on if r.direction == "inbound" and r.received_on else r.shipped_on
        when = datetime(day.year, day.month, day.day, 12, 0, tzinfo=timezone.utc)
        detail = " · ".join(
            p for p in (r.carrier, r.tracking_number, r.contents) if p
        )
        nodes.append(
            {
                "id": f"ship:{r.id}",
                "kind": "shipment",
                "name": f"{'Out' if r.direction == 'outbound' else 'In'} · {r.counterparty or 'Shipment'}",
                "time": int(when.timestamp() * 1000),
                "type": "shipment",
                "ext": None,
                "path": r.folder,
                "size": None,
                "desc": detail or None,
                "batch": None,
                "attached": len(r.documents) > 0,
                "status": r.status,
                "facet": FACET,
                "note": r.notes or None,
                # Same in/out convention as email: outbound above, inbound below.
                "direction": "out" if r.direction == "outbound" else "in",
            }
        )
    return nodes

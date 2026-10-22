import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  api,
  type Project,
  type Shipment,
  type ShipmentIn,
} from "../../api/client";
import { todayISO } from "./timelineScale";

// The Operations function's Shipping domain: the shipment log. People log
// shipments in and out with the form (dropping the packing slip, carrier
// receipt, … straight onto it); the OPS agent only reads them. Documents are
// saved together in the shipment's own folder and open in a new tab.

type Direction = "outbound" | "inbound";
type Status = ShipmentIn["status"];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_transit: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const CARRIERS = ["UPS", "FedEx", "USPS", "DHL"];

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const errText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;

export function ShipmentsPanel({
  accent,
  focus,
  onChanged,
}: {
  accent: string;
  /** A shipment to open in the form (e.g. its timeline marker was clicked).
   * `n` changes on every request, so re-clicking the same marker reopens it. */
  focus: { id: string; n: number } | null;
  /** Called after any create/edit/delete/attach, to refresh the timeline. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [dir, setDir] = useState<Direction | "">("");
  const [q, setQ] = useState("");
  // null = form closed; "new" = logging one; a Shipment = editing it.
  const [formFor, setFormFor] = useState<Shipment | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(
        await api.listShipments({
          direction: dir || undefined,
          q: q.trim() || undefined,
        }),
      );
      setError(null);
    } catch (e) {
      setError(errText(e, "Failed to load shipments"));
    } finally {
      setLoading(false);
    }
  }, [dir, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200); // debounce the search box
    return () => clearTimeout(t);
  }, [load]);

  // Open the focused shipment (fetched directly, so filters can't hide it).
  useEffect(() => {
    if (!focus) return;
    api
      .getShipment(focus.id)
      .then(setFormFor)
      .catch((e) => setError(errText(e, "Shipment not found")));
  }, [focus]);

  const afterChange = async (next: Shipment | "new" | null) => {
    setFormFor(next);
    await load();
    onChanged();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        {(["", "outbound", "inbound"] as const).map((d) => (
          <button
            key={d || "all"}
            onClick={() => setDir(d)}
            className="rounded-full border px-2.5 py-0.5 text-[11.5px]"
            style={
              dir === d
                ? { background: accent, borderColor: accent, color: "#fff" }
                : {
                    borderColor: "#d8d6cf",
                    color: "#5b5a52",
                    background: "#fff",
                  }
            }
          >
            {d === "" ? "All" : d === "outbound" ? "↑ Out" : "↓ In"}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search counterparty, PO, tracking…"
          className="min-w-[140px] flex-1 rounded-lg border border-line-soft bg-white px-2.5 py-1 text-[12px] text-ink outline-none placeholder:text-hint"
        />
        <button
          onClick={() => setFormFor((f) => (f === "new" ? null : "new"))}
          className="rounded-lg px-3 py-1 text-[12px] font-medium text-white"
          style={{ background: accent }}
        >
          ＋ Log shipment
        </button>
      </div>

      {/* An open shipment takes the whole section; Close returns to the log. */}
      {formFor !== null ? (
        <ShipmentForm
          key={formFor === "new" ? "new" : formFor.id}
          accent={accent}
          initial={formFor === "new" ? null : formFor}
          onSaved={(s) => void afterChange(s)}
          onDeleted={() => void afterChange(null)}
          onCancel={() => setFormFor(null)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p className="px-5 py-2.5 text-[12px] text-[#8a4a3c]">{error}</p>
          )}
          {loading ? (
            <p className="px-5 py-10 text-center text-[13px] text-hint">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-hint">
              {q || dir
                ? "No shipments match."
                : "No shipments yet. Log one with “＋ Log shipment”."}
            </p>
          ) : (
            <>
              <div
                className="grid items-center gap-3 border-b border-hairline px-5 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint-alt"
                style={{ gridTemplateColumns: COLS }}
              >
                <span />
                <span>Date</span>
                <span>Counterparty</span>
                <span>Carrier · tracking</span>
                <span>Status</span>
                <span>Docs</span>
              </div>
              {rows.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setFormFor(s)}
                  className="grid w-full items-center gap-3 border-b border-hairline px-5 py-2.5 text-left text-[12.5px] text-strong hover:bg-rowhover"
                  style={{ gridTemplateColumns: COLS }}
                >
                  <DirBadge direction={s.direction} accent={accent} />
                  <span className="font-mono text-[11.5px] text-muted">
                    {fmtDate(s.shipped_on)}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="block truncate font-medium text-ink"
                      title={s.counterparty}
                    >
                      {s.counterparty || "—"}
                    </span>
                    {(s.contents || s.po_ref) && (
                      <span className="block truncate text-[11px] text-hint">
                        {[s.po_ref, s.contents].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-[11.5px]">
                    {s.carrier || "—"}
                    {s.tracking_number && (
                      <>
                        {" · "}
                        {s.tracking_url ? (
                          <a
                            href={s.tracking_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono underline"
                            style={{ color: accent }}
                          >
                            {s.tracking_number}
                          </a>
                        ) : (
                          <span className="font-mono">{s.tracking_number}</span>
                        )}
                      </>
                    )}
                  </span>
                  <span className="text-[11.5px] text-muted">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {s.documents?.length ? `📎 ${s.documents.length}` : "—"}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const COLS = "46px 92px 1.3fr 1.4fr 78px 44px";

function DirBadge({
  direction,
  accent,
}: {
  direction: string;
  accent: string;
}) {
  const out = direction === "outbound";
  return (
    <span
      className="rounded px-1.5 py-0.5 text-center font-mono text-[9.5px] font-semibold uppercase"
      style={
        out
          ? { background: `${accent}1c`, color: accent }
          : { background: "#ece9e2", color: "#6a6658" }
      }
    >
      {out ? "↑ Out" : "↓ In"}
    </span>
  );
}

function ShipmentForm({
  accent,
  initial,
  onSaved,
  onDeleted,
  onCancel,
}: {
  accent: string;
  initial: Shipment | null;
  onSaved: (s: Shipment) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<Direction>(
    (initial?.direction as Direction) ?? "outbound",
  );
  const [status, setStatus] = useState<Status>(
    (initial?.status as Status) ?? "pending",
  );
  const [shippedOn, setShippedOn] = useState(initial?.shipped_on ?? todayISO());
  const [receivedOn, setReceivedOn] = useState(initial?.received_on ?? "");
  const [carrier, setCarrier] = useState(initial?.carrier ?? "");
  const [tracking, setTracking] = useState(initial?.tracking_number ?? "");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  const [poRef, setPoRef] = useState(initial?.po_ref ?? "");
  const [contents, setContents] = useState(initial?.contents ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [projectId, setProjectId] = useState(initial?.project_id ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  // Files dropped on the form, uploaded on Save.
  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState(initial?.documents ?? []);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .listProjects()
      .then((ps) => setProjects(ps.filter((p) => p.kind === "project")))
      .catch(() => undefined);
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    setFiles((cur) => [...cur, ...incoming]);
  };

  const submit = async () => {
    if (!shippedOn) return;
    setBusy(true);
    setError(null);
    const body: ShipmentIn = {
      direction,
      status,
      shipped_on: shippedOn,
      received_on: receivedOn || null,
      carrier: carrier.trim(),
      tracking_number: tracking.trim(),
      counterparty: counterparty.trim(),
      po_ref: poRef.trim(),
      contents: contents.trim(),
      notes: notes.trim(),
      project_id: projectId || null,
    };
    try {
      let saved = initial
        ? await api.updateShipment(initial.id, body)
        : await api.createShipment(body);
      if (files.length) saved = await api.uploadShipmentDocs(saved.id, files);
      onSaved(saved);
    } catch (e) {
      setError(errText(e, "Could not save the shipment"));
      setBusy(false);
    }
  };

  const unlink = async (path: string) => {
    if (!initial) return;
    try {
      const updated = await api.unlinkShipmentDoc(initial.id, path);
      setDocs(updated.documents ?? []);
      onSaved(updated);
    } catch (e) {
      setError(errText(e, "Could not detach the document"));
    }
  };

  const remove = async () => {
    if (!initial) return;
    try {
      await api.deleteShipment(initial.id);
      onDeleted();
    } catch (e) {
      setError(errText(e, "Could not delete the shipment"));
    }
  };

  const input =
    "w-full rounded-lg border border-line-soft bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-hint";
  const label =
    "mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-paper px-5 py-3.5">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
          {initial ? "Edit shipment" : "Log shipment"}
        </span>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-line-soft">
          {(["outbound", "inbound"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className="px-3 py-1 text-[12px]"
              style={
                direction === d
                  ? { background: accent, color: "#fff" }
                  : { background: "#fff", color: "#5b5a52" }
              }
            >
              {d === "outbound" ? "↑ Outbound" : "↓ Inbound"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
        <label className="col-span-2">
          <span className={label}>
            {direction === "outbound" ? "Shipped to" : "Received from"}
          </span>
          <input
            autoFocus
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="Vendor, customer, contract manufacturer…"
            className={input}
          />
        </label>
        <label>
          <span className={label}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className={input}
          >
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>Ship date *</span>
          <input
            type="date"
            value={shippedOn}
            onChange={(e) => setShippedOn(e.target.value)}
            className={input}
          />
        </label>
        <label>
          <span className={label}>
            {direction === "outbound" ? "Delivered" : "Received"}
          </span>
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            className={input}
          />
        </label>
        <label>
          <span className={label}>PO / order ref</span>
          <input
            value={poRef}
            onChange={(e) => setPoRef(e.target.value)}
            className={input}
          />
        </label>
        <label>
          <span className={label}>Carrier</span>
          <input
            list="orrery-carriers"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="UPS, FedEx, freight…"
            className={input}
          />
          <datalist id="orrery-carriers">
            {CARRIERS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="col-span-2">
          <span className={label}>Tracking #</span>
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            className={`${input} font-mono`}
          />
        </label>
        <label className="col-span-3">
          <span className={label}>Contents</span>
          <input
            value={contents}
            onChange={(e) => setContents(e.target.value)}
            placeholder="What shipped"
            className={input}
          />
        </label>
        <label>
          <span className={label}>Project (optional)</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={input}
          >
            <option value="">—</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2">
          <span className={label}>Notes</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={input}
          />
        </label>

        {/* documents: drop zone + attached + queued */}
        <div className="col-span-3">
          <span className={label}>Documents (packing slip, receipt, …)</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
            className="cursor-pointer rounded-lg border border-dashed px-3 py-3 text-center text-[12px]"
            style={{
              borderColor: over ? accent : "#cfccc3",
              background: over ? `${accent}12` : "#fff",
              color: over ? accent : "#8a877c",
            }}
          >
            Drop documents here, or click to choose files
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {(docs.length > 0 || files.length > 0) && (
            <ul className="mt-2 flex flex-col gap-1">
              {docs.map((d) => (
                <li
                  key={d.path}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span aria-hidden>📎</span>
                  <a
                    href={api.fileRawUrl(d.path)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate underline"
                    style={{ color: accent }}
                    title={d.path}
                  >
                    {d.name}
                  </a>
                  <button
                    onClick={() => void unlink(d.path)}
                    title="Detach from this shipment (the file is kept)"
                    className="text-[11px] text-hint hover:text-[#8a4a3c]"
                  >
                    detach
                  </button>
                </li>
              ))}
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 text-[12px] text-muted"
                >
                  <span aria-hidden>＋</span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="font-mono text-[10px] uppercase text-hint">
                    on save
                  </span>
                  <button
                    onClick={() =>
                      setFiles((cur) => cur.filter((_, j) => j !== i))
                    }
                    className="text-[11px] text-hint hover:text-[#8a4a3c]"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-[12px] text-[#8a4a3c]">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !shippedOn}
          className="rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          style={{ background: accent }}
        >
          {busy
            ? files.length
              ? "Saving + uploading…"
              : "Saving…"
            : initial
              ? "Save"
              : "Log shipment"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-line-soft bg-white px-3 py-1.5 text-[12px] text-strong-alt hover:bg-rowhover"
        >
          {initial ? "Close" : "Cancel"}
        </button>
        {initial &&
          (confirmDelete ? (
            <span className="ml-auto flex items-center gap-2 text-[12px] text-[#8a4a3c]">
              Delete this shipment? Its documents are kept.
              <button
                onClick={() => void remove()}
                className="font-medium underline"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-hint underline"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto text-[12px] text-hint hover:text-[#8a4a3c]"
            >
              Delete
            </button>
          ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type TransferItem } from "../../api/client";
import { relAgo } from "./time";

// The "Transfer" moon: a per-user cross-device hand-off. Text and files you send
// from one browser show up on your other browsers (same account) within a few
// seconds. Fills the center canvas like the LoginVault; the right rail stays.

const POLL_MS = 4000;

export function TransferView({
  accent,
  onClose,
}: {
  accent: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TransferItem[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.listTransfers());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load now, then poll so items sent from another device appear on their own
  // (no realtime channel yet — a short poll is the pragmatic stand-in).
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const created = await api.createTransferText(t);
      setItems((cur) => [created, ...cur]);
      setText("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        const created = await api.uploadTransferFile(f);
        setItems((cur) => [created, ...cur]);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not upload ${f.name}`);
      } finally {
        setUploading(null);
      }
    }
  };

  const remove = async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id)); // optimistic
    try {
      await api.deleteTransfer(id);
    } catch (e) {
      setItems(prev); // rollback
      setError(e instanceof Error ? e.message : "Could not remove");
    }
  };

  const copy = async (item: TransferItem) => {
    if (!item.text) return;
    try {
      await navigator.clipboard.writeText(item.text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure context) — ignore */
    }
  };

  return (
    <div
      className="relative flex h-full min-w-0 flex-1 flex-col bg-paper-alt"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-white/70 text-[14px] font-medium"
          style={{ boxShadow: `inset 0 0 0 2px ${accent}` }}
        >
          <span style={{ color: accent }}>Drop file to send to your devices</span>
        </div>
      )}

      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
            style={{ background: `${accent}1f`, color: accent }}
          >
            <TransferGlyph />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">Transfer</div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-hint">
              {items.length} item{items.length === 1 ? "" : "s"} · your devices · text &amp; files
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-line-soft bg-white px-3 py-1 text-[12px] text-strong-alt hover:bg-rowhover"
        >
          ‹ Back to map
        </button>
      </div>

      {/* composer */}
      <div className="border-b border-line bg-paper px-6 py-3">
        <textarea
          value={text}
          rows={6}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Paste or type text to send to your other devices…"
          className="w-full resize-y rounded-lg border border-line-soft bg-white px-3 py-2 text-[13px] text-ink outline-none placeholder:text-hint"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploading}
              className="rounded-lg border border-line-soft bg-white px-3 py-1.5 text-[12px] text-strong-alt hover:bg-rowhover disabled:opacity-50"
            >
              ＋ File
            </button>
            <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
              {uploading ? `Uploading ${uploading}…` : "or drop a file · ⌘/Ctrl + Enter to send text"}
            </span>
          </div>
          <button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            className="shrink-0 rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
            style={{ background: accent }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-6 py-2.5 text-[12px] text-[#8a4a3c]">{error}</p>}
        {loading ? (
          <p className="px-6 py-10 text-center text-[13px] text-hint">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] leading-relaxed text-hint">
            Nothing here yet. Send text or a file from any device signed in to this
            account and it shows up on the others.
          </p>
        ) : (
          items.map((it) =>
            it.kind === "file" ? (
              <div
                key={it.id}
                className="group flex items-center justify-between gap-3 border-b border-hairline px-6 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                    style={{ background: `${accent}14`, color: accent }}
                  >
                    <FileGlyph />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-strong" title={it.filename ?? "file"}>
                      {it.filename ?? "file"}
                    </div>
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint-alt">
                      {formatBytes(it.size ?? 0)} · {relAgo(Date.parse(it.created_at))}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <a
                    href={api.transferDownloadUrl(it.id)}
                    download={it.filename ?? true}
                    className="rounded-md border border-line-soft bg-white px-2 py-1 text-[11px] font-medium hover:brightness-105"
                    style={{ color: accent, borderColor: `${accent}66` }}
                  >
                    Download
                  </a>
                  <button
                    onClick={() => void remove(it.id)}
                    title="Remove"
                    aria-label="Remove item"
                    className="grid h-6 w-6 place-items-center rounded text-hint hover:bg-line hover:text-[#8a4a3c]"
                  >
                    <XGlyph />
                  </button>
                </div>
              </div>
            ) : (
              <div key={it.id} className="group border-b border-hairline px-6 py-3">
                <div className="flex items-start justify-between gap-3">
                  <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-strong">
                    {it.text}
                  </pre>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => void copy(it)}
                      title="Copy to clipboard"
                      className="rounded-md border border-line-soft bg-white px-2 py-1 text-[11px] text-strong-alt hover:bg-rowhover"
                      style={copiedId === it.id ? { color: accent, borderColor: accent } : undefined}
                    >
                      {copiedId === it.id ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={() => void remove(it.id)}
                      title="Remove"
                      aria-label="Remove item"
                      className="grid h-6 w-6 place-items-center rounded text-hint hover:bg-line hover:text-[#8a4a3c]"
                    >
                      <XGlyph />
                    </button>
                  </div>
                </div>
                <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint-alt">
                  {relAgo(Date.parse(it.created_at))}
                </div>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function TransferGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2.5 5.5h9M9 3l2.5 2.5L9 8M13.5 10.5h-9M7 8L4.5 10.5 7 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M4 1.5h5L12.5 5v9.5a0 0 0 0 1 0 0H4a0 0 0 0 1 0 0V1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

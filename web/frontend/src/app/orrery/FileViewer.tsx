import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../../api/client";

// Inline file viewer for Company Home: fills the center canvas (right of the
// filesystem panel). Image/PDF embed raw bytes; text-ish files render the
// catalog's extracted text (markdown/csv/plain). Warm-paper styled.

const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

const HDR_BTN =
  "rounded-lg border border-line-soft bg-white px-3 py-1 text-[12px] text-strong-alt hover:bg-rowhover";

export interface PreviewFile {
  path: string;
  name: string;
  ext: string;
}

export function FileViewer({
  file,
  folders,
  onClose,
  onRename,
  onMove,
  onDelete,
}: {
  file: PreviewFile;
  folders: string[];
  onClose: () => void;
  onRename: (path: string, newName: string) => void;
  onMove: (path: string, targetDir: string) => void;
  onDelete: (path: string) => void;
}) {
  const e = file.ext.toLowerCase();
  const isImg = IMG.has(e);
  const isPdf = e === "pdf";
  const needsText = !isImg && !isPdf;
  const raw = api.fileRawUrl(file.path);

  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(needsText);
  const [act, setAct] = useState<"idle" | "rename" | "move" | "delete">("idle");
  const [draft, setDraft] = useState(file.name);

  // Force a save to Downloads (a plain <a download> opens inline for types the
  // browser previews, e.g. PDFs): fetch the bytes and click an object URL.
  const download = async () => {
    try {
      const res = await fetch(raw, { credentials: "include" });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.style.display = "none";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      // Defer cleanup — revoking synchronously can cancel the queued download
      // and make the browser fall back to opening the blob in a tab.
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1500);
    } catch {
      /* network/permission error — surface nothing for now */
    }
  };

  useEffect(() => {
    if (!needsText) return;
    let live = true;
    setLoading(true);
    api
      .fileText(file.path)
      .then((r) => live && setText(r.text))
      .catch(() => live && setText(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [file.path, needsText]);

  let body: React.ReactNode;
  if (isImg) {
    body = (
      <img src={raw} alt={file.name} className="max-h-full max-w-full object-contain" />
    );
  } else if (isPdf) {
    body = <iframe src={raw} title={file.name} className="h-full w-full" style={{ border: 0 }} />;
  } else if (loading) {
    body = <span className="text-[13px] text-hint">Loading…</span>;
  } else if (text == null) {
    body = (
      <span className="text-[13px] text-hint">
        No inline preview for this file type — download it instead.
      </span>
    );
  } else if (e === "csv") {
    body = <CsvTable text={text} />;
  } else if (e === "md" || e === "mdx") {
    body = (
      <div className="prose-orrery max-w-[760px] text-[14px] leading-relaxed text-strong [&_a]:text-strong [&_a]:underline [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1.5 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    );
  } else {
    body = (
      <pre className="w-full whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-strong">
        {text}
      </pre>
    );
  }

  const alignTop = needsText && !loading && text != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-alt">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-3.5">
        {act === "rename" ? (
          <input
            autoFocus
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                const v = draft.trim();
                if (v && v !== file.name) onRename(file.path, v);
                setAct("idle");
              } else if (ev.key === "Escape") setAct("idle");
            }}
            onBlur={() => setAct("idle")}
            className="min-w-0 flex-1 rounded border border-line-soft bg-white px-2 py-1 font-mono text-[13px] text-ink outline-none"
          />
        ) : (
          <span className="truncate font-mono text-[13px] text-ink" title={file.path}>
            {file.name}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {act === "delete" ? (
            <>
              <span className="text-[12px] text-muted">Delete this file?</span>
              <button onClick={() => setAct("idle")} className={HDR_BTN}>
                Cancel
              </button>
              <button
                onClick={() => onDelete(file.path)}
                className="rounded-lg bg-ink px-3 py-1 text-[12px] text-[#f4f6ee] hover:bg-ink-soft"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setDraft(file.name);
                  setAct("rename");
                }}
                className={HDR_BTN}
              >
                Rename
              </button>
              <div className="relative">
                <button
                  onClick={() => setAct((a) => (a === "move" ? "idle" : "move"))}
                  className={HDR_BTN}
                >
                  Move
                </button>
                {act === "move" && (
                  <HeaderMoveMenu
                    folders={folders}
                    onPick={(d) => {
                      onMove(file.path, d);
                      setAct("idle");
                    }}
                    onClose={() => setAct("idle")}
                  />
                )}
              </div>
              <button onClick={() => setAct("delete")} className={HDR_BTN}>
                Delete
              </button>
              <button onClick={() => void download()} className={HDR_BTN}>
                Download
              </button>
              <button onClick={onClose} className={HDR_BTN}>
                ‹ Back to map
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto p-6 ${
          isImg || isPdf
            ? "grid place-items-center"
            : alignTop
              ? ""
              : "grid place-items-center"
        }`}
      >
        {body}
      </div>
    </div>
  );
}

function CsvTable({ text }: { text: string }) {
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.length)
    .slice(0, 200)
    .map((l) => l.split(","));
  return (
    <table className="border-collapse text-[12px] text-strong">
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((c, i) => (
              <td key={i} className="border border-line px-2 py-1">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HeaderMoveMenu({
  folders,
  onPick,
  onClose,
}: {
  folders: string[];
  onPick: (dir: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden
      />
      <div className="absolute right-0 top-9 z-50 max-h-72 w-52 overflow-y-auto rounded-lg border border-line-soft bg-white py-1 shadow-[0_8px_24px_-8px_rgba(20,18,12,.3)]">
        <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-hint">
          Move to
        </div>
        <button
          onClick={() => onPick("")}
          className="block w-full px-3 py-1 text-left text-[12.5px] text-strong hover:bg-rowhover"
        >
          Root
        </button>
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => onPick(f)}
            className="block w-full truncate px-3 py-1 text-left text-[12.5px] text-strong hover:bg-rowhover"
            title={f}
          >
            {f}
          </button>
        ))}
      </div>
    </>
  );
}

// In-overlay file preview (note §7): markdown / text / image / PDF / csv-table.
// Image + PDF embed the raw bytes; text-ish files use the catalog's extracted
// text. A centered dark panel over the ATLAS browser; Esc or ✕ to close.
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../api/client";

const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

function CsvTable({ text }: { text: string }) {
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.length)
    .slice(0, 200)
    .map((l) => l.split(","));
  return (
    <table className="border-collapse text-xs" style={{ color: "#c4cee0" }}>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((c, i) => (
              <td
                key={i}
                style={{ border: "1px solid rgba(120,160,220,.18)", padding: "3px 7px" }}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FilePreview({
  path,
  name,
  ext,
  onClose,
}: {
  path: string;
  name: string;
  ext: string;
  onClose: () => void;
}) {
  const e = (ext || "").toLowerCase();
  const isImg = IMG.has(e);
  const isPdf = e === "pdf";
  const needsText = !isImg && !isPdf;
  const raw = api.fileRawUrl(path);

  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(needsText);

  useEffect(() => {
    if (!needsText) return;
    let live = true;
    setLoading(true);
    api
      .fileText(path)
      .then((r) => live && setText(r.text))
      .catch(() => live && setText(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, needsText]);

  useEffect(() => {
    const onKey = (k: KeyboardEvent) => k.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: React.ReactNode;
  if (isImg) {
    body = (
      <img src={raw} alt={name} className="max-h-full max-w-full object-contain" />
    );
  } else if (isPdf) {
    body = <iframe src={raw} title={name} className="h-full w-full" style={{ border: 0 }} />;
  } else if (loading) {
    body = <span style={{ color: "#5b6a82" }}>Loading…</span>;
  } else if (text == null) {
    body = (
      <span style={{ color: "#5b6a82" }}>
        No inline preview for this file type — download it instead.
      </span>
    );
  } else if (e === "csv") {
    body = <CsvTable text={text} />;
  } else if (e === "md" || e === "mdx") {
    body = (
      <div className="text-sm leading-relaxed [&_a]:text-sky-400 [&_a]:underline [&_h1]:font-semibold [&_h1]:mt-3 [&_h2]:font-semibold [&_h2]:mt-3 [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1.5 [&_table]:my-2 [&_td]:border [&_td]:border-slate-600 [&_td]:px-2 [&_th]:border [&_th]:border-slate-600 [&_th]:px-2" style={{ color: "#dce3ef" }}>
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    );
  } else {
    body = (
      <pre className="whitespace-pre-wrap text-xs" style={{ color: "#c4cee0", fontFamily: "'JetBrains Mono',monospace" }}>
        {text}
      </pre>
    );
  }

  return (
    <div
      className="absolute inset-0 z-[60] grid place-items-center p-8"
      style={{ background: "rgba(2,4,9,.6)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-[min(900px,90%)] flex-col overflow-hidden rounded-2xl"
        style={{ height: "82%", background: "rgba(8,12,21,.97)", border: "1px solid rgba(120,160,220,.2)", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid rgba(120,160,220,.14)" }}>
          <span className="truncate" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: "#eef2f8" }} title={path}>
            {name}
          </span>
          <div className="flex items-center gap-2">
            <a
              href={raw}
              download={name}
              className="rounded-lg px-3 py-1 text-xs"
              style={{ border: "1px solid rgba(120,160,220,.22)", color: "#c4cee0" }}
            >
              Download
            </a>
            <button onClick={onClose} style={{ border: "none", background: "none", color: "#5b6a82", cursor: "pointer", fontSize: 16 }}>
              ✕
            </button>
          </div>
        </div>
        <div className="grid flex-1 place-items-center overflow-auto p-4">{body}</div>
      </div>
    </div>
  );
}

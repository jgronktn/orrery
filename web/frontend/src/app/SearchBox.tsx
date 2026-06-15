// Container-scoped file search (note §8). Keyword always (Postgres FTS);
// semantic toggle queries the `documents` collection. No agent involved.
import { useState, type FormEvent } from "react";

import { api, ApiError, type SearchHit } from "../api/client";

// ts_headline marks matches with <b>…</b>. Render them as <strong> via a safe
// split — never dangerouslySetInnerHTML over file-derived text.
function Highlight({ text }: { text: string }) {
  const parts = text.split(/(<b>.*?<\/b>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<b>") ? (
          <strong key={i} className="text-slate-800">
            {p.slice(3, -4)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function SearchBox({ projectId }: { projectId: string }) {
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await api.searchContainer(projectId, query, semantic));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "search failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Search
      </h2>
      <form onSubmit={run} className="flex flex-col gap-2">
        <input
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
          placeholder="Search files in this context…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={semantic}
              onChange={(e) => setSemantic(e.target.checked)}
            />
            semantic
          </label>
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="rounded-lg bg-slate-200 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
          >
            {busy ? "…" : "Search"}
          </button>
        </div>
      </form>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {results && (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {results.length === 0 && (
            <li className="text-xs text-slate-400">No matches.</li>
          )}
          {results.map((r) => (
            <li key={`${r.id}-${r.mode}`} className="text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  {r.type}
                </span>
                <span
                  className="truncate font-medium text-slate-700"
                  title={r.path}
                >
                  {r.title}
                </span>
              </div>
              {r.snippet && (
                <p className="text-xs leading-snug text-slate-500">
                  <Highlight text={r.snippet} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

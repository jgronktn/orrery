import { useState, type FormEvent } from "react";

import type { Project } from "../api/client";

export default function Projects({
  projects,
  activeId,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), description.trim());
      setName("");
      setDescription("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  const itemClass = (active: boolean) =>
    `w-full text-left rounded-lg px-3 py-2 text-sm ${
      active ? "bg-slate-800 text-white" : "hover:bg-slate-100 text-slate-700"
    }`;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-2 min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Projects
        </h2>
        <button
          className="text-xs text-slate-500 hover:text-slate-800"
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? "Cancel" : "+ New"}
        </button>
      </div>

      {adding && (
        <form onSubmit={submit} className="flex flex-col gap-2 pb-2">
          <input
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-slate-800 text-white py-1 text-sm disabled:opacity-50"
          >
            Create
          </button>
        </form>
      )}

      <nav className="flex flex-col gap-1 overflow-y-auto">
        <button
          className={itemClass(activeId === null)}
          onClick={() => onSelect(null)}
        >
          🌐 Global
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            className={itemClass(activeId === p.id)}
            onClick={() => onSelect(p.id)}
            title={p.description ?? undefined}
          >
            {p.name}
          </button>
        ))}
        {projects.length === 0 && (
          <p className="px-3 py-1 text-xs text-slate-400">No projects yet.</p>
        )}
      </nav>
    </section>
  );
}

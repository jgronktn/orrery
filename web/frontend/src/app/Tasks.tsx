import { useState, type FormEvent } from "react";

import type { Task } from "../api/client";

export default function Tasks({
  tasks,
  onAdd,
}: {
  tasks: Task[];
  onAdd: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(title.trim());
      setTitle("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Tasks
      </h2>
      <ul className="flex flex-col gap-1">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-sm text-slate-700">
            <span className="text-slate-400">○</span>
            {t.title}
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="text-xs text-slate-400">No tasks yet.</li>
        )}
      </ul>
      <form onSubmit={submit} className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          placeholder="Add a task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-lg bg-slate-200 px-2 py-1 text-sm text-slate-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </section>
  );
}

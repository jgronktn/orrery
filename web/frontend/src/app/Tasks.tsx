import { useState, type FormEvent } from "react";

import type { Task } from "../api/client";

const KINDS = [
  { value: "task", label: "Task", glyph: "○" },
  { value: "milestone", label: "Milestone", glyph: "◆" },
  { value: "reminder", label: "Reminder", glyph: "◔" },
] as const;

const glyphFor = (kind: string) =>
  KINDS.find((k) => k.value === kind)?.glyph ?? "○";

export default function Tasks({
  tasks,
  onAdd,
}: {
  tasks: Task[];
  onAdd: (title: string, dueDate: string | null, kind: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("task");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(title.trim(), dueDate || null, kind);
      setTitle("");
      setDueDate("");
      setKind("task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Action items
      </h2>
      <ul className="flex flex-col gap-1">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <span className="text-slate-400" title={t.kind}>
              {glyphFor(t.kind)}
            </span>
            <span className="flex-1 truncate">{t.title}</span>
            {t.due_date && (
              <span className="text-xs text-slate-400">{t.due_date}</span>
            )}
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="text-xs text-slate-400">No action items yet.</li>
        )}
      </ul>

      <form onSubmit={submit} className="flex flex-col gap-2 pt-1">
        <input
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
          placeholder="Add a task, milestone, or reminder"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            title="Kind"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.glyph} {k.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            title={kind === "task" ? "Due date (optional)" : "Date"}
          />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="rounded-lg bg-slate-200 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </form>
    </section>
  );
}

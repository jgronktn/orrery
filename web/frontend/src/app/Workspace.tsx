import { useEffect, useState, type FormEvent } from "react";

import {
  api,
  ApiError,
  type Message,
  type Project,
  type ProposalRecord,
  type Task,
} from "../api/client";
import Approvals from "./Approvals";
import { ALL_PROJECTS } from "./constants";
import Messages from "./Messages";
import Projects from "./Projects";
import Tasks from "./Tasks";
import Timeline from "./Timeline";

const AGENT_ID = "engineering";

export default function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); // null = global
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ProposalRecord[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = () =>
    api.listApprovals().then(setApprovals).catch(console.error);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(console.error);
    void loadApprovals();
  }, []);

  const approve = async (id: string) => {
    await api.approveProposal(id);
    void loadApprovals();
  };
  const reject = async (id: string) => {
    await api.rejectProposal(id);
    void loadApprovals();
  };

  // "All" is an overview pseudo-context (stacked timelines), not a real
  // project — it has no conversation or task list of its own.
  const isProject = activeId !== null && activeId !== ALL_PROJECTS;
  const isAll = activeId === ALL_PROJECTS;

  // Load the (persisted) conversation + tasks whenever the context changes.
  useEffect(() => {
    if (isAll) {
      setMessages([]);
      setTasks([]);
      return;
    }
    let cancelled = false;
    api
      .getMessages(AGENT_ID, activeId)
      .then((m) => !cancelled && setMessages(m))
      .catch(console.error);
    if (activeId) {
      api
        .listTasks(activeId)
        .then((t) => !cancelled && setTasks(t))
        .catch(console.error);
    } else {
      setTasks([]);
    }
    return () => {
      cancelled = true;
    };
  }, [activeId, isAll]);

  const createProject = async (name: string, description: string) => {
    const p = await api.createProject({ name, description: description || null });
    setProjects((prev) => [p, ...prev]);
    setActiveId(p.id);
  };

  const addTask = async (
    title: string,
    dueDate: string | null,
    kind: string,
  ) => {
    if (activeId === null || activeId === ALL_PROJECTS) return;
    const t = await api.createTask(activeId, {
      title,
      due_date: dueDate,
      kind,
    });
    setTasks((prev) => [t, ...prev]);
  };

  // Remove a whole exchange — the user prompt plus the assistant response(s)
  // that follow it (up to the next prompt) — pruning it from the context the
  // agent sees next turn. Optimistic; a 404 just means it was never persisted.
  const deleteTurn = async (userMessageId: string) => {
    const idx = messages.findIndex((m) => m.id === userMessageId);
    if (idx === -1) return;
    const ids = [userMessageId];
    for (let j = idx + 1; j < messages.length; j++) {
      const mj = messages[j];
      if (!mj || mj.role === "user") break;
      ids.push(mj.id);
    }
    setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
    for (const id of ids) {
      try {
        await api.deleteMessage(AGENT_ID, id);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) console.error(err);
      }
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setError(null);
    setQuery("");
    // Optimistically show the user's turn while the agent works.
    const optimistic: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      artifacts: null,
      proposals: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setBusy(true);
    try {
      // The backend returns both persisted turns (user + assistant) with real
      // ids; swap them in for the optimistic placeholder.
      const turns = await api.sendMessage(AGENT_ID, {
        query: q,
        project_id: activeId,
      });
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        ...turns,
      ]);
      void loadApprovals(); // a turn may have queued proposals

    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Agent request failed");
    } finally {
      setBusy(false);
    }
  };

  const activeName =
    activeId === null
      ? "Global"
      : isAll
        ? "All projects"
        : (projects.find((p) => p.id === activeId)?.name ?? "Project");

  return (
    <div className="grid grid-cols-[20rem_1fr] gap-4 h-full min-h-0">
      {/* Left column: approvals, projects, tasks, ask box */}
      <aside className="flex flex-col gap-4 min-h-0 overflow-y-auto">
        <Approvals proposals={approvals} onApprove={approve} onReject={reject} />

        <Projects
          projects={projects}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={createProject}
        />

        {isProject && <Tasks tasks={tasks} onAdd={addTask} />}

        {!isAll && (
        <form
          onSubmit={send}
          className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Ask engineering · {activeName}
          </h2>
          <textarea
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            rows={4}
            placeholder="e.g. what relay do we spec? — or research a 10A current-sense amp"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e);
            }}
          />
          <button
            type="submit"
            disabled={busy || query.trim() === ""}
            className="rounded-lg bg-slate-800 text-white py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Thinking…" : "Send  (⌘/Ctrl+Enter)"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        )}
      </aside>

      {/* Right column. All → stacked per-project timelines fill the area;
          a project → timeline strip (~200px) above the conversation canvas;
          global → just the conversation canvas. */}
      <div className="flex flex-col gap-4 min-h-0">
        {isAll ? (
          <main className="flex flex-1 flex-col gap-4 overflow-y-auto min-h-0">
            {projects.map((p) => (
              <Timeline key={p.id} activeId={p.id} projectName={p.name} />
            ))}
          </main>
        ) : (
          <>
            {isProject && (
              <Timeline activeId={activeId} projectName={activeName} />
            )}
            <main className="flex-1 rounded-xl border border-slate-200 bg-white p-6 overflow-y-auto min-h-0">
              <Messages
                messages={messages}
                busy={busy}
                onDelete={deleteTurn}
                emptyHint={`Ask the engineering agent in the ${activeName} context.`}
              />
            </main>
          </>
        )}
      </div>
    </div>
  );
}

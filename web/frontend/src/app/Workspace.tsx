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
import Messages from "./Messages";
import Projects from "./Projects";
import Tasks from "./Tasks";

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

  // Load the (persisted) conversation + tasks whenever the context changes.
  useEffect(() => {
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
  }, [activeId]);

  const createProject = async (name: string, description: string) => {
    const p = await api.createProject({ name, description: description || null });
    setProjects((prev) => [p, ...prev]);
    setActiveId(p.id);
  };

  const addTask = async (title: string) => {
    if (!activeId) return;
    const t = await api.createTask(activeId, title);
    setTasks((prev) => [t, ...prev]);
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
      const assistant = await api.sendMessage(AGENT_ID, {
        query: q,
        project_id: activeId,
      });
      setMessages((prev) => [...prev, assistant]);
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

        {activeId && <Tasks tasks={tasks} onAdd={addTask} />}

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
      </aside>

      {/* Right column: conversation canvas */}
      <main className="rounded-xl border border-slate-200 bg-white p-6 overflow-y-auto min-h-0">
        <Messages
          messages={messages}
          busy={busy}
          emptyHint={`Ask the engineering agent in the ${activeName} context.`}
        />
      </main>
    </div>
  );
}

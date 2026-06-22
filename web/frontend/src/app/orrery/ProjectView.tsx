import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import {
  ApiError,
  api,
  type Project,
  type ProposalRecord,
  type Task,
  type TimelineNode,
} from "../../api/client";
import { FileViewer, type PreviewFile } from "./FileViewer";
import { FunctionFiles } from "./FunctionFiles";
import { FunctionTimeline } from "./FunctionTimeline";
import { AskBar } from "./RightRail";
import { Shell } from "./Shell";
import { accentOf } from "./theme";
import { isActivity } from "./timelineScale";
import { AskAnswer, Composer, DetailPanel, KINDS } from "./timelineSurface";

const PROJECT_AGENT = "engineering"; // the (only) agent attached to projects today

// A single bounded project: a ~250px activity timeline + composer in the main
// area, and a 25% right sidebar listing open items over the agent ask. The
// rest of the main area (below the timeline) is built out next.
export default function ProjectView() {
  const { id = "" } = useParams();

  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<TimelineNode[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ProposalRecord[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [ask, setAsk] = useState<{ prompt: string; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [addKind, setAddKind] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addDue, setAddDue] = useState("");
  // Filesystem panel (left of the lower canvas) + open-file preview.
  const [folders, setFolders] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  const accent = accentOf(project?.function ?? "");

  const loadTimeline = useCallback(() => {
    api.projectTimeline(id).then(setNodes).catch(() => undefined);
  }, [id]);
  const loadTasks = useCallback(() => {
    api.listTasks(id).then(setTasks).catch(() => undefined);
  }, [id]);
  const loadApprovals = useCallback(() => {
    api.listApprovals().then(setApprovals).catch(() => undefined);
  }, []);
  const refresh = () => {
    loadTimeline();
    loadTasks();
    setReloadToken((n) => n + 1);
  };

  useEffect(() => {
    api.getProject(id).then(setProject).catch((e) => setErr(String(e)));
  }, [id]);
  useEffect(() => loadTimeline(), [loadTimeline]);
  useEffect(() => loadTasks(), [loadTasks]);
  useEffect(() => loadApprovals(), [loadApprovals]);
  useEffect(() => {
    let live = true;
    api
      .projectFolders(id)
      .then((f) => live && setFolders(f))
      .catch(() => live && setFolders([]));
    return () => {
      live = false;
    };
  }, [id, reloadToken]);

  const focusNode = preview ? nodes.find((n) => n.path === preview.path) ?? null : null;
  const shown = (() => {
    const base = showAll ? nodes : nodes.filter(isActivity);
    return focusNode && !base.some((n) => n.id === focusNode.id)
      ? [...base, focusNode]
      : base;
  })();
  const current = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null;
  const projApprovals = approvals.filter((p) => p.project_id === id);

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : String(e));

  const onDropFile = async (file: File) => {
    try {
      await api.uploadDocument(id, file);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const onAddTask = async (title: string, kind: string, due: string | null) => {
    try {
      await api.createTask(id, { title, kind, due_date: due });
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const submitAdd = () => {
    const t = addTitle.trim();
    if (!t || !addKind) return;
    void onAddTask(t, addKind, addDue || null);
    setAddKind(null);
    setAddTitle("");
    setAddDue("");
  };
  const onDropKind = (kind: string, timeMs: number) => {
    setAddKind(kind);
    setAddTitle("");
    setAddDue(new Date(timeMs).toISOString().slice(0, 10));
  };
  const onSetNote = async (node: TimelineNode, note: string | null) => {
    try {
      await api.setTimelineNote(id, node.id, note);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const onSetDate = async (node: TimelineNode, date: string) => {
    try {
      await api.setTimelineDate(id, node.id, date);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const onDelete = async (node: TimelineNode) => {
    try {
      if (node.id.startsWith("doc:")) await api.deleteDocument(id, node.id.slice(4));
      else if (node.id.startsWith("task:")) await api.deleteTask(id, node.id.slice(5));
      else return;
      setSelectedId(null);
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  // Filesystem panel ops.
  const afterFileOp = (path: string, res: { status: string }) => {
    if (res.status === "queued") setErr("Change queued for approval.");
    refresh();
    setPreview((p) => (p?.path === path ? null : p));
  };
  const onFileRename = async (path: string, newName: string) => {
    try {
      afterFileOp(path, await api.renameFile(path, newName));
    } catch (e) {
      fail(e);
    }
  };
  const onFileMove = async (path: string, targetDir: string) => {
    try {
      afterFileOp(path, await api.moveFile(path, targetDir));
    } catch (e) {
      fail(e);
    }
  };
  const onFileDelete = async (path: string) => {
    try {
      afterFileOp(path, await api.deleteFile(path));
    } catch (e) {
      fail(e);
    }
  };
  const onAddFolder = async (parent: string, folderName: string) => {
    try {
      setFolders(await api.createProjectFolder(id, parent, folderName));
      setReloadToken((n) => n + 1);
    } catch (e) {
      fail(e);
    }
  };
  const onDeleteFolder = async (path: string) => {
    try {
      const res = await api.deleteProjectFolder(id, path);
      if (res.status === "queued") setErr("Folder delete queued for approval.");
      refresh();
      const full = project ? `projects/${project.slug}/${path}` : path;
      setPreview((p) =>
        p && (p.path === full || p.path.startsWith(full + "/")) ? null : p,
      );
    } catch (e) {
      fail(e);
    }
  };
  const resolve = async (pid: string, okay: boolean) => {
    try {
      if (okay) await api.approveProposal(pid);
      else await api.rejectProposal(pid);
      loadApprovals();
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const onAsk = async (prompt: string) => {
    setBusy(true);
    setAsk({ prompt, answer: "" });
    try {
      const msgs = await api.sendMessage(PROJECT_AGENT, { query: prompt, project_id: id });
      const last = [...msgs].reverse().find((m) => m.role === "assistant");
      setAsk({ prompt, answer: last?.content ?? "(no response)" });
    } catch (e) {
      setAsk({ prompt, answer: `⚠ ${e instanceof ApiError ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  };

  const fnKey = project?.function ?? "";

  return (
    <Shell
      company="PPI"
      crumbs={[
        { label: "Map", to: "/", back: true },
        ...(fnKey ? [{ label: fnKey, to: `/fn/${fnKey}`, dot: accent }] : []),
        { label: project?.name ?? "Project", mono: false },
        { label: "PROJECT", mono: true },
      ]}
      status={`${(project?.name ?? "PROJECT").toUpperCase()}`}
    >
      <div className="flex h-full min-h-0">
        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {err && (
            <div className="border-b border-line bg-[#fbecea] px-6 py-2 text-[12px] text-[#8a3b2e]">
              {err}
            </div>
          )}

          <div className="flex items-center justify-between px-8 py-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
              <span className="truncate text-[22px] font-semibold text-ink">
                {project?.name ?? "Project"}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                Project · {shown.length}
              </span>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all files
            </label>
          </div>

          <Composer
            kind={addKind}
            title={addTitle}
            due={addDue}
            disabled={!project}
            onChoose={(k) => {
              setAddKind((cur) => (cur === k ? null : k));
              setAddTitle("");
              setAddDue("");
            }}
            onTitle={setAddTitle}
            onDue={setAddDue}
            onSubmit={submitAdd}
            onCancel={() => setAddKind(null)}
          />

          <div className="shrink-0 border-b border-line" style={{ height: 250 }}>
            <FunctionTimeline
              nodes={shown}
              accent={accent}
              selectedId={current?.id ?? null}
              focusTime={focusNode?.time ?? null}
              onSelect={(n) => setSelectedId(n ? n.id : null)}
              onDropFile={(f) => void onDropFile(f)}
              onDropKind={onDropKind}
            />
          </div>

          {/* below the timeline — left half = project file system; right =
              open file preview / agent answer (rest built next) */}
          <div className="flex min-h-0 flex-1">
            <div className="flex w-1/2 min-w-0 border-r border-line">
              {project && (
                <FunctionFiles
                  variant="fill"
                  containerKey={id}
                  title={`${project.name} files`}
                  accent={accent}
                  rootPrefix={`projects/${project.slug}`}
                  loadTree={() => api.projectTree(id)}
                  upload={(file, dir) => api.uploadDocument(id, file, dir)}
                  folders={folders}
                  reloadToken={reloadToken}
                  onOpenFile={setPreview}
                  activePath={preview?.path ?? null}
                  onUploaded={refresh}
                  onRename={onFileRename}
                  onMove={onFileMove}
                  onDelete={onFileDelete}
                  onAddFolder={onAddFolder}
                  onDeleteFolder={onDeleteFolder}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {ask ? (
                <AskAnswer
                  accent={accent}
                  prompt={ask.prompt}
                  answer={ask.answer}
                  busy={busy}
                  onClose={() => setAsk(null)}
                />
              ) : preview ? (
                <FileViewer
                  file={preview}
                  folders={folders}
                  onClose={() => setPreview(null)}
                  onRename={onFileRename}
                  onMove={onFileMove}
                  onDelete={onFileDelete}
                />
              ) : (
                <div className="grid h-full place-items-center text-[12.5px] text-hint">
                  Project detail — coming next.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* right sidebar — open items (or selected detail) over the agent ask */}
        <aside className="flex w-[25%] min-w-[300px] flex-col border-l border-line bg-paper-alt">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {current ? (
              <DetailPanel
                node={current}
                accent={accent}
                onClose={() => setSelectedId(null)}
                onSetNote={(note) => void onSetNote(current, note)}
                onSetDate={(date) => void onSetDate(current, date)}
                onDelete={() => void onDelete(current)}
              />
            ) : (
              <OpenItems
                tasks={tasks}
                approvals={projApprovals}
                accent={accent}
                onSelect={(taskId) => setSelectedId(`task:${taskId}`)}
                onResolve={resolve}
              />
            )}
          </div>
          <AskBar
            agentName="Engineering"
            scopeLabel="Project agent"
            suggestion={`Where does ${project?.name ?? "this project"} stand?`}
            onAsk={(p) => void onAsk(p)}
            busy={busy}
          />
        </aside>
      </div>
    </Shell>
  );
}

function OpenItems({
  tasks,
  approvals,
  accent,
  onSelect,
  onResolve,
}: {
  tasks: Task[];
  approvals: ProposalRecord[];
  accent: string;
  onSelect: (taskId: string) => void;
  onResolve: (id: string, okay: boolean) => void;
}) {
  const open = tasks.filter((t) => t.status !== "done");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          Open items · {open.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {open.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] leading-relaxed text-hint">
            Nothing open — add an action item or reminder below the timeline.
          </p>
        ) : (
          open.map((t) => {
            const k = KINDS.find((x) => x.value === t.kind);
            return (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                className="flex w-full items-center gap-2.5 px-5 py-2 text-left hover:bg-rowhover"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: k?.color ?? accent }}
                  title={k?.label ?? t.kind}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-strong">{t.title}</span>
                {t.due_date && (
                  <span className="shrink-0 font-mono text-[10px] text-hint">{t.due_date}</span>
                )}
              </button>
            );
          })
        )}

        {approvals.length > 0 && (
          <div className="mt-2 border-t border-hairline pt-2">
            <div className="px-5 pb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint-alt">
              Pending approvals · {approvals.length}
            </div>
            {approvals.map((p) => (
              <div key={p.id} className="px-5 py-2">
                <div className="text-[12.5px] text-strong">{p.summary}</div>
                <div className="mt-1 flex gap-2">
                  <button
                    onClick={() => onResolve(p.id, false)}
                    className="rounded-lg border border-line-soft bg-white px-2.5 py-0.5 text-[11.5px] text-strong-alt hover:bg-rowhover"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => onResolve(p.id, true)}
                    className="rounded-lg bg-ink px-2.5 py-0.5 text-[11.5px] text-[#f4f6ee] hover:bg-ink-soft"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

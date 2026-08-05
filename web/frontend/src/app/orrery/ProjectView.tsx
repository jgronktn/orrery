import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import {
  ApiError,
  api,
  type Message,
  type Project,
  type ProposalRecord,
  type Task,
  type TimelineNode,
} from "../../api/client";
import { FileViewer, type PreviewFile } from "./FileViewer";
import { FunctionFiles } from "./FunctionFiles";
import { LinkControls } from "./ProjectLinks";
import { FunctionTimeline } from "./FunctionTimeline";
import { AskBar } from "./RightRail";
import { Shell } from "./Shell";
import { accentOf } from "./theme";
import { isActivity, nodeStorePath, todayISO } from "./timelineScale";
import {
  AddItemForm,
  CanvasAccordion,
  Composer,
  Conversation,
  DetailPanel,
  isActionable,
  KINDS,
} from "./timelineSurface";


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
  // Timeline shows curated activity (the Show-all toggle's banner was removed).
  const [showAll] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addKind, setAddKind] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addDetails, setAddDetails] = useState("");
  const [addDue, setAddDue] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  // Filesystem panel (left of the lower canvas) + open-file preview.
  const [folders, setFolders] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  // A just-dropped node: pan the timeline to its date so the drop is visible.
  const [revealTime, setRevealTime] = useState<number | null>(null);
  // Transient confirmation banner (e.g. after a drop). Auto-clears.
  const [notice, setNotice] = useState<string | null>(null);
  // A file currently uploading (its name) — a sticky banner while the POST is
  // in flight, since text extraction (esp. PDFs) can take several seconds.
  const [uploading, setUploading] = useState<string | null>(null);

  const accent = accentOf(project?.function ?? "");
  // The project's agent = its function's agent: a corporate project talks to
  // the Executive Assistant, everything else to engineering (the default).
  const agentId = project?.function === "corp" ? "corporate" : "engineering";
  const agentName = agentId === "corporate" ? "Executive Assistant" : "Engineering";

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
  useEffect(() => {
    // Load the persisted conversation (the canvas Conversation pane is always
    // present; this just fills its history) for the project's agent.
    if (!project) return;
    setMessages([]);
    api
      .getMessages(agentId, id)
      .then(setMessages)
      .catch(() => undefined);
  }, [id, agentId, project]);
  useEffect(() => loadTimeline(), [loadTimeline]);
  // Auto-dismiss the transient confirmation banner.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);
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
    setUploading(file.name);
    try {
      const node = await api.uploadDocument(id, file);
      refresh();
      // Reveal the drop so it never reads as a no-op: select it (opens the
      // detail panel + auto-expands & highlights the file in the tree via
      // activePath), pan the timeline to its date, and confirm.
      setSelectedId(node.id);
      setRevealTime(node.time);
      const folder = node.path?.split("/").slice(-2, -1)[0];
      setNotice(
        folder
          ? `Added “${node.name}” to ${folder}/.`
          : `Added “${node.name}”.`,
      );
    } catch (e) {
      fail(e);
    } finally {
      setUploading(null);
    }
  };
  const onAddTask = async (
    title: string,
    kind: string,
    due: string | null,
    description: string | null,
  ) => {
    try {
      await api.createTask(id, { title, kind, due_date: due, description });
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const clearAdd = () => {
    setAddKind(null);
    setAddTitle("");
    setAddDetails("");
    setAddDue("");
  };
  const submitAdd = async () => {
    const t = addTitle.trim();
    if (!t || !addKind) return;
    setAddBusy(true);
    await onAddTask(t, addKind, addDue || null, addDetails.trim() || null);
    setAddBusy(false);
    clearAdd();
  };
  const onDropKind = (kind: string, timeMs: number) => {
    setAddKind(kind);
    setAddTitle("");
    setAddDetails("");
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
  const setTaskStatus = async (taskId: string, status: "todo" | "done") => {
    try {
      await api.updateTask(id, taskId, { status });
      refresh(); // reloads tasks (Open Items) + timeline (checkmark)
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
  // Remove a spec shortcut (the source function file is untouched).
  const onUnlink = async (linkId: string) => {
    try {
      await api.unlinkProjectDoc(id, linkId);
      setReloadToken((n) => n + 1);
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
    setPreview(null); // surface the Conversation pane over any open file
    setPending(prompt);
    setBusy(true);
    try {
      const pair = await api.sendMessage(agentId, { query: prompt, project_id: id });
      setMessages((prev) => [...prev, ...pair]);
      // A turn may have produced proposals / tasks / files — refresh those too.
      loadApprovals();
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setPending(null);
      setBusy(false);
    }
  };
  const onDeleteTurn = async (ids: string[]) => {
    try {
      for (const mid of ids) await api.deleteMessage(agentId, mid);
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
    } catch (e) {
      fail(e);
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
      toolbar={
        <Composer
          compact
          kind={addKind}
          disabled={!project}
          onChoose={(k) => {
            setAddTitle("");
            setAddDetails("");
            setAddDue(todayISO());
            setAddKind((cur) => (cur === k ? null : k));
          }}
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {err && (
          <div className="border-b border-line bg-[#f1e7e3] px-6 py-2 text-[12px] text-[#8a4a3c]">
            {err}
          </div>
        )}
        {uploading && (
          <div className="flex items-center gap-2 border-b border-line bg-[#e8edf1] px-6 py-2 text-[12px] text-[#3c5670]">
            <span className="h-2 w-2 animate-orrery-pulse rounded-full bg-[#50708a]" />
            Uploading “{uploading}”…
          </div>
        )}
        {notice && !uploading && (
          <div className="border-b border-line bg-[#e8edf1] px-6 py-2 text-[12px] text-[#3c5670]">
            {notice}
          </div>
        )}

        {/* timeline band across the top, full width (like the main page) */}
        <div className="shrink-0">
          <div className="border-b border-line" style={{ height: 280 }}>
            <FunctionTimeline
              nodes={shown}
              accent={accent}
              selectedId={current?.id ?? null}
              focusTime={focusNode?.time ?? revealTime}
              onSelect={(n) => {
                setSelectedId(n ? n.id : null);
                // Selecting on the timeline drives the tree highlight; clear a
                // stale open-file preview so it doesn't keep winning activePath.
                if (n) setPreview(null);
              }}
              onDropFile={(f) => void onDropFile(f)}
              onDropKind={onDropKind}
            />
          </div>
        </div>

        {/* content row below the timeline: file system + canvas + right sidebar */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1">
            <div className="flex w-[35%] min-w-0 flex-col border-r border-line">
              {project && (
                <>
                  <div className="flex min-h-0 flex-1">
                    <FunctionFiles
                      variant="fill"
                      containerKey={id}
                      title={`${project.name} files`}
                      accent={accent}
                      rootPrefix={`projects/${project.slug}`}
                      loadTree={() => api.projectTree(id)}
                      upload={async (file, dir) => {
                        setUploading(file.name);
                        try {
                          return await api.uploadDocument(id, file, dir);
                        } catch (e) {
                          fail(e); // surface upload errors (e.g. "file too large")
                          throw e;
                        } finally {
                          setUploading(null);
                        }
                      }}
                      folders={folders}
                      reloadToken={reloadToken}
                      onOpenFile={setPreview}
                      // Highlight in the tree: the previewed file, or — when a
                      // file/email timeline item is selected — that item's file.
                      activePath={preview?.path ?? nodeStorePath(current)}
                      onUploaded={refresh}
                      onRename={onFileRename}
                      onMove={onFileMove}
                      onDelete={onFileDelete}
                      onAddFolder={onAddFolder}
                      onDeleteFolder={onDeleteFolder}
                      onUnlink={onUnlink}
                    />
                  </div>
                  <LinkControls
                    projectId={id}
                    slug={project.slug}
                    func={project.function ?? "engr"}
                    projectFolders={folders}
                    onChanged={() => setReloadToken((n) => n + 1)}
                  />
                </>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {preview ? (
                <FileViewer
                  file={preview}
                  folders={folders}
                  onClose={() => setPreview(null)}
                  onRename={onFileRename}
                  onMove={onFileMove}
                  onDelete={onFileDelete}
                />
              ) : (
                <CanvasAccordion
                  openId="conversation"
                  onOpen={() => {}}
                  sections={[
                    {
                      id: "conversation",
                      title: "Conversation",
                      count: messages.filter((m) => m.role === "user").length,
                      body: (
                        <Conversation
                          embedded
                          accent={accent}
                          agentName={agentName}
                          messages={messages}
                          pending={pending}
                          busy={busy}
                          onDeleteTurn={(ids) => void onDeleteTurn(ids)}
                        />
                      ),
                    },
                  ]}
                />
              )}
            </div>
          </div>
          {/* right sidebar — starts below the timeline: open items (or selected
              detail) over the agent ask */}
          <aside className="flex w-[25%] min-w-[300px] flex-col border-l border-line bg-[#f1f1ef]">
          {addKind && (
            <AddItemForm
              kind={addKind}
              title={addTitle}
              details={addDetails}
              due={addDue}
              busy={addBusy}
              onTitle={setAddTitle}
              onDetails={setAddDetails}
              onDue={setAddDue}
              onSave={() => void submitAdd()}
              onCancel={clearAdd}
            />
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {current ? (
              <DetailPanel
                node={current}
                accent={accent}
                onClose={() => setSelectedId(null)}
                onSetNote={(note) => void onSetNote(current, note)}
                onSetDate={(date) => void onSetDate(current, date)}
                onSetStatus={(status) => void setTaskStatus(current.id.slice(5), status)}
                onDelete={() => void onDelete(current)}
              />
            ) : (
              <OpenItems
                tasks={tasks}
                approvals={projApprovals}
                accent={accent}
                onSelect={(taskId) => setSelectedId(`task:${taskId}`)}
                onComplete={(taskId) => void setTaskStatus(taskId, "done")}
                onResolve={resolve}
              />
            )}
          </div>
          <AskBar
            agentName={agentName}
            scopeLabel="Project agent"
            suggestion={`Where does ${project?.name ?? "this project"} stand?`}
            onAsk={(p) => void onAsk(p)}
            busy={busy}
          />
          </aside>
        </div>
      </div>
    </Shell>
  );
}

function OpenItems({
  tasks,
  approvals,
  accent,
  onSelect,
  onComplete,
  onResolve,
}: {
  tasks: Task[];
  approvals: ProposalRecord[];
  accent: string;
  onSelect: (taskId: string) => void;
  onComplete: (taskId: string) => void;
  onResolve: (id: string, okay: boolean) => void;
}) {
  // Only actionable items (action item / milestone / reminder) that aren't done.
  // Notes and Decisions are ongoing records and never appear here.
  const open = tasks.filter((t) => isActionable(t.kind) && t.status !== "done");
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
            const color = k?.color ?? accent;
            return (
              <div
                key={t.id}
                className="group flex w-full items-center gap-2.5 px-5 py-2 hover:bg-rowhover"
              >
                <button
                  onClick={() => onComplete(t.id)}
                  title="Mark done"
                  aria-label={`Mark "${t.title}" done`}
                  className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border"
                  style={{ borderColor: color }}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 12 12"
                    aria-hidden
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color }}
                  >
                    <path
                      d="M2.5 6.5l2.5 2.5 4.5-5.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => onSelect(t.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-strong">{t.title}</span>
                  {t.due_date && (
                    <span className="shrink-0 font-mono text-[10px] text-hint">{t.due_date}</span>
                  )}
                </button>
              </div>
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
                    className="rounded-lg bg-ink px-2.5 py-0.5 text-[11.5px] text-[#f6f4ef] hover:bg-ink-soft"
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

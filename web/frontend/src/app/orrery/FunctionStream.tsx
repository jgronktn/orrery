import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  api,
  type FunctionInfo,
  type Project,
  type ProposalRecord,
  type TimelineNode,
} from "../../api/client";
import { FileViewer, type PreviewFile } from "./FileViewer";
import { FunctionFiles } from "./FunctionFiles";
import { FunctionTimeline } from "./FunctionTimeline";
import { ApprovalsPanel, AskBar } from "./RightRail";
import { Shell } from "./Shell";
import { accentOf } from "./theme";
import { isActivity } from "./timelineScale";
import { AskAnswer, Composer, DetailPanel } from "./timelineSurface";

// The function page: a ~250px activity timeline + composer in the main area,
// and a 25% right sidebar with pending approvals over the agent ask.
export default function FunctionStream() {
  const { key = "" } = useParams();
  const accent = accentOf(key);

  const [fn, setFn] = useState<FunctionInfo | null>(null);
  const [nodes, setNodes] = useState<TimelineNode[]>([]);
  const [approvals, setApprovals] = useState<ProposalRecord[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [ask, setAsk] = useState<{ prompt: string; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Composer: which kind icon is armed + the title/date being entered.
  const [addKind, setAddKind] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addDue, setAddDue] = useState("");
  // Filesystem panel (below the timeline) + open-file preview.
  const [folders, setFolders] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  const loadTimeline = useCallback(() => {
    api.functionTimeline(key).then(setNodes).catch(() => undefined);
  }, [key]);
  const loadApprovals = useCallback(() => {
    api.listApprovals().then(setApprovals).catch(() => undefined);
  }, []);
  // Refresh timeline + bump the file tree / folder list after a mutation.
  const refreshFiles = () => {
    loadTimeline();
    setReloadToken((n) => n + 1);
  };

  useEffect(() => {
    api.getFunction(key).then(setFn).catch((e) => setErr(String(e)));
  }, [key]);
  useEffect(() => loadTimeline(), [loadTimeline]);
  useEffect(() => loadApprovals(), [loadApprovals]);
  useEffect(() => {
    let live = true;
    api
      .functionFolders(key)
      .then((f) => live && setFolders(f))
      .catch(() => live && setFolders([]));
    return () => {
      live = false;
    };
  }, [key, reloadToken]);

  const streamId = fn?.stream_id;
  // The opened file's timeline node (so we can zoom to it, even if curated out).
  const focusNode = preview ? nodes.find((n) => n.path === preview.path) ?? null : null;
  const shown = (() => {
    const base = showAll ? nodes : nodes.filter(isActivity);
    return focusNode && !base.some((n) => n.id === focusNode.id)
      ? [...base, focusNode]
      : base;
  })();
  const current = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null;
  const fnApprovals = fn
    ? approvals.filter(
        (p) =>
          (p.project_id && p.project_id === fn.stream_id) ||
          (fn.agent && p.agent_id === fn.agent),
      )
    : [];

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : String(e));

  const onDropFile = async (file: File) => {
    try {
      await api.uploadFunctionDoc(key, file);
      refreshFiles();
    } catch (e) {
      fail(e);
    }
  };
  const onAddTask = async (title: string, kind: string, due: string | null) => {
    if (!streamId) return;
    try {
      await api.createTask(streamId, { title, kind, due_date: due });
      loadTimeline();
    } catch (e) {
      fail(e);
    }
  };
  const submitAdd = () => {
    const t = addTitle.trim();
    if (!t || !addKind || !streamId) return;
    void onAddTask(t, addKind, addDue || null);
    setAddKind(null);
    setAddTitle("");
    setAddDue("");
  };
  // A kind icon dropped onto the timeline → arm that kind, dated at the drop
  // position (UTC day), and focus the title field to name it.
  const onDropKind = (kind: string, timeMs: number) => {
    if (!streamId) return;
    setAddKind(kind);
    setAddTitle("");
    setAddDue(new Date(timeMs).toISOString().slice(0, 10));
  };
  const onSetNote = async (node: TimelineNode, note: string | null) => {
    if (!streamId) return;
    try {
      await api.setTimelineNote(streamId, node.id, note);
      loadTimeline();
    } catch (e) {
      fail(e);
    }
  };
  const onSetDate = async (node: TimelineNode, date: string) => {
    if (!streamId) return;
    try {
      await api.setTimelineDate(streamId, node.id, date);
      loadTimeline();
    } catch (e) {
      fail(e);
    }
  };
  const onDelete = async (node: TimelineNode) => {
    try {
      if (node.id.startsWith("doc:")) await api.deleteFunctionDoc(key, node.id.slice(4));
      else if (node.id.startsWith("task:") && streamId)
        await api.deleteTask(streamId, node.id.slice(5));
      else return;
      setSelectedId(null);
      refreshFiles();
    } catch (e) {
      fail(e);
    }
  };

  // Filesystem panel ops (same handlers Company Home gives FunctionFiles).
  const afterFileOp = (path: string, res: { status: string }) => {
    if (res.status === "queued") setErr("Change queued for approval.");
    refreshFiles();
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
      setFolders(await api.createFolder(key, parent, folderName));
      setReloadToken((n) => n + 1);
    } catch (e) {
      fail(e);
    }
  };
  const onDeleteFolder = async (path: string) => {
    try {
      const res = await api.deleteFolder(key, path);
      if (res.status === "queued") setErr("Folder delete queued for approval.");
      refreshFiles();
      const full = fn ? `${fn.folder}/${path}` : path;
      setPreview((p) =>
        p && (p.path === full || p.path.startsWith(full + "/")) ? null : p,
      );
    } catch (e) {
      fail(e);
    }
  };
  const resolve = async (id: string, okay: boolean) => {
    try {
      if (okay) await api.approveProposal(id);
      else await api.rejectProposal(id);
      loadApprovals();
      loadTimeline();
    } catch (e) {
      fail(e);
    }
  };
  const onAsk = async (prompt: string) => {
    if (!fn?.agent) return;
    setBusy(true);
    setAsk({ prompt, answer: "" });
    try {
      const msgs = await api.sendMessage(fn.agent, { query: prompt, project_id: fn.stream_id });
      const last = [...msgs].reverse().find((m) => m.role === "assistant");
      setAsk({ prompt, answer: last?.content ?? "(no response)" });
    } catch (e) {
      setAsk({ prompt, answer: `⚠ ${e instanceof ApiError ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      company="PPI"
      crumbs={[
        { label: "Map", to: "/", back: true },
        { label: fn?.name ?? key, dot: accent },
        { label: "FUNCTION", mono: true },
      ]}
      status={`${(fn?.name ?? key).toUpperCase()} ACTIVITY`}
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
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
              <span className="text-[22px] font-semibold text-ink">{fn?.name ?? key}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                Activity timeline · {shown.length}
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
            disabled={!streamId}
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

          {/* lower area below the timeline: left half = the function's file
              folder system; right = open file preview / agent answer */}
          <div className="flex min-h-0 flex-1">
            <div className="flex w-1/2 min-w-0 border-r border-line">
              <FunctionFiles
                variant="fill"
                containerKey={key}
                title={`${fn?.name ?? key} files`}
                accent={accent}
                rootPrefix={fn?.folder ?? key}
                loadTree={() => api.functionTree(key)}
                upload={(file, dir) => api.uploadFunctionDoc(key, file, dir)}
                folders={folders}
                reloadToken={reloadToken}
                onOpenFile={setPreview}
                activePath={preview?.path ?? null}
                onUploaded={refreshFiles}
                onRename={onFileRename}
                onMove={onFileMove}
                onDelete={onFileDelete}
                onAddFolder={onAddFolder}
                onDeleteFolder={onDeleteFolder}
              />
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
                <ProjectsList funcKey={key} accent={accent} />
              )}
            </div>
          </div>
        </div>

        {/* right sidebar — selected item's detail (else pending approvals),
            over the agent ask */}
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
              <ApprovalsPanel
                approvals={fnApprovals}
                funcOf={() => key}
                showFunc={false}
                scopeLabel={fn?.name ?? key}
                onApprove={(id) => void resolve(id, true)}
                onReject={(id) => void resolve(id, false)}
              />
            )}
          </div>
          {fn?.agent ? (
            <AskBar
              agentName={fn.name}
              scopeLabel={`${fn.name} agent`}
              suggestion={`What's moving in ${fn.name} right now?`}
              onAsk={(p) => void onAsk(p)}
              busy={busy}
            />
          ) : (
            <div className="border-t border-line bg-paper px-4 py-4 text-[12px] text-hint">
              No agent assigned to {fn?.name ?? key} yet.
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}

function ProjectsList({ funcKey, accent }: { funcKey: string; accent: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const load = useCallback(() => {
    api
      .listProjects()
      .then((ps) =>
        setProjects(
          ps.filter((p) => p.kind === "project" && p.function === funcKey),
        ),
      )
      .catch(() => undefined);
  }, [funcKey]);
  useEffect(() => load(), [load]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const p = await api.createProject({ name: n, function: funcKey });
      setName("");
      load();
      navigate(`/project/${p.id}`);
    } catch {
      /* surfaced elsewhere */
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          Projects · {projects.length}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-hint">
          Bounded work
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {projects.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] leading-relaxed text-hint">
            No projects yet — start one below.
          </p>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/project/${p.id}`)}
              className="group flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-rowhover"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: accent }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-strong">
                  {p.name}
                </span>
                {p.description && (
                  <span className="block truncate text-[11.5px] text-hint">
                    {p.description}
                  </span>
                )}
              </span>
              <span className="font-mono text-[14px] text-line-soft group-hover:text-hint">
                ›
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="New project…"
          className="min-w-0 flex-1 rounded-lg border border-line-soft bg-white px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-hint"
        />
        <button
          onClick={() => void create()}
          disabled={!name.trim()}
          className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
          style={{ background: accent }}
        >
          Add
        </button>
      </div>
    </div>
  );
}


import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  ApiError,
  api,
  type FileOpResult,
  type FunctionInfo,
  type Home,
  type ProposalRecord,
  type TimelineNode,
} from "../../api/client";
import { FileViewer, type PreviewFile } from "./FileViewer";
import { FunctionFiles } from "./FunctionFiles";
import { OrreryMap, type Selection } from "./OrreryMap";
import { AskBar, ApprovalsPanel, TimelinePanel } from "./RightRail";
import { Shell } from "./Shell";
import { accentOf } from "./theme";
import { isActivity } from "./timelineScale";

const ENGINEERING_AGENT = "engineering";

// Attached integrations docked under the map. The backend has no integration
// layer this phase, so these are a static, dimmed affordance (not wired).
const ATTACHED = [
  { abbr: "bw", name: "bitwarden" },
  { abbr: "gh", name: "github" },
  { abbr: "go", name: "google" },
];

export default function CompanyHome() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>("company");
  const [ask, setAsk] = useState<{ prompt: string; answer: string } | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [fnTimeline, setFnTimeline] = useState<TimelineNode[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  // Changing the selected function (or returning to the company) clears any
  // open file preview / notice — they belong to the previously-browsed folder.
  useEffect(() => {
    setPreview(null);
    setNotice(null);
  }, [selected]);

  const load = useCallback(async () => {
    try {
      setHome(await api.home());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fns = home?.functions ?? [];
  const company = "PPI";

  // approval → function label maps (proposals carry agent_id/project_id)
  const funcOf = useMemo(() => {
    const byStream = new Map(fns.map((f) => [f.stream_id, f.key]));
    const byAgent = new Map(
      fns.filter((f) => f.agent).map((f) => [f.agent as string, f.key]),
    );
    return (p: ProposalRecord) =>
      (p.project_id && byStream.get(p.project_id)) ||
      byAgent.get(p.agent_id) ||
      p.agent_id;
  }, [fns]);

  const selFn: FunctionInfo | undefined =
    selected !== "company" ? fns.find((f) => f.key === selected) : undefined;

  // Move destinations + new-folder vocabulary: the selected function's actual
  // (free-form, nested) folders. Re-fetched on a reloadToken bump so folders
  // created/deleted below show up immediately.
  const fnKey = selFn?.key;
  useEffect(() => {
    if (!fnKey) {
      setFolders([]);
      return;
    }
    let live = true;
    api
      .functionFolders(fnKey)
      .then((f) => live && setFolders(f))
      .catch(() => live && setFolders([]));
    return () => {
      live = false;
    };
  }, [fnKey, reloadToken]);

  // Rail timeline: scope to the selected function's activity (curated), or the
  // company overview when nothing is selected.
  useEffect(() => {
    if (!fnKey) {
      setFnTimeline([]);
      return;
    }
    let live = true;
    api
      .functionTimeline(fnKey)
      .then((t) => live && setFnTimeline(t))
      .catch(() => live && setFnTimeline([]));
    return () => {
      live = false;
    };
  }, [fnKey, reloadToken]);

  // Governed file mutations (move/delete/rename). Low-risk ops execute and we
  // refresh the tree + home; sensitive paths queue (surface in approvals). If
  // the touched file is open in the viewer, close it (its path is now stale).
  const afterOp = (path: string, res: FileOpResult) => {
    if (res.status === "queued") {
      setNotice("Change queued for approval.");
    } else {
      setReloadToken((n) => n + 1);
    }
    void load();
    setPreview((p) => (p?.path === path ? null : p));
  };

  const onRename = async (path: string, newName: string) => {
    try {
      afterOp(path, await api.renameFile(path, newName));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };
  const onMove = async (path: string, targetDir: string) => {
    try {
      afterOp(path, await api.moveFile(path, targetDir));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };
  const onDelete = async (path: string) => {
    try {
      afterOp(path, await api.deleteFile(path));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  // Folder ops (paths are function-relative). Create is always low-risk;
  // delete is recursive + risk-routed (sensitive paths queue).
  const onAddFolder = async (parent: string, name: string) => {
    if (!fnKey) return;
    try {
      setFolders(await api.createFolder(fnKey, parent, name));
      setReloadToken((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };
  const onDeleteFolder = async (path: string) => {
    if (!fnKey || !selFn) return;
    try {
      const res = await api.deleteFolder(fnKey, path);
      if (res.status === "queued") setNotice("Folder delete queued for approval.");
      else setReloadToken((n) => n + 1);
      void load();
      const full = `${selFn.folder}/${path}`;
      setPreview((p) =>
        p && (p.path === full || p.path.startsWith(full + "/")) ? null : p,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const approvals = useMemo(() => {
    const all = home?.approvals ?? [];
    if (selected === "company") return all;
    return all.filter((p) => funcOf(p) === selected);
  }, [home, selected, funcOf]);

  const resolve = async (id: string, ok: boolean) => {
    try {
      if (ok) await api.approveProposal(id);
      else await api.rejectProposal(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  // Ask config: company → global (engineering, the EA placeholder); a function
  // routes to its agent (only engineering is live). Agentless functions show
  // a disabled bar honestly reflecting `agent: null`.
  const askAgent = selFn ? selFn.agent : ENGINEERING_AGENT;
  const askName = selFn
    ? selFn.name
    : `${company} · Company agent`;
  const askScope = selFn ? `${selFn.name} agent` : "Company";
  const suggestion = selFn
    ? `What's moving in ${selFn.name} right now?`
    : `What needs my attention across ${company} today?`;

  const onAsk = async (prompt: string) => {
    if (!askAgent) return;
    setBusy(true);
    setAsk({ prompt, answer: "" });
    try {
      const msgs = await api.sendMessage(askAgent, {
        query: prompt,
        project_id: selFn ? selFn.stream_id : null,
      });
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
      company={company}
      crumbs={[{ label: "Company map" }]}
      status="LIVE · ALL FUNCTIONS IN MOTION"
    >
      {error && (
        <div className="border-b border-line bg-[#fbecea] px-6 py-2 text-[12px] text-[#8a3b2e]">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center justify-between border-b border-line bg-paper-alt px-6 py-2 text-[12px] text-strong">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="font-mono text-[11px] text-hint hover:text-strong"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex h-full min-h-0">
        {/* far left — selected function's filesystem (only when one is picked) */}
        {selFn && (
          <FunctionFiles
            containerKey={selFn.key}
            title={`${selFn.name} files`}
            accent={accentOf(selFn.key)}
            rootPrefix={selFn.folder}
            loadTree={() => api.functionTree(selFn.key)}
            upload={(file, dir) => api.uploadFunctionDoc(selFn.key, file, dir)}
            folders={folders}
            reloadToken={reloadToken}
            onOpenFile={setPreview}
            activePath={preview?.path ?? null}
            onUploaded={() => void load()}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
            onAddFolder={onAddFolder}
            onDeleteFolder={onDeleteFolder}
          />
        )}

        {/* A clicked file takes over the whole area right of the filesystem
            panel — center canvas AND the right rail. */}
        {preview ? (
          <FileViewer
            file={preview}
            folders={folders}
            onClose={() => setPreview(null)}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        ) : (
          <>
            {/* center — orrery stage; tools float near the bottom */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              {ask ? (
                <AskCanvas
                  accent={selFn ? accentOf(selFn.key) : "#353a32"}
                  prompt={ask.prompt}
                  answer={ask.answer}
                  busy={busy}
                  onClose={() => setAsk(null)}
                />
              ) : (
                <>
                  <OrreryMap
                    functions={fns}
                    selected={selected}
                    onSelect={setSelected}
                    onOpen={(key) => navigate(`/fn/${key}`)}
                    onDropFile={async (key, file) => {
                      try {
                        await api.uploadFunctionDoc(key, file);
                        await load();
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : String(e));
                      }
                    }}
                  />
                  <AttachedTools />
                </>
              )}
            </div>

            {/* right — timeline · approvals · ask */}
            <aside className="flex w-[calc(35%-25px)] min-w-[330px] flex-col border-l border-line bg-paper-alt">
              <div className="flex-1 overflow-y-auto">
                <TimelinePanel
              events={
                selFn ? fnTimeline.filter(isActivity) : home?.timeline ?? []
              }
              scope={selFn?.name}
              accent={selFn ? accentOf(selFn.key) : "#353a32"}
              onDropFile={
                selFn
                  ? async (file) => {
                      try {
                        await api.uploadFunctionDoc(selFn.key, file);
                        setReloadToken((n) => n + 1);
                        void load();
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : String(e));
                      }
                    }
                  : undefined
              }
            />
                <ApprovalsPanel
                  approvals={approvals}
                  funcOf={funcOf}
                  showFunc={selected === "company"}
                  scopeLabel={selFn ? selFn.name : "any function"}
                  onApprove={(id) => void resolve(id, true)}
                  onReject={(id) => void resolve(id, false)}
                />
              </div>
              {askAgent ? (
                <AskBar
                  agentName={askName}
                  scopeLabel={askScope}
                  suggestion={suggestion}
                  onAsk={(p) => void onAsk(p)}
                  busy={busy}
                />
              ) : (
                <div className="border-t border-line bg-paper px-4 py-4 text-[12px] text-hint">
                  No agent assigned to {selFn?.name} yet.
                </div>
              )}
            </aside>
          </>
        )}
      </div>
    </Shell>
  );
}

function AttachedTools() {
  return (
    <div className="pointer-events-none absolute bottom-[70px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2.5 opacity-60">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-hint">
        Attached tools
      </span>
      <div className="flex items-center gap-20">
        {ATTACHED.map((t) => (
          <div key={t.abbr} className="flex flex-col items-center gap-1.5">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-line-soft bg-white font-mono text-[14px] text-hint">
              {t.abbr}
            </span>
            <span className="font-mono text-[12px] text-hint-alt">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AskCanvas({
  accent,
  prompt,
  answer,
  busy,
  onClose,
}: {
  accent: string;
  prompt: string;
  answer: string;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col bg-paper-alt">
      <div className="flex items-start justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-hint">
            You asked
          </div>
          <div className="mt-1 text-[16px] font-semibold text-ink">{prompt}</div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg border border-line-soft bg-white px-3 py-1 text-[12px] text-strong-alt hover:bg-rowhover"
        >
          ‹ Back to map
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {busy && !answer ? (
          <div className="flex items-center gap-2 text-[13px] text-hint">
            <span
              className="h-2 w-2 animate-orrery-pulse rounded-full"
              style={{ background: accent }}
            />
            Thinking…
          </div>
        ) : (
          <div className="prose-orrery max-w-[680px] text-[14px] leading-relaxed text-strong">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

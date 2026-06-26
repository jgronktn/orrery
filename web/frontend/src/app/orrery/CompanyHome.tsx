import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  api,
  type FileOpResult,
  type FunctionInfo,
  type Home,
  type Message,
  type ProposalRecord,
  type TimelineNode,
} from "../../api/client";
import { FileViewer, type PreviewFile } from "./FileViewer";
import { FunctionFiles } from "./FunctionFiles";
import { LoginVault } from "./LoginVault";
import { FunctionTimeline } from "./FunctionTimeline";
import { OrreryMap, type Selection } from "./OrreryMap";
import { AskBar, RailAccordion } from "./RightRail";
import { Shell } from "./Shell";
import { accentOf } from "./theme";
import { isActivity } from "./timelineScale";
import { Conversation } from "./timelineSurface";

// The company core (no function selected) routes to the executive assistant —
// the cross-function agent. A selected function routes to its own agent.
const COMPANY_AGENT = "corporate";

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [fnTimeline, setFnTimeline] = useState<TimelineNode[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  // Faint connector lines from the PPI core to each attached-tool body. The
  // tools live in a sibling element (different coordinate space from the
  // scaled orrery stage), so measure both from the DOM relative to the canvas.
  const centerRef = useRef<HTMLDivElement>(null);
  const [toolLines, setToolLines] = useState<
    { x1: number; y1: number; x2: number; y2: number }[]
  >([]);
  useLayoutEffect(() => {
    const el = centerRef.current;
    if (!el) {
      setToolLines([]);
      return;
    }
    const measure = () => {
      const core = el.querySelector("[data-orrery-core]");
      const tools = el.querySelectorAll("[data-orrery-tool]");
      if (!core || tools.length === 0) {
        setToolLines([]);
        return;
      }
      const base = el.getBoundingClientRect();
      const c = core.getBoundingClientRect();
      const cx = c.left + c.width / 2 - base.left;
      const cy = c.top + c.height / 2 - base.top;
      setToolLines(
        Array.from(tools).map((t) => {
          const r = t.getBoundingClientRect();
          return {
            x1: cx,
            y1: cy,
            x2: r.left + r.width / 2 - base.left,
            y2: r.top + r.height / 2 - base.top,
          };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, chatOpen, preview, vaultOpen]);

  // Changing the selected function (or returning to the company) clears any
  // open file preview / notice / vault — they belong to the prior selection.
  useEffect(() => {
    setPreview(null);
    setNotice(null);
    setVaultOpen(false);
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

  // Ask config: company core → the executive assistant (cross-function); a
  // function routes to its own agent. Agentless functions show a disabled bar
  // honestly reflecting `agent: null`.
  const askAgent = selFn ? selFn.agent : COMPANY_AGENT;
  const askName = selFn
    ? selFn.name
    : `${company} · Executive Assistant`;
  const askScope = selFn ? `${selFn.name} agent` : "Company";
  const suggestion = selFn
    ? `What's moving in ${selFn.name} right now?`
    : `What needs my attention across ${company} today?`;

  // Load the conversation for the current ask context (company → global; a
  // function → its stream). Unlike the project/function pages, the map is the
  // centerpiece here, so we DON'T auto-open the transcript — it opens on ask.
  const askProjectId = selFn ? selFn.stream_id : null;
  useEffect(() => {
    setChatOpen(false);
    setMessages([]);
    setPending(null);
    if (!askAgent) return;
    let live = true;
    api
      .getMessages(askAgent, askProjectId)
      .then((ms) => live && setMessages(ms))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [askAgent, askProjectId]);

  const onAsk = async (prompt: string) => {
    if (!askAgent) return;
    setChatOpen(true);
    setPending(prompt);
    setBusy(true);
    try {
      const pair = await api.sendMessage(askAgent, {
        query: prompt,
        project_id: askProjectId,
      });
      setMessages((prev) => [...prev, ...pair]);
      void load(); // proposals/activity may have changed
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };
  const onDeleteTurn = async (ids: string[]) => {
    if (!askAgent) return;
    try {
      for (const mid of ids) await api.deleteMessage(askAgent, mid);
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  // The company timeline — moved to a horizontal strip across the top of the
  // center column (was the rail's compact TimelinePanel). Same data + drop
  // behavior as before; company-level accent is steel.
  const timelineEvents = selFn
    ? fnTimeline.filter(isActivity)
    : // Company overview (no function selected): only reminders + milestones.
      (home?.timeline ?? []).filter(
        (n) => n.type === "reminder" || n.type === "milestone",
      );
  const onDropTimeline = selFn
    ? async (file: File) => {
        try {
          await api.uploadFunctionDoc(selFn.key, file);
          setReloadToken((n) => n + 1);
          void load();
        } catch (e) {
          setError(e instanceof ApiError ? e.message : String(e));
        }
      }
    : undefined;
  const topTimeline = (
    <div className="shrink-0 border-b border-line" style={{ height: 220 }}>
      <FunctionTimeline
        nodes={timelineEvents}
        accent={selFn ? accentOf(selFn.key) : "#50708a"}
        onDropFile={onDropTimeline}
      />
    </div>
  );

  // The right rail (approvals · reminders · ask) — present in the normal and
  // vault views, but covered by the full-bleed file preview.
  const rail = (
    <aside className="flex w-[520px] shrink-0 flex-col border-l border-line bg-[#f1f1ef]">
      <div className="flex-1 overflow-y-auto">
        <RailAccordion
          approvals={approvals}
          funcOf={funcOf}
          showFunc={selected === "company"}
          scopeLabel={selFn ? selFn.name : "any function"}
          onApprove={(id) => void resolve(id, true)}
          onReject={(id) => void resolve(id, false)}
          reminderSource={selFn ? fnTimeline : home?.timeline ?? []}
        />
      </div>
      {askAgent ? (
        <AskBar
          agentName={askName}
          scopeLabel={askScope}
          suggestion={suggestion}
          onAsk={(p) => void onAsk(p)}
          busy={busy}
          onReopen={
            !chatOpen && messages.length && !preview
              ? () => setChatOpen(true)
              : undefined
          }
          reopenCount={messages.filter((m) => m.role === "user").length}
        />
      ) : (
        <div className="border-t border-line bg-paper px-4 py-4 text-[12px] text-hint">
          No agent assigned to {selFn?.name} yet.
        </div>
      )}
    </aside>
  );

  // Far-left filesystem panel (only when a function is selected).
  const filePanel = selFn ? (
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
  ) : null;

  return (
    <Shell
      company={company}
      crumbs={[{ label: "Company map" }]}
      status={selFn?.name}
    >
      {error && (
        <div className="border-b border-line bg-[#f1e7e3] px-6 py-2 text-[12px] text-[#8a4a3c]">
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
        {preview ? (
          // A clicked file takes over the center canvas AND the right rail.
          <>
            {filePanel}
            <FileViewer
              file={preview}
              folders={folders}
              onClose={() => setPreview(null)}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          </>
        ) : vaultOpen ? (
          // The vault fills the canvas area; the right rail stays.
          <>
            <LoginVault accent={accentOf("it")} onClose={() => setVaultOpen(false)} />
            {rail}
          </>
        ) : (
          // Normal view: timeline spans the full width across the top; the
          // file panel · map · rail sit in a row beneath it.
          <div className="flex min-w-0 flex-1 flex-col">
            {topTimeline}
            <div className="flex min-h-0 flex-1">
              {filePanel}
              {/* center — orrery stage; tools float near the bottom */}
              <div ref={centerRef} className="relative flex min-w-0 flex-1 flex-col bg-[#FAFAFA]">
                {chatOpen ? (
                  <Conversation
                    accent={selFn ? accentOf(selFn.key) : "#2b2a26"}
                    agentName={selFn ? selFn.name : company}
                    messages={messages}
                    pending={pending}
                    busy={busy}
                    onClose={() => setChatOpen(false)}
                    onDeleteTurn={(ids) => void onDeleteTurn(ids)}
                  />
                ) : (
                  <>
                    <OrreryMap
                      functions={fns}
                      selected={selected}
                      onSelect={setSelected}
                      onOpen={(key) => navigate(`/fn/${key}`)}
                      onOpenVault={() => setVaultOpen(true)}
                      toolLines={toolLines}
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
              {rail}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function AttachedTools() {
  return (
    <div className="pointer-events-none absolute bottom-[70px] left-1/2 z-[2] flex -translate-x-1/2 flex-col items-center gap-2.5 opacity-60">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-hint">
        Attached tools
      </span>
      <div className="flex items-center gap-20">
        {ATTACHED.map((t) => (
          <div key={t.abbr} className="flex flex-col items-center gap-1.5">
            <span
              data-orrery-tool
              className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-line-soft bg-white font-mono text-[14px] text-hint shadow-[0_2px_8px_-2px_rgba(20,18,12,0.25)]"
            >
              {t.abbr}
            </span>
            <span className="font-mono text-[12px] text-hint-alt">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


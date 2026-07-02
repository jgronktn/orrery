import { useEffect, useState } from "react";

import {
  ApiError,
  api,
  type ContainerFile,
  type FunctionInfo,
  type LinkFolder,
} from "../../api/client";

// Link a function-corpus file into a project (no copy). Two ways:
//   • "Link File"   — pick an Engineering file → shortcut in a project folder.
//   • "Link Folder" — designate a project folder as a portal; drops route to a
//                     function folder, leaving a shortcut behind.
// Rendered as a footer below the project file tree. `onChanged` refreshes the
// tree after any link/portal change.
export function LinkControls({
  projectId,
  slug,
  projectFolders,
  onChanged,
}: {
  projectId: string;
  slug: string;
  projectFolders: string[];
  onChanged: () => void;
}) {
  const [fns, setFns] = useState<FunctionInfo[]>([]);
  const [panel, setPanel] = useState<null | "spec" | "folder">(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listFunctions().then(setFns).catch(() => undefined);
  }, []);

  const root = `projects/${slug}`;
  const fullProj = (rel: string) => (rel ? `${root}/${rel}` : root);
  const fail = (e: unknown) =>
    setErr(e instanceof ApiError ? e.message : "Something went wrong");

  // Steel circle-icon buttons, matching the New-folder / timeline controls.
  const linkBtn =
    "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap font-mono text-[10px] uppercase text-[#50708a] hover:opacity-75";
  const circle =
    "grid h-6 w-6 place-items-center rounded-full border-2 border-[#50708a] bg-transparent";

  return (
    <div className="border-t border-line bg-paper-alt px-3 py-2">
      <div className="flex items-center gap-4">
        <button
          className={linkBtn}
          onClick={() => {
            setErr(null);
            setPanel((p) => (p === "spec" ? null : "spec"));
          }}
        >
          <span className={circle}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="#50708a"
              strokeWidth={2.3}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4.7 11.3L11.3 4.7" />
              <path d="M4.7 4.7H11.3V11.3" />
            </svg>
          </span>
          Link File
        </button>
        <button
          className={linkBtn}
          onClick={() => {
            setErr(null);
            setPanel((p) => (p === "folder" ? null : "folder"));
          }}
        >
          <span className={circle}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="#50708a"
              strokeWidth={2.3}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M8 2.6v10.8M2.6 8h10.8" />
            </svg>
          </span>
          Link Folder
        </button>
      </div>
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
      {panel === "spec" && (
        <SpecPicker
          projectId={projectId}
          fns={fns}
          projectFolders={projectFolders}
          fullProj={fullProj}
          onError={fail}
          onDone={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
      {panel === "folder" && (
        <FolderPicker
          projectId={projectId}
          fns={fns}
          projectFolders={projectFolders}
          fullProj={fullProj}
          onError={fail}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

const sel =
  "min-w-0 flex-1 rounded-sm border border-line-soft bg-white px-1.5 py-3 text-[11.5px] text-ink outline-none";
const row = "mt-1.5 flex items-center gap-1.5";
const lbl = "w-16 shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-muted";
const go =
  "rounded-sm bg-ink px-2.5 py-3 text-[11px] text-[#f6f4ef] hover:bg-ink-soft disabled:opacity-40";

function SpecPicker({
  projectId,
  fns,
  projectFolders,
  fullProj,
  onError,
  onDone,
}: {
  projectId: string;
  fns: FunctionInfo[];
  projectFolders: string[];
  fullProj: (rel: string) => string;
  onError: (e: unknown) => void;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<ContainerFile[]>([]);
  const [path, setPath] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);

  // A project is always associated with the Engineering function — link files
  // from the engineering corpus (no function to choose).
  const engr = fns.find((f) => f.key === "engr");
  useEffect(() => {
    if (!engr) return;
    setFiles([]);
    setPath("");
    api
      .listContainerFiles(engr.stream_id)
      .then(setFiles)
      .catch(() => undefined);
  }, [engr?.stream_id]);

  const link = async () => {
    if (!path) return;
    setBusy(true);
    try {
      await api.linkProjectDoc(projectId, path, fullProj(dir));
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 rounded-sm border border-line-soft bg-white/60 p-1.5">
      <div className={row.replace("mt-1.5 ", "")}>
        <span className={lbl}>File</span>
        <select className={sel} value={path} onChange={(e) => setPath(e.target.value)}>
          <option value="">{files.length ? "Choose a file…" : "No files"}</option>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className={row}>
        <span className={lbl}>Into</span>
        <select className={sel} value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="">/ (project root)</option>
          {projectFolders.map((d) => (
            <option key={d} value={d}>
              {d}/
            </option>
          ))}
        </select>
        <button className={go} disabled={!path || busy} onClick={() => void link()}>
          {busy ? "Linking…" : "Link"}
        </button>
      </div>
    </div>
  );
}

function FolderPicker({
  projectId,
  fns,
  projectFolders,
  fullProj,
  onError,
  onChanged,
}: {
  projectId: string;
  fns: FunctionInfo[];
  projectFolders: string[];
  fullProj: (rel: string) => string;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [folderRel, setFolderRel] = useState("");
  const [destDirs, setDestDirs] = useState<string[]>([]);
  const [destRel, setDestRel] = useState("");
  const [busy, setBusy] = useState(false);
  const [portals, setPortals] = useState<LinkFolder[]>([]);

  // A project portal always routes to its Engineering function (no choice).
  const engFolder = fns.find((f) => f.key === "engr")?.folder ?? "engineering";

  const reloadPortals = () =>
    api.listLinkFolders(projectId).then(setPortals).catch(() => undefined);
  useEffect(() => {
    void reloadPortals();
  }, [projectId]);
  useEffect(() => {
    api
      .functionFolders("engr")
      .then(setDestDirs)
      .catch(() => undefined);
  }, []);

  const create = async () => {
    if (!folderRel || !destRel) return;
    setBusy(true);
    try {
      await api.createLinkFolder(
        projectId,
        fullProj(folderRel),
        "engr",
        `${engFolder}/${destRel}`,
      );
      await reloadPortals();
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteLinkFolder(projectId, id);
      await reloadPortals();
      onChanged();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="mt-1.5 rounded-sm border border-line-soft bg-white/60 p-1.5">
      <div className={row.replace("mt-1.5 ", "")}>
        <span className={lbl}>Folder</span>
        <select className={sel} value={folderRel} onChange={(e) => setFolderRel(e.target.value)}>
          <option value="">Choose a project folder…</option>
          {projectFolders.map((d) => (
            <option key={d} value={d}>
              {d}/
            </option>
          ))}
        </select>
      </div>
      <div className={row}>
        <span className={lbl}>Routes to</span>
        <span className="shrink-0 font-mono text-[10px] text-muted">{engFolder}/</span>
        <select className={sel} value={destRel} onChange={(e) => setDestRel(e.target.value)}>
          <option value="">folder…</option>
          {destDirs.map((d) => (
            <option key={d} value={d}>
              {d}/
            </option>
          ))}
        </select>
        <button className={go} disabled={!folderRel || !destRel || busy} onClick={() => void create()}>
          {busy ? "Setting…" : "Set"}
        </button>
      </div>
      {portals.length > 0 && (
        <ul className="mt-1.5 border-t border-line-soft pt-1">
          {portals.map((p) => (
            <li key={p.id} className="flex items-center gap-1 py-0.5 text-[11px] text-strong-alt">
              <span className="truncate">
                {p.folder_path.split("/").slice(2).join("/") || "/"} → {p.dest_dir}
              </span>
              <button
                className="ml-auto shrink-0 rounded px-1 text-muted hover:text-rose-600"
                title="Remove portal"
                onClick={() => void remove(p.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

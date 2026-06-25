import { useEffect, useRef, useState } from "react";

import type { FsTreeNode } from "../../api/client";
import type { PreviewFile } from "./FileViewer";

// Container filesystem panel (used by Company Home for a function and by the
// Project page for a project). A vertical folder tree: single-click a file to
// open it in the viewer; hover a file row for rename / move / delete; drop a
// desktop file onto a folder to upload there; create / delete folders. The
// container is supplied via props (root prefix + tree/upload/op callbacks) so
// the same panel serves both functions and projects.

interface FileOps {
  folders: string[];
  onRename: (path: string, newName: string) => void;
  onMove: (path: string, targetDir: string) => void;
  onDelete: (path: string) => void;
  onAddFolder: (parent: string, name: string) => void;
  onDeleteFolder: (path: string) => void;
}

export function FunctionFiles({
  containerKey,
  title,
  accent,
  rootPrefix,
  loadTree,
  upload: uploadProp,
  folders,
  reloadToken,
  onOpenFile,
  activePath,
  onUploaded,
  onRename,
  onMove,
  onDelete,
  onAddFolder,
  onDeleteFolder,
  variant = "panel",
}: {
  containerKey: string; // stable id; refetch the tree when it changes
  title: string; // header label
  accent: string;
  rootPrefix: string; // FILES_ROOT-relative container root (for relative paths)
  loadTree: () => Promise<FsTreeNode>;
  upload: (file: File, dir?: string) => Promise<unknown>;
  folders: string[];
  reloadToken: number;
  onOpenFile: (file: PreviewFile) => void;
  activePath: string | null;
  onUploaded?: () => void;
  onRename: (path: string, newName: string) => void;
  onMove: (path: string, targetDir: string) => void;
  onDelete: (path: string) => void;
  onAddFolder: (parent: string, name: string) => void;
  onDeleteFolder: (path: string) => void;
  // "panel" = fixed 520px left panel (Company Home); "fill" = fill its parent.
  variant?: "panel" | "fill";
}) {
  const [tree, setTree] = useState<FsTreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [rootOver, setRootOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newRoot, setNewRoot] = useState(false);
  const [rootDraft, setRootDraft] = useState("");

  // A folder's container-relative path (store_path minus the root prefix) —
  // what the folder endpoints + move expect.
  const relOf = (storePath: string | null | undefined): string =>
    storePath && storePath.startsWith(rootPrefix + "/")
      ? storePath.slice(rootPrefix.length + 1)
      : "";

  // Keep latest tree/upload closures in refs so the fetch effect can depend
  // only on the stable containerKey + reloadToken.
  const loadRef = useRef(loadTree);
  loadRef.current = loadTree;
  const uploadRef = useRef(uploadProp);
  uploadRef.current = uploadProp;

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadRef
      .current()
      .then((t) => live && setTree(t))
      .catch(() => live && setTree(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [containerKey, reloadToken]);

  const upload = async (dir: string | undefined, file: File) => {
    setBusy(true);
    try {
      await uploadRef.current(file, dir);
      onUploaded?.();
    } catch {
      /* surfaced elsewhere; keep the panel responsive */
    } finally {
      setBusy(false);
    }
  };

  const children = tree?.children ?? [];
  const ops: FileOps = {
    folders,
    onRename,
    onMove,
    onDelete,
    onAddFolder,
    onDeleteFolder,
  };

  return (
    <div
      className={
        variant === "fill"
          ? "flex h-full w-full flex-col bg-[#f1f1ef]"
          : "flex w-[520px] shrink-0 flex-col border-r border-line bg-[#f1f1ef]"
      }
    >
      <div className="flex h-[50px] items-center gap-2 border-b border-[#f8f8f6] bg-[#e8e8e4] px-4">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold uppercase leading-tight tracking-[0.08em] text-muted">
            {title}
          </span>
          <span
            className="mt-[5px] truncate font-mono text-[10px] leading-tight text-hint"
            title={`files/${rootPrefix}/`}
          >
            ( files/{rootPrefix}/ )
          </span>
        </span>
        {busy && <span className="shrink-0 font-mono text-[9px] text-hint">adding…</span>}
        <button
          onClick={() => {
            setRootDraft("");
            setNewRoot(true);
          }}
          className="ml-auto shrink-0 whitespace-nowrap rounded border border-line-soft bg-white px-2 py-0.5 font-mono text-[10px] text-strong-alt hover:bg-rowhover"
        >
          ＋ New folder
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto py-2"
        style={rootOver ? { background: `${accent}0d` } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setRootOver(true);
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setRootOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(undefined, f);
        }}
      >
        {newRoot && (
          <NewFolderInput
            value={rootDraft}
            depth={0}
            onChange={setRootDraft}
            onCommit={() => {
              const v = rootDraft.trim();
              if (v) onAddFolder("", v);
              setNewRoot(false);
            }}
            onCancel={() => setNewRoot(false)}
          />
        )}
        {loading ? (
          <p className="px-4 py-6 text-[12px] text-hint">Loading…</p>
        ) : children.length === 0 ? (
          <p className="px-4 py-6 text-[12px] leading-relaxed text-hint">
            No files yet — drop one here to add it.
          </p>
        ) : (
          children.map((node, i) => (
            <TreeNode
              key={i}
              node={node}
              depth={0}
              accent={accent}
              relOf={relOf}
              onOpenFile={onOpenFile}
              onUpload={upload}
              activePath={activePath}
              ops={ops}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  accent,
  relOf,
  onOpenFile,
  onUpload,
  activePath,
  ops,
}: {
  node: FsTreeNode;
  depth: number;
  accent: string;
  relOf: (storePath: string | null | undefined) => string;
  onOpenFile: (file: PreviewFile) => void;
  onUpload: (dir: string | undefined, file: File) => void;
  activePath: string | null;
  ops: FileOps;
}) {
  const isFolder = node.children != null;
  const [open, setOpen] = useState(depth < 1);
  // Auto-expand to reveal the active (selected/previewed) file: if it lives
  // under this folder, open it. Doesn't fight a later manual collapse — it
  // only re-opens when the active path changes to something inside.
  const containsActive =
    isFolder &&
    !!node.store_path &&
    !!activePath &&
    activePath.startsWith(node.store_path + "/");
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  const [over, setOver] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pad = depth * 14 + 12;

  if (isFolder) {
    const kids = node.children ?? [];
    const rel = relOf(node.store_path);
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && node.store_path) onUpload(node.store_path, f);
        }}
      >
        <div
          className="group relative flex items-center pr-2 hover:bg-rowhover"
          style={{
            background: over ? `${accent}1f` : undefined,
            boxShadow: over ? `inset 0 0 0 1px ${accent}66` : undefined,
          }}
        >
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
            style={{ paddingLeft: pad }}
          >
            <Chevron open={open} />
            <FolderGlyph />
            <span className="truncate text-[12.5px] text-strong">{node.name}</span>
          </button>
          {confirming ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px]">
              <span className="text-muted">Delete folder + contents?</span>
              <button
                onClick={() => setConfirming(false)}
                className="rounded border border-line-soft bg-white px-1.5 py-0.5 text-strong-alt hover:bg-rowhover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  ops.onDeleteFolder(rel);
                  setConfirming(false);
                }}
                className="rounded bg-ink px-1.5 py-0.5 text-[#f6f4ef] hover:bg-ink-soft"
              >
                Delete
              </button>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <IconBtn
                title="New subfolder"
                onClick={() => {
                  setSubDraft("");
                  setAddingSub(true);
                  setOpen(true);
                }}
              >
                <PlusGlyph />
              </IconBtn>
              <IconBtn title="Delete folder" onClick={() => setConfirming(true)}>
                <XGlyph />
              </IconBtn>
            </span>
          )}
        </div>
        {addingSub && (
          <NewFolderInput
            value={subDraft}
            depth={depth + 1}
            onChange={setSubDraft}
            onCommit={() => {
              const v = subDraft.trim();
              if (v) ops.onAddFolder(rel, v);
              setAddingSub(false);
            }}
            onCancel={() => setAddingSub(false)}
          />
        )}
        {open &&
          kids.map((c, i) => (
            <TreeNode
              key={i}
              node={c}
              depth={depth + 1}
              accent={accent}
              relOf={relOf}
              onOpenFile={onOpenFile}
              onUpload={onUpload}
              activePath={activePath}
              ops={ops}
            />
          ))}
      </div>
    );
  }

  return (
    <FileRow
      node={node}
      pad={pad + 16}
      accent={accent}
      active={!!node.store_path && node.store_path === activePath}
      onOpenFile={onOpenFile}
      ops={ops}
    />
  );
}

function FileRow({
  node,
  pad,
  accent,
  active,
  onOpenFile,
  ops,
}: {
  node: FsTreeNode;
  pad: number;
  accent: string;
  active: boolean;
  onOpenFile: (file: PreviewFile) => void;
  ops: FileOps;
}) {
  const path = node.store_path ?? "";
  const [mode, setMode] = useState<"idle" | "rename" | "move" | "delete">("idle");
  const [draft, setDraft] = useState(node.name);

  if (mode === "rename") {
    const commit = () => {
      const v = draft.trim();
      if (v && v !== node.name) ops.onRename(path, v);
      setMode("idle");
    };
    return (
      <div className="flex items-center gap-1.5 py-1 pr-2" style={{ paddingLeft: pad }}>
        <FileGlyph accent={accent} />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setMode("idle");
          }}
          onBlur={() => setMode("idle")}
          className="min-w-0 flex-1 rounded border border-line-soft bg-white px-1 py-0.5 text-[12.5px] text-ink outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className="group relative flex items-center pr-2 hover:bg-rowhover"
      style={{ paddingLeft: pad, background: active ? `${accent}1a` : undefined }}
    >
      <button
        onClick={() =>
          path && onOpenFile({ path, name: node.name, ext: extOf(node.name) })
        }
        disabled={!path}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        title={node.name}
      >
        <FileGlyph accent={accent} />
        <span
          className="truncate text-[12.5px]"
          style={{ color: active ? accent : "#605e54", fontWeight: active ? 600 : 400 }}
        >
          {node.name}
        </span>
      </button>

      {mode === "delete" ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          <span className="text-muted">Delete?</span>
          <button
            onClick={() => setMode("idle")}
            className="rounded border border-line-soft bg-white px-1.5 py-0.5 text-strong-alt hover:bg-rowhover"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              ops.onDelete(path);
              setMode("idle");
            }}
            className="rounded bg-ink px-1.5 py-0.5 text-[#f6f4ef] hover:bg-ink-soft"
          >
            Delete
          </button>
        </span>
      ) : (
        path && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            <IconBtn
              title="Rename"
              onClick={() => {
                setDraft(node.name);
                setMode("rename");
              }}
            >
              <PencilGlyph />
            </IconBtn>
            <IconBtn
              title="Move"
              onClick={() => setMode((m) => (m === "move" ? "idle" : "move"))}
            >
              <MoveGlyph />
            </IconBtn>
            <IconBtn title="Delete" onClick={() => setMode("delete")}>
              <XGlyph />
            </IconBtn>
          </span>
        )
      )}

      {mode === "move" && (
        <MovePopover
          folders={ops.folders}
          onPick={(dir) => {
            ops.onMove(path, dir);
            setMode("idle");
          }}
          onClose={() => setMode("idle")}
        />
      )}
    </div>
  );
}

function MovePopover({
  folders,
  onPick,
  onClose,
}: {
  folders: string[];
  onPick: (dir: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden
      />
      <div className="absolute right-2 top-7 z-50 max-h-72 w-52 overflow-y-auto rounded-lg border border-line-soft bg-white py-1 shadow-[0_8px_24px_-8px_rgba(20,18,12,.3)]">
        <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-hint">
          Move to
        </div>
        <button
          onClick={() => onPick("")}
          className="block w-full px-3 py-1 text-left text-[12.5px] text-strong hover:bg-rowhover"
        >
          Root
        </button>
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => onPick(f)}
            className="block w-full truncate px-3 py-1 text-left text-[12.5px] text-strong hover:bg-rowhover"
            title={f}
          >
            {f}
          </button>
        ))}
      </div>
    </>
  );
}

function NewFolderInput({
  value,
  depth,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  depth: number;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: depth * 14 + 12 }}
    >
      <FolderGlyph />
      <input
        autoFocus
        value={value}
        placeholder="New folder name"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        className="min-w-0 flex-1 rounded border border-line-soft bg-white px-1 py-0.5 text-[12.5px] text-ink outline-none"
      />
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-5 w-5 place-items-center rounded text-hint hover:bg-line hover:text-strong"
    >
      {children}
    </button>
  );
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className="shrink-0 text-hint"
      style={{ transform: open ? "rotate(90deg)" : "none" }}
      aria-hidden
    >
      <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-faint" aria-hidden>
      <path
        d="M1.5 4.5A1.5 1.5 0 013 3h3l1.5 1.5H13A1.5 1.5 0 0114.5 6v6A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileGlyph({ accent }: { accent: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path
        d="M4 1.5h5l3 3V14a.5.5 0 01-.5.5h-7A.5.5 0 014 14V2a.5.5 0 010-.5z"
        fill="none"
        stroke={accent}
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoveGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2 8h10M8.5 4.5L13 8l-4.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 3v10M3 8h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

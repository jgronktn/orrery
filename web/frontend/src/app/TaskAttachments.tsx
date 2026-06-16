// Attachments for an action item — shown in the timeline detail panel when a
// task/reminder/milestone is selected. Upload a new file or link an existing
// one in this container; open or detach existing attachments.
import { useEffect, useRef, useState } from "react";

import { api, ApiError, type ContainerFile, type TaskDoc } from "../api/client";

const cellBtn: React.CSSProperties = {
  border: "1px solid rgba(120,160,220,.2)", borderRadius: 8, color: "#9aa7bd",
  fontSize: 11, padding: "4px 8px", cursor: "pointer", background: "transparent",
};

export default function TaskAttachments({
  projectId,
  taskId,
  accent,
  onChange,
}: {
  projectId: string;
  taskId: string;
  accent: string;
  onChange?: () => void;
}) {
  const [docs, setDocs] = useState<TaskDoc[]>([]);
  const [picker, setPicker] = useState<ContainerFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = () =>
    api.listTaskDocs(projectId, taskId).then(setDocs).catch(() => {});
  useEffect(() => {
    setPicker(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  const after = () => {
    reload();
    onChange?.();
  };
  const fail = (err: unknown) =>
    window.alert(err instanceof ApiError ? err.message : "operation failed");

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      await api.uploadTaskDoc(projectId, taskId, f);
      after();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const togglePicker = async () => {
    if (picker) return setPicker(null);
    try {
      setPicker(await api.listContainerFiles(projectId));
    } catch (err) {
      fail(err);
    }
  };
  const link = async (path: string) => {
    setBusy(true);
    try {
      await api.linkTaskDoc(projectId, taskId, path);
      setPicker(null);
      after();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const detach = async (id: string) => {
    try {
      await api.unlinkTaskDoc(projectId, taskId, id);
      after();
    } catch (err) {
      fail(err);
    }
  };

  const attached = new Set(docs.map((d) => d.path));
  const candidates = (picker ?? []).filter((f) => !attached.has(f.path));

  return (
    <div className="mt-4" style={{ borderTop: "1px solid rgba(120,160,220,.12)", paddingTop: 13, fontFamily: "'JetBrains Mono',monospace" }}>
      <div style={{ fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82", marginBottom: 8 }}>ATTACHMENTS</div>

      {docs.length === 0 && <div style={{ fontSize: 11, color: "#5b6a82" }}>none</div>}
      {docs.map((d) => (
        <div key={d.id} className="mb-1.5 flex items-center gap-2">
          <a
            href={api.fileRawUrl(d.path)}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate"
            style={{ fontSize: 11, color: accent }}
            title={d.path}
          >
            ↗ {d.name}
          </a>
          <button onClick={() => detach(d.id)} title="Detach" style={{ border: "none", background: "none", color: "#5b6a82", cursor: "pointer", fontSize: 13 }}>
            ✕
          </button>
        </div>
      ))}

      <div className="mt-2 flex gap-1.5">
        <button onClick={() => fileInput.current?.click()} disabled={busy} style={cellBtn}>
          + Upload
        </button>
        <button onClick={togglePicker} disabled={busy} style={{ ...cellBtn, color: picker ? accent : "#9aa7bd" }}>
          Link existing
        </button>
        <input ref={fileInput} type="file" className="hidden" onChange={onUpload} />
      </div>

      {picker && (
        <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg" style={{ border: "1px solid rgba(120,160,220,.16)" }}>
          {candidates.length === 0 && (
            <div style={{ fontSize: 11, color: "#5b6a82", padding: "6px 8px" }}>no other files</div>
          )}
          {candidates.map((f) => (
            <button
              key={f.path}
              onClick={() => link(f.path)}
              disabled={busy}
              className="block w-full truncate text-left"
              style={{ fontSize: 11, color: "#c4cee0", padding: "5px 8px", background: "transparent", border: "none", cursor: "pointer" }}
              title={f.path}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

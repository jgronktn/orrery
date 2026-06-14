// Project timeline — a ~200px strip at the top of the main canvas that plots
// the project's items (files + action items + dropped documents) over time.
// Drag-and-drop any file onto it to record it; .eml emails are dated by their
// sent/received header. Clicking it (or ⤢) opens the full ATLAS timeline.
import { useCallback, useEffect, useState, type DragEvent } from "react";

import { api, ApiError, type TimelineNode } from "../api/client";
import TimelinePlot from "./TimelinePlot";

export default function Timeline({
  activeId,
  projectName,
}: {
  activeId: string | null;
  projectName: string;
}) {
  const [nodes, setNodes] = useState<TimelineNode[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!activeId) return;
    api
      .projectTimeline(activeId)
      .then(setNodes)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "failed to load"),
      );
  }, [activeId]);

  useEffect(() => {
    if (!activeId) {
      setNodes([]);
      return;
    }
    let live = true;
    api
      .projectTimeline(activeId)
      .then((n) => live && setNodes(n))
      .catch((e) =>
        live && setError(e instanceof ApiError ? e.message : "failed to load"),
      );
    return () => {
      live = false;
    };
  }, [activeId]);

  // Esc closes the overlay.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!activeId) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of files) await api.uploadDocument(activeId, f);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Remove a timeline item placed by mistake. Dropped docs delete the stored
  // file (git-removed, recoverable); action items delete the task row.
  const removeItem = async (id: string) => {
    if (!activeId) return;
    setError(null);
    try {
      if (id.startsWith("doc:")) await api.deleteDocument(activeId, id.slice(4));
      else if (id.startsWith("task:")) await api.deleteTask(activeId, id.slice(5));
      else return;
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "remove failed");
    }
  };

  const dropHandlers = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        setDragging(false);
    },
    onDrop,
  };

  const overlayChrome = (
    <>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-sky-500/10 ring-2 ring-inset ring-sky-400/60">
          <span className="rounded-lg bg-slate-900/85 px-3 py-1.5 text-sm text-sky-100">
            Drop files to add to the timeline
          </span>
        </div>
      )}
      {uploading && (
        <span className="pointer-events-none absolute bottom-2 left-3 z-40 text-xs text-sky-200">
          Uploading…
        </span>
      )}
      {error && (
        <p className="pointer-events-none absolute bottom-2 right-3 z-40 text-xs text-rose-300">
          {error}
        </p>
      )}
    </>
  );

  // No project selected — keep the slot, light empty state.
  if (!activeId) {
    return (
      <section className="flex h-[200px] shrink-0 flex-col rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Timeline
        </h2>
        <div className="grid flex-1 place-items-center">
          <p className="text-sm text-slate-400">
            Select a project to see its timeline.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section
        {...dropHandlers}
        className="relative h-[200px] shrink-0 overflow-hidden rounded-xl border border-slate-800"
      >
        <TimelinePlot
          nodes={nodes}
          variant="strip"
          projectName={projectName}
          onExpand={() => setExpanded(true)}
        />
        {overlayChrome}
      </section>

      {expanded && (
        <div {...dropHandlers} className="fixed inset-0 z-50">
          <TimelinePlot
            nodes={nodes}
            variant="full"
            projectName={projectName}
            onClose={() => setExpanded(false)}
            onRemove={removeItem}
          />
          {overlayChrome}
        </div>
      )}
    </>
  );
}

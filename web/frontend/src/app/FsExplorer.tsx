// ATLAS filesystem explorer — full-screen overlay. The canvas + interaction +
// 3D engine live in FsEngine; this component owns the DOM chrome (breadcrumb,
// mode toggle, legend, minimap, detail panel, tooltip) and bridges the engine's
// state callbacks into React.
import { useEffect, useRef, useState } from "react";

import type { FsTreeNode } from "../api/client";
import {
  FsEngine,
  type Crumb,
  type Mode,
  type RawNode,
  type SelectedFile,
} from "./fsEngine";

const LEGEND = [
  ["folder", "#ffc14d"],
  ["source", "#54c7ff"],
  ["style", "#b388ff"],
  ["data", "#5ce0a0"],
  ["asset", "#ff9e5e"],
  ["doc", "#9aa7bd"],
] as const;

const PANEL = "rgba(8,12,21,.72)";
const HAIR = "1px solid rgba(120,160,220,.16)";

export default function FsExplorer({
  tree,
  accent = "#54c7ff",
  onClose,
}: {
  tree: FsTreeNode;
  accent?: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>("tree");
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [counts, setCounts] = useState({ files: 0, folders: 0 });

  const engineRef = useRef<FsEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new FsEngine({
      accent,
      onState: (p) => {
        if ("mode" in p) setMode(p.mode!);
        if ("crumbs" in p) setCrumbs(p.crumbs!);
        if ("selected" in p) setSelected(p.selected!);
      },
    });
  }
  const engine = engineRef.current;

  useEffect(() => {
    const els = {
      container: containerRef.current!,
      scene: sceneRef.current!,
      mini: miniRef.current!,
      tooltip: tooltipRef.current!,
    };
    engine.mount(els, tree as RawNode, "tree");
    setCounts({ files: engine.fileCount, folders: engine.folderCount });
    return () => engine.unmount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleBtn = (active: boolean): React.CSSProperties => ({
    padding: "7px 13px", border: "none", borderRadius: 8,
    font: "600 11.5px 'Space Grotesk',sans-serif", letterSpacing: ".06em", cursor: "pointer",
    whiteSpace: "nowrap",
    background: active ? accent : "transparent",
    color: active ? "#05080f" : "#8493ab",
    boxShadow: active ? `0 0 16px ${accent}73` : "none",
  });

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 overflow-hidden select-none"
      style={{
        background: "radial-gradient(120% 120% at 50% 0%,#0a1120 0%,#04070d 70%)",
        fontFamily: "'Space Grotesk',sans-serif", color: "#dce3ef",
      }}
    >
      <canvas ref={sceneRef} className="absolute inset-0 block h-full w-full" style={{ cursor: "grab", touchAction: "none" }} />

      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-40 whitespace-nowrap rounded-md px-2.5 py-1 opacity-0"
        style={{ transform: "translate(-50%,-150%)", background: "rgba(7,11,20,.92)", border: HAIR, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#e6ecf6", transition: "opacity .12s", backdropFilter: "blur(8px)" }}
      />

      {/* top chrome */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between" style={{ padding: "18px 22px" }}>
        <div className="pointer-events-auto flex flex-col gap-3" style={{ maxWidth: "62%" }}>
          <div className="flex items-center gap-2.5">
            <div className="relative" style={{ width: 24, height: 24, borderRadius: 6, border: `1.5px solid ${accent}`, boxShadow: `0 0 16px ${accent}55` }}>
              <div className="absolute" style={{ inset: 5, borderRadius: 2, background: accent, animation: "atlasPulse 2.6s ease-in-out infinite" }} />
            </div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: ".16em" }}>ATLAS</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#5b6a82", letterSpacing: ".05em" }}>filesystem.explorer</span>
            </div>
          </div>
          {/* breadcrumb */}
          <div className="flex flex-wrap items-center gap-1.5" style={{ fontFamily: "'JetBrains Mono',monospace" }}>
            <button onClick={() => engine.goUp()} title="Up one level"
              className="flex items-center justify-center" style={{ width: 26, height: 26, border: HAIR, borderRadius: 7, background: "rgba(10,16,28,.6)", color: "#9aa7bd", cursor: "pointer", fontSize: 13, backdropFilter: "blur(8px)" }}>↑</button>
            {crumbs.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: "#3c4a60", fontSize: 12 }}>/</span>}
                <button onClick={() => engine.goToId(c.id)}
                  style={{ padding: "4px 9px", border: "1px solid rgba(120,160,220,.14)", borderRadius: 7, background: "rgba(10,16,28,.55)", color: "#c4cee0", cursor: "pointer", fontSize: 12, letterSpacing: ".02em", backdropFilter: "blur(8px)" }}>
                  {c.name}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2.5">
          <div className="flex gap-1 p-1" style={{ border: HAIR, borderRadius: 11, background: "rgba(10,16,28,.6)", backdropFilter: "blur(8px)" }}>
            <button onClick={() => engine.setMode("tree")} style={toggleBtn(mode === "tree")}>≣ TREE</button>
            <button onClick={() => engine.setMode("orbit")} style={toggleBtn(mode === "orbit")}>✦ CONSTELLATION</button>
            <button onClick={onClose} title="Close (Esc)" style={{ width: 32, border: "none", borderRadius: 8, background: "transparent", color: "#c4cee0", cursor: "pointer", fontSize: 15 }}>✕</button>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#6b7a92", letterSpacing: ".04em", textAlign: "right" }}>
            <span style={{ color: accent }}>{counts.files}</span> files
            <span style={{ color: "#3c4a60", margin: "0 5px" }}>·</span>
            <span style={{ color: "#ffc14d" }}>{counts.folders}</span> folders
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="absolute z-20" style={{ right: 22, bottom: 22, padding: "13px 15px", border: "1px solid rgba(120,160,220,.14)", borderRadius: 12, background: PANEL, backdropFilter: "blur(10px)", fontFamily: "'JetBrains Mono',monospace" }}>
        <div style={{ fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82", marginBottom: 9 }}>FILE TYPES</div>
        <div className="grid grid-cols-2" style={{ gap: "6px 16px", fontSize: 11, color: "#aab6c8" }}>
          {LEGEND.map(([label, color]) => (
            <div key={label} className="flex items-center gap-2">
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 7px ${color}99` }} />{label}
            </div>
          ))}
        </div>
      </div>

      {/* minimap */}
      <div className="absolute z-20" style={{ left: 22, bottom: 22, padding: 10, border: "1px solid rgba(120,160,220,.14)", borderRadius: 12, background: PANEL, backdropFilter: "blur(10px)" }}>
        <div className="flex justify-between" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82", marginBottom: 7 }}>
          <span>OVERVIEW</span><span style={{ color: accent }}>●</span>
        </div>
        <canvas ref={miniRef} className="block" style={{ width: 188, height: 118, borderRadius: 6 }} />
      </div>

      {/* controls hint */}
      <div className="pointer-events-none absolute z-[15] text-center" style={{ left: "50%", bottom: 22, transform: "translateX(-50%)", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#54627a", letterSpacing: ".06em" }}>
        drag <span style={{ color: "#8493ab" }}>pan</span> · scroll <span style={{ color: "#8493ab" }}>zoom</span> · click <span style={{ color: "#8493ab" }}>enter folder</span> · <span style={{ color: "#8493ab" }}>constellation</span> orbits
      </div>

      {/* detail panel */}
      {selected && (
        <div className="absolute z-[25]" style={{ right: 22, top: "50%", transform: "translateY(-50%)", width: 268, padding: 18, border: "1px solid rgba(120,160,220,.18)", borderRadius: 14, background: "rgba(8,12,21,.82)", backdropFilter: "blur(12px)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
          <div className="mb-3.5 flex items-start justify-between">
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82" }}>SELECTED</span>
            <button onClick={() => engine.closeDetail()} style={{ border: "none", background: "none", color: "#5b6a82", cursor: "pointer", fontSize: 15 }}>✕</button>
          </div>
          <div className="mb-4 flex items-center gap-2.5">
            <span style={{ width: 13, height: 13, borderRadius: "50%", background: selected.color, boxShadow: `0 0 12px ${selected.color}` }} />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: "#eef2f8", wordBreak: "break-all" }}>{selected.name}</span>
          </div>
          <div className="flex flex-col gap-2.5" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
            <Row k="type" v={selected.typeLabel} vColor={selected.color} />
            <Row k="ext" v={selected.ext} />
            <Row k="parent" v={selected.parent} />
            <div style={{ borderTop: "1px solid rgba(120,160,220,.12)", paddingTop: 11 }}>
              <div style={{ color: "#5b6a82", marginBottom: 5 }}>path</div>
              <div style={{ color: "#9fb0ca", lineHeight: 1.55, wordBreak: "break-all", fontSize: 10.5 }}>{selected.path}</div>
            </div>
          </div>
        </div>
      )}

      <style>{"@keyframes atlasPulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
    </div>
  );
}

function Row({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "#5b6a82" }}>{k}</span>
      <span style={{ color: vColor ?? "#c4cee0", letterSpacing: ".02em" }}>{v}</span>
    </div>
  );
}

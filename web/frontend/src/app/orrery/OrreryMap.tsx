import { useEffect, useRef, useState } from "react";

import type { FunctionInfo } from "../../api/client";
import { accentOf, bodyXY, fnAbbr, GEOMETRY, STAGE, tint } from "./theme";

// The orrery stage: decorative orbit rings, ambient rotating tick layers, the
// clickable company core, and one body per function. Selection is instant —
// no CSS transition on the discs/ring (the handoff calls this out: a
// transition there visibly lags the accent behind the new selection).

export type Selection = "company" | string; // "company" | function key

export function OrreryMap({
  functions,
  selected,
  onSelect,
  onOpen,
  onOpenVault,
  onDropFile,
  toolLines = [],
}: {
  functions: FunctionInfo[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  onOpen: (key: string) => void;
  onOpenVault?: () => void;
  onDropFile: (key: string, file: File) => void;
  // Faint connector lines (core → attached tools), measured by the parent in
  // this map's coordinate space; drawn above the gradient, behind the bodies.
  toolLines?: { x1: number; y1: number; x2: number; y2: number }[];
}) {
  const accent = selected !== "company" ? accentOf(selected) : "#353a32";
  const selGeo = selected !== "company" ? GEOMETRY[selected] : undefined;

  // When a function is selected the left filesystem panel is visible: the map
  // shrinks (1.3 → ~1.0) and centers in the remaining canvas to the right of
  // the panel (the flex column already centers it, so no x-offset).
  const fileVisible = selected !== "company";
  const stageTransform = fileVisible
    ? "translateY(-65px) scale(1.0)"
    : "translateY(-65px) scale(1.3)";

  return (
    <div className="relative grid flex-1 place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_46%,#FCFCFB_0%,#F6F6F4_62%,#F1F1ED_100%)]">
      {/* core → attached-tool tethers: above the gradient, behind everything
          else (placed first so it paints under the stage's bodies) */}
      {toolLines.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full">
          {toolLines.map((l, i) => (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#9ba08b"
              strokeWidth={1}
              opacity={0.3}
            />
          ))}
        </svg>
      )}
      <div
        className="relative"
        style={{
          width: STAGE,
          height: STAGE,
          transform: stageTransform,
        }}
      >
        {/* decorative orbit rings */}
        <Ring d={232} border="1px solid #D8DCCB" />
        <Ring d={300} border="1px dashed #D6DAC8" />
        <Ring d={428} border="1px solid #DDE1D2" />
        <Ring d={472} border="1px solid #E0E4D5" />

        {/* ambient tick layers (purely decorative) — a few scattered dots */}
        <TickLayer d={258} count={1} anim="animate-orrery-spin" />
        <TickLayer d={372} count={2} anim="animate-orrery-spin-rev" />
        <TickLayer d={450} count={1} anim="animate-orrery-spin-slow" />

        {/* selected-function orbit highlight (instant, no transition) */}
        {selGeo && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: selGeo.r * 2,
              height: selGeo.r * 2,
              border: `1.5px solid ${accent}88`,
              boxShadow: `inset 0 0 30px -4px ${accent}55`,
              zIndex: 2,
            }}
          />
        )}

        {/* company core */}
        <button
          data-orrery-core
          onClick={() => onSelect("company")}
          className="absolute left-1/2 top-1/2 z-[3] grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink text-center shadow-[0_0_0_10px_rgba(27,26,23,.06),0_20px_44px_-16px_rgba(27,26,23,.6)]"
          style={{ width: 112, height: 112 }}
        >
          {selected === "company" && (
            <span
              className="absolute rounded-full"
              style={{
                width: 134,
                height: 134,
                border: "1.5px solid #353a32",
                opacity: 0.45,
              }}
            />
          )}
          <span className="text-[26px] font-bold leading-none text-[#f4f6ee]">
            PPI
          </span>
        </button>

        {/* function bodies */}
        {functions.map((f) => (
          <Body
            key={f.key}
            f={f}
            selected={selected === f.key}
            onSelect={() => onSelect(f.key)}
            onOpen={() => onOpen(f.key)}
            onDropFile={onDropFile}
          />
        ))}

        {/* IT credential vault — a small moon beside the IT body when selected */}
        {selected === "it" && onOpenVault && <VaultMoon onOpen={onOpenVault} />}
      </div>
    </div>
  );
}

function VaultMoon({ onOpen }: { onOpen: () => void }) {
  const accent = accentOf("it");
  const { x, y } = bodyXY("it");
  const moon = Math.round(72 * 0.6); // 60% of the selected disc
  // Place the moon radially outward along IT's orbit, 30px past the disc edge,
  // so the center-to-center connector runs at a slight angle.
  const dist = 36 + 30 + moon / 2;
  const ang = GEOMETRY.it?.a ?? 18; // IT's orbital angle (deg)
  const rad = (ang * Math.PI) / 180;
  const mx = x + dist * Math.cos(rad);
  const my = y + dist * Math.sin(rad);

  return (
    <>
      {/* connector along IT's radial, nudged up a touch, behind the discs */}
      <div
        className="absolute z-[1]"
        style={{
          left: x,
          top: y - 9,
          width: dist,
          height: 2,
          background: `${accent}99`,
          transformOrigin: "0 50%",
          transform: `rotate(${ang}deg)`,
        }}
      />
      <div
        className="absolute z-[4] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        style={{ left: mx, top: my }}
      >
      <button
        onClick={onOpen}
        title="Account logins"
        className="grid place-items-center rounded-full bg-white"
        style={{
          width: moon,
          height: moon,
          color: accent,
          border: `1.5px solid ${accent}66`,
          boxShadow: `0 6px 16px -10px rgba(20,18,12,.45)`,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
          <circle cx="5.5" cy="6.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7.6 8.6L13 14M11 12l1.5-1.5M12.5 13.5L14 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
        <span className="mt-1.5 font-mono text-[9.5px] leading-tight text-[#7e8270]">Logins</span>
      </div>
    </>
  );
}

function Ring({ d, border }: { d: number; border: string }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ width: d, height: d, border }}
      aria-hidden
    />
  );
}

function TickLayer({
  d,
  count,
  anim,
}: {
  d: number;
  count: number;
  anim: string;
}) {
  return (
    <div
      className={`absolute left-1/2 top-1/2 rounded-full ${anim}`}
      style={{ width: d, height: d }}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => {
        const rad = (i / count) * 2 * Math.PI;
        return (
          <span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{
              background: "#A9AD97aa",
              left: `${50 + 50 * Math.cos(rad)}%`,
              top: `${50 + 50 * Math.sin(rad)}%`,
              transform: "translate(-50%,-50%)",
            }}
          />
        );
      })}
    </div>
  );
}

function Body({
  f,
  selected,
  onSelect,
  onOpen,
  onDropFile,
}: {
  f: FunctionInfo;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDropFile: (key: string, file: File) => void;
}) {
  const [over, setOver] = useState(false);
  const accent = accentOf(f.key);
  const { x, y } = bodyXY(f.key);
  const size = selected ? 72 : 56;

  // Single click selects; a second click within the window opens the function
  // page. We disambiguate manually because selecting shifts/shrinks the map,
  // which moves the disc out from under the cursor and breaks native dblclick.
  const clickTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (clickTimer.current != null) clearTimeout(clickTimer.current);
    },
    [],
  );
  const handleClick = () => {
    if (clickTimer.current != null) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onOpen();
    } else {
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        onSelect();
      }, 240);
    }
  };

  return (
    <div
      className="absolute z-[4] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: x, top: y }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onDropFile(f.key, file);
      }}
    >
      <button
        onClick={handleClick}
        className="grid place-items-center rounded-full font-semibold"
        style={{
          width: size,
          height: size,
          fontSize: selected ? 15 : 13,
          background: selected ? accent : over ? tint(accent, "22") : "#ffffff",
          color: selected ? "#fff" : "#6f7363",
          border: selected
            ? "2.5px solid #F5F7EE"
            : over
              ? `1.5px solid ${accent}`
              : "1.5px solid #D2D6C3",
          boxShadow: selected
            ? `0 0 0 7px ${accent}22, 0 16px 34px -10px ${accent}cc`
            : "0 6px 16px -10px rgba(20,18,12,.45)",
        }}
      >
        {fnAbbr(f.key, f.name)}
      </button>
      <div className="mt-2 flex flex-col items-center gap-px text-center">
        <span
          className="leading-tight"
          style={{
            fontSize: selected ? 13.5 : 12.5,
            fontWeight: selected ? 700 : 500,
            color: selected ? "#353a32" : "#7e8270",
          }}
        >
          {f.name}
        </span>
        <span
          className="font-mono text-[10.5px]"
          style={{ color: selected ? accent : "#9ba08b" }}
        >
          {f.pending_count} pending
        </span>
        {f.reminder_count > 0 && (
          <span className="font-mono text-[10px] text-hint-alt">
            {f.reminder_count} reminder{f.reminder_count === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

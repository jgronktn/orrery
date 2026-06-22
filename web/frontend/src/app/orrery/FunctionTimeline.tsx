import { useEffect, useRef, useState } from "react";

import type { TimelineNode } from "../../api/client";
import { fmtTick, niceStep, typeColor, typeLabel } from "./timelineScale";

// Horizontal activity timeline: a time axis at the vertical center with
// zoom-dependent tick marks. Zoom-in is capped so one day fills the width;
// zoom-out is capped at a 6-year window (now ±3y, centered). Level of detail:
// zoomed out, events are circle dots on the axis; zoomed in past a threshold
// they become small tags (name + type) above & below the line. `compact`
// renders a small version for the rail (no chrome).

const DAY = 86_400_000;
const YEARS6 = 6 * 365 * DAY; // widest view: 3 years back … 3 years forward
const TAG_AT = 0.2; // tags appear once one day spans ≥ 20% of the width

interface Dims {
  cardW: number;
  cardH: number;
  rowH: number;
  axisGap: number;
  titlePx: number;
  metaPx: number;
  dot: number;
}
const FULL: Dims = { cardW: 156, cardH: 40, rowH: 50, axisGap: 16, titlePx: 12, metaPx: 9.5, dot: 5 };
const MINI: Dims = { cardW: 104, cardH: 26, rowH: 30, axisGap: 9, titlePx: 10.5, metaPx: 8, dot: 4 };

interface Placed {
  node: TimelineNode;
  x: number;
  side: "above" | "below";
  row: number;
}

function layoutLanes(
  nodes: TimelineNode[],
  xAt: (t: number) => number,
  cardW: number,
): Placed[] {
  const sorted = [...nodes].sort((a, b) => a.time - b.time);
  const rowsAbove: number[] = [];
  const rowsBelow: number[] = [];
  const out: Placed[] = [];
  sorted.forEach((node, i) => {
    const x = xAt(node.time);
    const left = x - cardW / 2;
    const right = x + cardW / 2;
    const side: "above" | "below" = i % 2 === 0 ? "above" : "below";
    const rows = side === "above" ? rowsAbove : rowsBelow;
    let row = 0;
    while (row < rows.length && (rows[row] ?? -Infinity) > left - 8) row++;
    rows[row] = right;
    out.push({ node, x, side, row });
  });
  return out;
}

const clamp = (ppm: number, minPpm: number, maxPpm: number) =>
  Math.max(minPpm, Math.min(maxPpm, ppm));

export function FunctionTimeline({
  nodes,
  accent,
  compact = false,
  selectedId = null,
  focusTime = null,
  onSelect,
  onDropFile,
  onDropKind,
}: {
  nodes: TimelineNode[];
  accent: string;
  compact?: boolean;
  selectedId?: string | null;
  /** When set, center + zoom the view onto this time (e.g. an opened file). */
  focusTime?: number | null;
  onSelect?: (n: TimelineNode | null) => void;
  onDropFile?: (file: File) => void;
  /** A composer icon (action item/reminder/milestone) dropped at a position;
   * `timeMs` is the dropped x mapped to a time so the item is dated there. */
  onDropKind?: (kind: string, timeMs: number) => void;
}) {
  const d = compact ? MINI : FULL;
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: compact ? 170 : 440 });
  const [ppm, setPpm] = useState<number | null>(null);
  const [center, setCenter] = useState<number>(Date.now());
  const [over, setOver] = useState(false);
  const drag = useRef<{ x: number; center: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const W = size.w;
  const H = size.h;
  const axisY = Math.round(H / 2);
  const dayPpm = W > 0 ? W / DAY : 1e-5; // one day fills the width → max zoom-in
  const minPpm = (W > 0 ? W : 1000) / YEARS6; // 6-year window → max zoom-out
  const pxPerMs = clamp(ppm ?? 1e-5, minPpm, dayPpm);

  // Fully zoomed out, now-centered: 3 years back on the left, 3 years forward
  // on the right. The default view on both the function page and the rail.
  const home = (w = size.w) => {
    setCenter(Date.now());
    setPpm((w > 0 ? w : 1000) / YEARS6);
  };

  useEffect(() => {
    if (size.w > 0 && ppm == null) home(size.w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, ppm]);

  // Center + zoom onto a file when it's opened (one day fills the width).
  useEffect(() => {
    if (focusTime == null || size.w <= 0) return;
    setCenter(focusTime);
    setPpm(size.w / DAY);
  }, [focusTime, size.w]);

  const xAt = (t: number) => W / 2 + (t - center) * pxPerMs;
  const timeAt = (x: number) => center + (x - W / 2) / pxPerMs;
  const tagMode = pxPerMs >= dayPpm * TAG_AT;

  const step = niceStep(pxPerMs, compact ? 96 : 150);
  const tMin = timeAt(0);
  const tMax = timeAt(W);
  const ticks: number[] = [];
  for (let t = Math.ceil(tMin / step) * step; t <= tMax && ticks.length < 60; t += step) {
    ticks.push(t);
  }

  const visible = nodes.filter((n) => {
    const x = xAt(n.time);
    return x > -d.cardW && x < W + d.cardW;
  });
  const placed = tagMode ? layoutLanes(visible, xAt, d.cardW) : [];
  const nowX = xAt(Date.now());

  const onWheel = (e: React.WheelEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const tUnder = timeAt(mx);
    const next = clamp(pxPerMs * Math.exp(-e.deltaY * 0.0012), minPpm, dayPpm);
    setCenter(tUnder - (mx - W / 2) / next);
    setPpm(next);
  };

  // Frame the current day edge-to-edge (UTC): midnight today at the left,
  // midnight tomorrow at the right, so 12:00 noon sits in the center.
  const today = () => {
    const n = new Date();
    const utcMidnight = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    setCenter(utcMidnight + DAY / 2);
    setPpm(dayPpm);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, center, moved: false };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const dr = drag.current;
      if (!dr) return;
      const dx = e.clientX - dr.x;
      if (Math.abs(dx) > 3) dr.moved = true;
      setCenter(dr.center - dx / pxPerMs);
    };
    const up = () => {
      const dr = drag.current;
      drag.current = null;
      if (dr && !dr.moved) onSelect?.(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [pxPerMs, onSelect]);

  return (
    <div
      ref={ref}
      className="relative h-full w-full cursor-grab overflow-hidden bg-[radial-gradient(circle_at_50%_50%,#F5F7EE_0%,#EEF0E6_100%)] active:cursor-grabbing"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onDragOver={
        onDropFile || onDropKind
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={onDropFile || onDropKind ? () => setOver(false) : undefined}
      onDrop={
        onDropFile || onDropKind
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) {
                onDropFile?.(f);
                return;
              }
              const k = e.dataTransfer.getData("application/x-orrery-kind");
              const rect = ref.current?.getBoundingClientRect();
              if (k && onDropKind && rect) {
                onDropKind(k, timeAt(e.clientX - rect.left));
              }
            }
          : undefined
      }
    >
      <svg width={W} height={H} className="absolute inset-0">
        <line x1={0} y1={axisY} x2={W} y2={axisY} stroke="#d2d6c2" strokeWidth={1.5} />
        {ticks.map((t) => {
          const x = xAt(t);
          return (
            <g key={t}>
              <line x1={x} y1={axisY - 5} x2={x} y2={axisY + 5} stroke="#c4c8b6" strokeWidth={1} />
              <text
                x={x}
                y={axisY + (compact ? 16 : 20)}
                textAnchor="middle"
                className="fill-faint font-mono"
                style={{ fontSize: compact ? 8.5 : 10 }}
              >
                {fmtTick(t, step)}
              </text>
            </g>
          );
        })}
        {nowX > 0 && nowX < W && (
          <>
            <line x1={nowX} y1={0} x2={nowX} y2={H} stroke={accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            {!compact && (
              <text x={nowX} y={14} textAnchor="middle" className="font-mono" style={{ fontSize: 9, fill: accent }}>
                NOW
              </text>
            )}
          </>
        )}

        {/* tag mode: connectors + axis dots */}
        {placed.map((p) => {
          const color = typeColor(p.node);
          const cardNearY =
            p.side === "above"
              ? axisY - d.axisGap - p.row * d.rowH
              : axisY + d.axisGap + p.row * d.rowH;
          return (
            <g key={p.node.id}>
              <line x1={p.x} y1={axisY} x2={p.x} y2={cardNearY} stroke={color} strokeWidth={1} opacity={0.5} />
              <circle cx={p.x} cy={axisY} r={3} fill={color} />
            </g>
          );
        })}

        {/* dot mode: events are circle dots on the axis */}
        {!tagMode &&
          visible.map((n) => {
            const x = xAt(n.time);
            const sel = n.id === selectedId;
            return (
              <circle
                key={n.id}
                cx={x}
                cy={axisY}
                r={sel ? d.dot + 1.5 : d.dot}
                fill={typeColor(n)}
                stroke={sel ? "#1b1a17" : "#F5F7EE"}
                strokeWidth={sel ? 1.5 : 1.5}
                style={{ cursor: onSelect ? "pointer" : "default" }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(n);
                }}
              >
                <title>{n.name}</title>
              </circle>
            );
          })}
      </svg>

      {/* tag mode: event cards (name + type) */}
      {placed.map((p) => {
        const color = typeColor(p.node);
        const top =
          p.side === "above"
            ? axisY - d.axisGap - p.row * d.rowH - d.cardH
            : axisY + d.axisGap + p.row * d.rowH;
        const selected = p.node.id === selectedId;
        return (
          <button
            key={p.node.id}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(p.node);
            }}
            className="absolute flex flex-col justify-center gap-0.5 rounded-lg border bg-white px-2 text-left"
            style={{
              left: p.x - d.cardW / 2,
              top,
              width: d.cardW,
              height: d.cardH,
              borderColor: selected ? color : "#e0e3d4",
              borderLeft: `3px solid ${color}`,
              boxShadow: selected
                ? `0 0 0 2px ${color}66, 0 6px 16px -8px ${color}88`
                : "0 2px 8px -4px rgba(20,18,12,.28)",
              cursor: onSelect ? "pointer" : "default",
            }}
          >
            <span className="truncate font-medium text-strong" style={{ fontSize: d.titlePx }} title={p.node.name}>
              {p.node.name}
            </span>
            <span className="truncate font-mono uppercase tracking-wide" style={{ fontSize: d.metaPx, color }}>
              {typeLabel(p.node)}
            </span>
          </button>
        );
      })}

      {over && (onDropFile || onDropKind) && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center"
          style={{ background: `${accent}14`, boxShadow: `inset 0 0 0 2px ${accent}66` }}
        >
          <span className="rounded-lg bg-white px-3 py-1.5 text-[12px] text-strong shadow">
            Drop here to add — at this point on the timeline
          </span>
        </div>
      )}

      <div className="absolute bottom-2 right-2 flex items-center gap-1">
        <ZoomBtn onClick={() => setPpm(clamp(pxPerMs * 1.6, minPpm, dayPpm))}>＋</ZoomBtn>
        <ZoomBtn onClick={() => setPpm(clamp(pxPerMs / 1.6, minPpm, dayPpm))}>−</ZoomBtn>
        <button
          onClick={today}
          className="rounded-lg border border-line-soft bg-white px-2 py-1 font-mono text-[10px] text-strong-alt hover:bg-rowhover"
        >
          TODAY
        </button>
        <button
          onClick={() => home()}
          className="rounded-lg border border-line-soft bg-white px-2 py-1 font-mono text-[10px] text-strong-alt hover:bg-rowhover"
        >
          RESET
        </button>
      </div>
      {nodes.length === 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 text-center text-hint"
          style={{ top: "26%", fontSize: compact ? 11 : 13 }}
        >
          {compact ? "No activity yet" : "No activity yet — drop a file or add an action item below."}
        </div>
      )}
    </div>
  );
}

function ZoomBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-lg border border-line-soft bg-white text-[14px] text-strong-alt hover:bg-rowhover"
    >
      {children}
    </button>
  );
}

// ATLAS · filesystem.timeline — a canvas-rendered timeline of a project's
// files + action items, ported from the design prototype. The plot (axis,
// ticks, dots↔cards crossfade, fanning, pan/zoom, NOW) is drawn on a single
// <canvas>; the chrome (top bar, legend, controls, detail panel) is DOM.
import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { TimelineNode } from "../api/client";

const COLORS: Record<string, string> = {
  code: "#54c7ff",
  style: "#b388ff",
  markup: "#ff6e8a",
  data: "#5ce0a0",
  doc: "#9aa7bd",
  image: "#ff9e5e",
  config: "#6b7689",
  email: "#2dd4bf",
  task: "#f4c95d",
  milestone: "#ffffff",
  reminder: "#ff8a5b",
  other: "#7f8aa0",
};
const LABELS: Record<string, string> = {
  code: "Source",
  style: "Stylesheet",
  markup: "Markup",
  data: "Data",
  doc: "Document",
  image: "Asset",
  email: "Email",
  task: "Task",
  milestone: "Milestone",
  reminder: "Reminder",
  other: "File",
};
const LEGEND = [
  ["source", "#54c7ff"],
  ["style", "#b388ff"],
  ["markup", "#ff6e8a"],
  ["data", "#5ce0a0"],
  ["asset", "#ff9e5e"],
  ["doc", "#9aa7bd"],
  ["email", "#2dd4bf"],
  ["task", "#f4c95d"],
  ["milestone", "#ffffff"],
  ["reminder", "#ff8a5b"],
] as const;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
const fmtTime = (t: number) => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const fmtTimeS = (t: number) => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
const fmtDate = (t: number) => { const d = new Date(t); return MON[d.getMonth()] + " " + d.getDate(); };
const fmtSize = (b: number | null | undefined) => {
  if (b == null) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
};
const fmtSpan = (ms: number) => {
  const s = ms / 1000; if (s < 90) return Math.round(s) + "s";
  const m = s / 60; if (m < 90) return Math.round(m) + "m";
  const h = m / 60; if (h < 36) return h.toFixed(h < 10 ? 1 : 0) + "h";
  return (h / 24).toFixed(h / 24 < 10 ? 1 : 0) + "d";
};
const SCALE = (() => { const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
  return [S, 2*S, 5*S, 10*S, 15*S, 30*S, M, 2*M, 5*M, 10*M, 15*M, 30*M, H, 2*H, 3*H, 6*H, 12*H, D, 2*D, 7*D, 14*D, 30*D]; })();
const niceStep = (pxPerMs: number): number => { const want = 150 / pxPerMs; for (const s of SCALE) if (s >= want) return s; return SCALE[SCALE.length - 1]!; };

interface RNode extends TimelineNode {
  color: string;
  _x: number; _vis: boolean; _targetY: number; _ty: number | null;
  _hp: number; _e: number; _cardH: number; _wC: number; _wE: number;
}

interface Selected {
  id: string; removable: boolean;
  name: string; desc: string | null; color: string; typeLabel: string;
  ext: string; size: string; time: string; date: string; batch: string;
  attached: string; kind: string; status: string | null;
}

export default function TimelinePlot({
  nodes,
  variant,
  projectName,
  accent = "#54c7ff",
  onExpand,
  onClose,
  onRemove,
}: {
  nodes: TimelineNode[];
  variant: "strip" | "full";
  projectName: string;
  accent?: string;
  onExpand?: () => void;
  onClose?: () => void;
  onRemove?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  // Mutable engine state (never triggers React re-render).
  const eng = useRef({
    rnodes: [] as RNode[],
    cam: { center: 0, pxPerMs: 1e-5 },
    camT: { center: 0, pxPerMs: 1e-5 },
    vscroll: 0, vscrollT: 0,
    hovered: null as RNode | null,
    selectedName: null as string | null,
    picklist: [] as { node: RNode; x: number; y: number; hw: number; hh: number }[],
    stars: [] as { x: number; y: number; s: number; a: number }[],
    W: 1280, H: 200, dpr: 1, minPx: 1e-7, maxPx: 1,
    now: Date.now(), tMin: 0, tMax: 0,
    dragging: false, lastX: 0, lastY: 0, moved: 0, mx: 0, my: 0,
    cardsShown: false, raf: 0,
  }).current;

  // Keep selectedName in the engine in sync for the selection ring.
  eng.selectedName = selected?.name ?? null;

  // (Re)build render nodes when data changes.
  useEffect(() => {
    const rn: RNode[] = nodes
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((n) => ({
        ...n,
        color: COLORS[n.type] ?? "#7f8aa0",
        _x: 0, _vis: false, _targetY: 0, _ty: null,
        _hp: 0, _e: 0, _cardH: 30, _wC: 0, _wE: 0,
      }));
    eng.rnodes = rn;
    eng.now = Date.now();
    if (rn.length) {
      eng.tMin = rn[0]!.time;
      eng.tMax = Math.max(rn[rn.length - 1]!.time, eng.now);
    } else {
      eng.tMin = eng.now - 30 * 86400000;
      eng.tMax = eng.now;
    }
    fit();
    Object.assign(eng.cam, eng.camT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  function fit() {
    const W = eng.W || 1280;
    const span = Math.max(60000, eng.tMax - eng.tMin);
    eng.camT.pxPerMs = (W * 0.82) / span;
    eng.camT.center = (eng.tMin + eng.tMax) / 2;
  }
  function zoomBy(f: number, mx?: number) {
    const W = eng.W || 1280; const px = mx == null ? W / 2 : mx;
    const cursorT = eng.camT.center + (px - W / 2) / eng.camT.pxPerMs;
    eng.camT.pxPerMs = Math.max(eng.minPx, Math.min(eng.maxPx, eng.camT.pxPerMs * f));
    eng.camT.center = cursorT - (px - W / 2) / eng.camT.pxPerMs;
  }

  useEffect(() => {
    const cont = containerRef.current!, c = canvasRef.current!;
    eng.stars = Array.from({ length: variant === "full" ? 150 : 60 }, () => ({
      x: Math.random(), y: Math.random(), s: Math.random() < 0.85 ? 1 : 2, a: 0.12 + Math.random() * 0.5,
    }));

    const resize = () => {
      eng.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = cont.clientWidth || 1280, H = cont.clientHeight || 200;
      eng.W = W; eng.H = H;
      const cw = Math.round(W * eng.dpr), ch = Math.round(H * eng.dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const span = Math.max(60000, eng.tMax - eng.tMin);
      eng.minPx = 1000 / span * 0.45;
      eng.maxPx = W / 86400000;
      eng.camT.pxPerMs = Math.min(eng.camT.pxPerMs, eng.maxPx);
    };
    resize();
    fit(); Object.assign(eng.cam, eng.camT);

    const pick = (mx: number, my: number) => {
      let best: RNode | null = null, bd = Infinity;
      for (const e of eng.picklist) {
        const dx = mx - e.x, dy = my - e.y;
        if (Math.abs(dx) <= e.hw + 4 && Math.abs(dy) <= e.hh + 4) {
          const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e.node; }
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      eng.dragging = true; eng.lastX = e.clientX; eng.lastY = e.clientY; eng.moved = 0;
      c.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const rect = cont.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top; eng.mx = mx; eng.my = my;
      if (eng.dragging) {
        const dx = e.clientX - eng.lastX, dy = e.clientY - eng.lastY;
        eng.lastX = e.clientX; eng.lastY = e.clientY; eng.moved += Math.abs(dx) + Math.abs(dy);
        eng.camT.center -= dx / eng.camT.pxPerMs; eng.cam.center -= dx / eng.cam.pxPerMs;
        eng.vscroll -= dy; eng.vscrollT = eng.vscroll;
        return;
      }
      const hit = pick(mx, my); eng.hovered = hit;
      const tt = tooltipRef.current;
      if (hit && tt) {
        tt.style.opacity = eng.cardsShown ? "0" : "1";
        tt.style.left = mx + "px"; tt.style.top = my + "px";
        tt.textContent = hit.name + "  ·  " + fmtTimeS(hit.time);
        c.style.cursor = "pointer";
      } else if (tt) { tt.style.opacity = "0"; c.style.cursor = eng.dragging ? "grabbing" : "grab"; }
    };
    const onUp = (e: PointerEvent) => {
      if (!eng.dragging) return; eng.dragging = false; c.style.cursor = "grab";
      if (eng.moved < 5) {
        if (variant === "strip") { onExpand?.(); return; }
        const rect = cont.getBoundingClientRect();
        const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          setSelected({
            id: hit.id,
            removable: hit.id.startsWith("doc:") || hit.id.startsWith("task:"),
            name: hit.name, desc: hit.desc ?? null, color: hit.color, typeLabel: LABELS[hit.type] ?? "File",
            ext: (hit.ext || "—").toUpperCase(), size: fmtSize(hit.size),
            time: fmtTimeS(hit.time), date: fmtDate(hit.time),
            batch: hit.batch ? "#" + hit.batch : "—", attached: hit.attached ? "yes" : "—",
            kind: hit.kind, status: hit.status ?? null,
          });
        } else setSelected(null);
      }
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0012), eng.mx); };
    const onLeave = () => { const tt = tooltipRef.current; if (tt) tt.style.opacity = "0"; eng.hovered = null; };

    c.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    c.addEventListener("wheel", onWheel, { passive: false });
    c.addEventListener("pointerleave", onLeave);
    const ro = new ResizeObserver(resize); ro.observe(cont);

    const loop = () => {
      const ctx = c.getContext("2d")!; const W = eng.W, H = eng.H, dpr = eng.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "rgba(150,180,220,1)";
      for (const s of eng.stars) { ctx.globalAlpha = s.a * 0.55; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); }
      ctx.globalAlpha = 1;
      const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.12, W / 2, H * 0.5, H * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(2,4,9,0.6)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      const cam = eng.cam, cm = eng.camT;
      cam.center += (cm.center - cam.center) * 0.16;
      cam.pxPerMs *= Math.pow(cm.pxPerMs / cam.pxPerMs, 0.18);
      eng.vscroll += (eng.vscrollT - eng.vscroll) * 0.16;
      const axisY = H * 0.56 + eng.vscroll;
      const xAt = (t: number) => W / 2 + (t - cam.center) * cam.pxPerMs;

      const ag = ctx.createLinearGradient(0, 0, W, 0);
      ag.addColorStop(0, "rgba(120,160,215,0.05)"); ag.addColorStop(0.5, "rgba(120,160,215,0.4)"); ag.addColorStop(1, "rgba(120,160,215,0.05)");
      ctx.strokeStyle = ag; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(W, axisY); ctx.stroke();

      const step = niceStep(cam.pxPerMs); const S = 1000, M = 60 * S, HH = 60 * M, DAY = 24 * HH;
      const tLeft = cam.center + (0 - W / 2) / cam.pxPerMs, tRight = cam.center + (W - W / 2) / cam.pxPerMs;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      if (step >= 20 * DAY) {
        const dd = new Date(tLeft); dd.setDate(1); dd.setHours(0, 0, 0, 0);
        for (; dd.getTime() < tRight; dd.setMonth(dd.getMonth() + 1)) {
          const x = xAt(dd.getTime()); if (x < -90 || x > W + 90) continue;
          ctx.strokeStyle = "rgba(120,160,215,0.12)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, H - 22); ctx.stroke();
          ctx.strokeStyle = "rgba(150,180,220,0.28)"; ctx.beginPath(); ctx.moveTo(x, axisY - 6); ctx.lineTo(x, axisY + 6); ctx.stroke();
          const lbl = MON[dd.getMonth()]!.toUpperCase() + (dd.getMonth() === 0 ? " '" + String(dd.getFullYear()).slice(2) : "");
          ctx.fillStyle = "#7d8aa2"; ctx.font = "600 11px 'JetBrains Mono', monospace"; ctx.textAlign = "left"; ctx.fillText(lbl, x + 7, axisY + 12);
        }
        ctx.textAlign = "center";
      } else {
        const first = Math.ceil(tLeft / step) * step;
        if (step < DAY) {
          const d0 = new Date(tLeft); d0.setHours(0, 0, 0, 0); let dt = d0.getTime();
          for (; dt < tRight + DAY; dt += DAY) { const x = xAt(dt); if (x < -40 || x > W + 40) continue;
            ctx.strokeStyle = "rgba(120,160,215,0.10)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 22); ctx.lineTo(x, H - 22); ctx.stroke();
            ctx.fillStyle = "#7d8aa2"; ctx.font = "600 11px 'JetBrains Mono', monospace"; ctx.fillText(fmtDate(dt).toUpperCase(), x, axisY + 34); }
        }
        for (let t = first; t <= tRight; t += step) { const x = xAt(t); if (x < -40 || x > W + 40) continue;
          ctx.strokeStyle = "rgba(150,180,220,0.22)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, axisY - 5); ctx.lineTo(x, axisY + 5); ctx.stroke();
          const lbl = step < HH ? fmtTimeS(t) : step < DAY ? fmtTime(t) : fmtDate(t);
          ctx.fillStyle = "#6f7d95"; ctx.font = "400 11px 'JetBrains Mono', monospace"; ctx.fillText(lbl, x, axisY + 12);
        }
      }

      const nx = xAt(eng.now);
      if (nx > -40 && nx < W + 40) {
        ctx.strokeStyle = accent + "55"; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nx, 24); ctx.lineTo(nx, H - 22); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = accent; ctx.font = "600 9.5px 'JetBrains Mono', monospace"; ctx.textAlign = "left"; ctx.fillText("NOW", nx + 5, 26); ctx.textAlign = "center";
      }

      const winMs = W / cam.pxPerMs;
      const TA = Math.max(0, Math.min(1, (6.5 * DAY - winMs) / (6.5 * DAY - 4 * DAY)));
      eng.cardsShown = TA >= 0.5;
      const compactH = 30, expandH = 66, gap = 10, padX = 13, glyphW = 20, gapI = 12, minTextW = 96;
      const measure = (n: RNode) => {
        ctx.font = "500 12px 'JetBrains Mono', monospace"; const nameW = ctx.measureText(n.name).width;
        ctx.font = "400 10.5px 'JetBrains Mono', monospace"; const descW = ctx.measureText(n.desc || "").width;
        ctx.font = "600 10px 'JetBrains Mono', monospace"; const sizeW = ctx.measureText(fmtSize(n.size)).width;
        const clip = n.attached ? 20 : 0;
        return { cW: Math.ceil(padX + glyphW + gapI + nameW + clip + padX),
                 eW: Math.ceil(padX + glyphW + gapI + Math.max(minTextW, nameW, descW, sizeW + clip) + padX) };
      };
      const visIdx: RNode[] = [];
      for (const n of eng.rnodes) { const x = xAt(n.time); n._x = x; if (x < -90 || x > W + 90) { n._vis = false; continue; } n._vis = true; visIdx.push(n); }
      eng.picklist = [];

      if (TA < 0.999) {
        const da = 1 - TA; ctx.save(); ctx.globalCompositeOperation = "lighter";
        for (const n of visIdx) { const hov = eng.hovered === n; const r = hov ? 5 : 2.8;
          ctx.globalAlpha = (hov ? 1 : 0.5) * da; ctx.shadowColor = n.color; ctx.shadowBlur = hov ? 15 : 7; ctx.fillStyle = n.color;
          ctx.beginPath(); ctx.arc(n._x, axisY, r, 0, 7); ctx.fill(); }
        ctx.restore();
        if (TA < 0.5) for (const n of visIdx) eng.picklist.push({ node: n, x: n._x, y: axisY, hw: 5, hh: 9 });
      }

      if (TA > 0.001) {
        const laneH = compactH + 30, firstGap = compactH / 2 + 34;
        const clusters: { items: RNode[]; endX: number }[] = []; let cur: { items: RNode[]; endX: number } | null = null;
        for (const n of visIdx) { const m = measure(n); n._wC = m.cW; n._wE = m.eW; const left = n._x, right = n._x + m.cW + gap;
          if (cur && left <= cur.endX) { cur.items.push(n); cur.endX = Math.max(cur.endX, right); }
          else { cur = { items: [n], endX: right }; clusters.push(cur); } }
        for (const cl of clusters) { const items = cl.items;
          let aboveCount = 0, belowCount = 0; items.forEach((_, i) => (i % 2 === 0 ? aboveCount++ : belowCount++));
          let aRow = 0, bRow = 0;
          items.forEach((n, i) => { if (i % 2 === 0) { const row = aRow++; n._targetY = axisY - (firstGap + (aboveCount - 1 - row) * laneH); }
            else { const row = bRow++; n._targetY = axisY + (firstGap + (belowCount - 1 - row) * laneH); } }); }
        for (const n of visIdx) { const ty = n._targetY; if (n._ty == null) n._ty = ty; n._ty += (ty - n._ty) * 0.22;
          const tgt = eng.hovered === n ? 1 : 0; n._hp += (tgt - n._hp) * 0.25; if (Math.abs(n._hp - tgt) < 0.001) n._hp = tgt;
          const e = Math.max(0, Math.min(1, n._hp)); n._e = e * e * (3 - 2 * e); n._cardH = compactH + (expandH - compactH) * n._e;
          const hh = n._cardH / 2, tk = n._ty;
          ctx.globalAlpha = TA; ctx.strokeStyle = n.color + (eng.hovered === n ? "cc" : "55"); ctx.lineWidth = eng.hovered === n ? 1.4 : 1;
          ctx.beginPath(); ctx.moveTo(n._x, axisY); ctx.lineTo(n._x, tk + (tk < axisY ? hh : -hh)); ctx.stroke();
          ctx.globalAlpha = (eng.hovered === n ? 0.95 : 0.55) * TA; ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n._x, axisY, 2.6, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
        const drawOrder = visIdx.slice().sort((a, b) => (a === eng.hovered ? 1 : 0) - (b === eng.hovered ? 1 : 0));
        for (const n of drawOrder) { const x = n._x, y = n._ty!, hov = eng.hovered === n, e = n._e, hh = n._cardH / 2;
          const w = n._wC + (n._wE - n._wC) * e, L = x, Rt = x + w, top = y - hh, textX = L + padX + glyphW + gapI;
          ctx.save(); ctx.globalAlpha = TA; ctx.shadowColor = n.color; ctx.shadowBlur = hov ? 16 : 8;
          const r = 6;
          ctx.beginPath(); ctx.moveTo(L + r, top); ctx.lineTo(Rt - r, top); ctx.quadraticCurveTo(Rt, top, Rt, top + r);
          ctx.lineTo(Rt, top + 2 * hh - r); ctx.quadraticCurveTo(Rt, top + 2 * hh, Rt - r, top + 2 * hh);
          ctx.lineTo(L + r, top + 2 * hh); ctx.quadraticCurveTo(L, top + 2 * hh, L, top + 2 * hh - r);
          ctx.lineTo(L, top + r); ctx.quadraticCurveTo(L, top, L + r, top); ctx.closePath();
          ctx.fillStyle = "rgba(9,13,22,0.94)"; ctx.fill(); ctx.shadowBlur = 0;
          ctx.lineWidth = hov ? 1.6 : 1.2; ctx.strokeStyle = n.color; ctx.stroke();
          const gw = glyphW, gh = 16 + 8 * e, gx = L + padX, gyc = y - gh / 2, gy = gyc + (top + 13 - gyc) * e, gr = 2 + e, gf = 5 + 2 * e;
          ctx.beginPath(); ctx.moveTo(gx + gr, gy); ctx.lineTo(gx + gw - gf, gy); ctx.lineTo(gx + gw, gy + gf);
          ctx.lineTo(gx + gw, gy + gh - gr); ctx.quadraticCurveTo(gx + gw, gy + gh, gx + gw - gr, gy + gh);
          ctx.lineTo(gx + gr, gy + gh); ctx.quadraticCurveTo(gx, gy + gh, gx, gy + gh - gr);
          ctx.lineTo(gx, gy + gr); ctx.quadraticCurveTo(gx, gy, gx + gr, gy); ctx.closePath();
          ctx.fillStyle = n.color + "2e"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = n.color; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(gx + gw - gf, gy); ctx.lineTo(gx + gw - gf, gy + gf); ctx.lineTo(gx + gw, gy + gf); ctx.closePath(); ctx.fillStyle = n.color + "88"; ctx.fill();
          if (e > 0.25) { ctx.globalAlpha = TA * ((e - 0.25) / 0.75); ctx.fillStyle = n.color; ctx.font = "600 7px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText((n.kind === "task" ? n.type : (n.ext || "•")).toUpperCase().slice(0, 4), gx + gw / 2, gy + gh - 7); ctx.globalAlpha = TA; }
          const nameY = y + 4 + (top + 18 - (y + 4)) * e;
          ctx.fillStyle = hov ? "#eef3fb" : "#dbe3f0"; ctx.font = "500 12px 'JetBrains Mono', monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
          ctx.fillText(n.name, textX, nameY);
          if (e > 0.01) { const descY = top + 36, footerY = top + 53; ctx.globalAlpha = TA * e;
            ctx.fillStyle = "#7c8aa3"; ctx.font = "400 10.5px 'JetBrains Mono', monospace"; ctx.textBaseline = "alphabetic";
            ctx.fillText(n.desc || (n.kind === "task" ? "Action item" : ""), textX, descY);
            ctx.strokeStyle = n.color + "33"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(textX, footerY - 13); ctx.lineTo(Rt - padX, footerY - 13); ctx.stroke();
            ctx.fillStyle = "#aeb9cc"; ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.textBaseline = "middle";
            ctx.fillText(n.kind === "task" ? (n.status || "todo") : fmtSize(n.size), textX, footerY); ctx.globalAlpha = TA; }
          ctx.restore();
          if (eng.selectedName === n.name) { ctx.globalAlpha = TA; ctx.strokeStyle = "#eaf1fb"; ctx.lineWidth = 1.3; ctx.strokeRect(L - 3, top - 3, w + 6, n._cardH + 6); ctx.globalAlpha = 1; }
          if (TA >= 0.5) eng.picklist.push({ node: n, x: L + w / 2, y, hw: w / 2, hh });
        }
      }

      if (rangeRef.current) { const big = winMs > 3 * DAY; const f = (t: number) => (big ? fmtDate(t) : fmtDate(t) + " " + fmtTime(t)); rangeRef.current.textContent = f(tLeft) + "  →  " + f(tRight); }
      if (zoomRef.current) zoomRef.current.textContent = fmtSpan(winMs);
      eng.raf = requestAnimationFrame(loop);
    };
    eng.raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(eng.raf); ro.disconnect();
      c.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      c.removeEventListener("wheel", onWheel);
      c.removeEventListener("pointerleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const full = variant === "full";
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden select-none"
      style={{ background: "radial-gradient(120% 120% at 50% 0%,#0a1120 0%,#04070d 70%)", fontFamily: "'Space Grotesk',sans-serif", color: "#dce3ef" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" style={{ cursor: "grab", touchAction: "none" }} />

      <div ref={tooltipRef} className="pointer-events-none absolute z-40 whitespace-nowrap rounded-md border px-2.5 py-1.5 opacity-0"
        style={{ transform: "translate(-50%,-150%)", background: "rgba(7,11,20,.92)", borderColor: "rgba(120,160,220,.22)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#e6ecf6", transition: "opacity .12s", backdropFilter: "blur(8px)" }} />

      {/* top chrome */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between"
        style={{ padding: full ? "18px 22px" : "10px 14px" }}>
        <div className="pointer-events-auto flex flex-col gap-2" style={{ maxWidth: "62%" }}>
          <div className="flex items-center gap-2.5">
            <div className="relative" style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${accent}`, boxShadow: `0 0 16px ${accent}55` }}>
              <div className="absolute" style={{ inset: 5, borderRadius: 2, background: accent, animation: "atlasPulse 2.6s ease-in-out infinite" }} />
            </div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontWeight: 700, fontSize: full ? 17 : 13, letterSpacing: ".16em" }}>ATLAS</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#5b6a82", letterSpacing: ".05em" }}>
                {full ? `timeline · ${projectName}` : projectName}
              </span>
            </div>
          </div>
          {full && (
            <div className="flex flex-col gap-0.5" style={{ fontFamily: "'JetBrains Mono',monospace" }}>
              <div style={{ fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82" }}>VISIBLE&nbsp;WINDOW</div>
              <div ref={rangeRef} style={{ fontSize: 13, color: "#c8d2e4", letterSpacing: ".02em" }}>—</div>
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2.5">
          <div className="flex gap-1 p-1" style={{ border: "1px solid rgba(120,160,220,.16)", borderRadius: 11, background: "rgba(10,16,28,.6)", backdropFilter: "blur(8px)" }}>
            <button onClick={() => zoomBy(1 / 1.6)} title="Zoom out" style={btn}>−</button>
            <button onClick={() => fit()} title="Fit all" style={{ ...btn, width: "auto", padding: "0 11px", font: "600 11px 'Space Grotesk',sans-serif", letterSpacing: ".08em", color: "#c4cee0" }}>FIT</button>
            <button onClick={() => zoomBy(1.6)} title="Zoom in" style={btn}>+</button>
            {full ? (
              <button onClick={onClose} title="Close" style={{ ...btn, color: "#c4cee0" }}>✕</button>
            ) : (
              <button onClick={onExpand} title="Expand" style={{ ...btn, color: "#c4cee0", fontSize: 14 }}>⤢</button>
            )}
          </div>
          {full && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#6b7a92", letterSpacing: ".04em", textAlign: "right" }}>
              <span style={{ color: accent }}>{nodes.length}</span> items <span style={{ color: "#3c4a60", margin: "0 5px" }}>·</span>
              <span ref={zoomRef} style={{ color: "#aab6c8" }}>—</span>&nbsp;span
            </div>
          )}
        </div>
      </div>

      {full && (
        <>
          <div className="absolute z-20" style={{ right: 22, bottom: 22, padding: "13px 15px", border: "1px solid rgba(120,160,220,.14)", borderRadius: 12, background: "rgba(8,12,21,.72)", backdropFilter: "blur(10px)", fontFamily: "'JetBrains Mono',monospace" }}>
            <div style={{ fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82", marginBottom: 9 }}>ITEM TYPES</div>
            <div className="grid grid-cols-2" style={{ gap: "6px 16px", fontSize: 11, color: "#aab6c8" }}>
              {LEGEND.map(([label, color]) => (
                <div key={label} className="flex items-center gap-2">
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: color, boxShadow: `0 0 7px ${color}99` }} />{label}
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute z-[15] text-center" style={{ left: "50%", bottom: 22, transform: "translateX(-50%)", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#54627a", letterSpacing: ".06em" }}>
            drag <span style={{ color: "#8493ab" }}>pan time</span> · scroll <span style={{ color: "#8493ab" }}>zoom</span> · click <span style={{ color: "#8493ab" }}>an item</span>
          </div>
          {selected && (
            <div className="absolute z-[25]" style={{ right: 22, top: 84, width: 268, padding: 18, border: "1px solid rgba(120,160,220,.18)", borderRadius: 14, background: "rgba(8,12,21,.82)", backdropFilter: "blur(12px)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
              <div className="mb-3.5 flex items-start justify-between">
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: ".18em", color: "#5b6a82" }}>SELECTED</span>
                <button onClick={() => setSelected(null)} style={{ border: "none", background: "none", color: "#5b6a82", cursor: "pointer", fontSize: 15 }}>✕</button>
              </div>
              <div className="mb-4 flex items-center gap-2.5">
                <span style={{ width: 13, height: 13, borderRadius: 4, background: selected.color, boxShadow: `0 0 12px ${selected.color}` }} />
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: "#eef2f8", wordBreak: "break-all" }}>{selected.name}</span>
              </div>
              {selected.desc && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, lineHeight: 1.5, color: "#9aa7bd", marginBottom: 15 }}>{selected.desc}</div>}
              <div className="flex flex-col gap-2.5" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                <Row k="type" v={selected.typeLabel} vColor={selected.color} />
                {selected.kind === "file" ? <Row k="ext" v={selected.ext} /> : <Row k="status" v={selected.status ?? "—"} />}
                {selected.kind === "file" && <Row k="size" v={selected.size} />}
                <Row k="attachment" v={selected.attached} />
                <div style={{ borderTop: "1px solid rgba(120,160,220,.12)", paddingTop: 11 }}><Row k="when" v={selected.time} vColor={accent} /></div>
                <Row k="date" v={selected.date} />
                {selected.kind === "file" && <Row k="commit" v={selected.batch} vColor="#9fb0ca" />}
              </div>
              {onRemove && selected.removable && (
                <button
                  onClick={() => {
                    onRemove(selected.id);
                    setSelected(null);
                  }}
                  className="mt-4 w-full rounded-lg py-2 text-xs font-semibold"
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    letterSpacing: ".04em",
                    color: "#ff8a8a",
                    border: "1px solid rgba(255,120,120,.35)",
                    background: "rgba(255,90,90,.08)",
                  }}
                  title="Delete this item from the timeline"
                >
                  Remove from timeline
                </button>
              )}
            </div>
          )}
        </>
      )}
      <style>{"@keyframes atlasPulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
    </div>
  );
}

const btn: CSSProperties = { width: 32, height: 28, border: "none", borderRadius: 8, background: "transparent", color: "#9aa7bd", cursor: "pointer", fontSize: 16, lineHeight: 1 };

function Row({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "#5b6a82" }}>{k}</span>
      <span style={{ color: vColor ?? "#c4cee0", letterSpacing: ".02em" }}>{v}</span>
    </div>
  );
}

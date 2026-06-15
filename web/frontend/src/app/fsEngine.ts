// ATLAS filesystem engine — a faithful port of the design prototype's logic
// class (Atlas Filesystem.dc.html). Framework-agnostic: it owns a <canvas>,
// the 3D projection, layouts (TREE org-chart + CONSTELLATION sphere), semantic
// cursor-directed zoom, and hit-testing. It talks to React only through the
// `onState` callback (mode / breadcrumb / selected file). All per-frame state
// is mutated on plain objects — kept out of React to avoid re-render churn.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Mode = "tree" | "orbit";
export interface Crumb {
  name: string;
  id: number;
}
export interface SelectedFile {
  name: string;
  color: string;
  typeLabel: string;
  ext: string;
  parent: string;
  path: string;
}
export interface UiState {
  mode: Mode;
  crumbs: Crumb[];
  selected: SelectedFile | null;
}
export interface RawNode {
  name: string;
  children?: RawNode[] | null;
}

const COLORS: Record<string, string> = {
  folder: "#ffc14d", code: "#54c7ff", style: "#b388ff", markup: "#ff6e8a",
  data: "#5ce0a0", doc: "#9aa7bd", image: "#ff9e5e", config: "#6b7689", other: "#7f8aa0",
};
const LABELS: Record<string, string> = {
  folder: "Folder", code: "Source", style: "Stylesheet", markup: "Markup",
  data: "Data", doc: "Document", image: "Asset", config: "Config", other: "File",
};

function typeFor(name: string): string {
  if (name.charAt(0) === ".") {
    const e0 = name.includes(".", 1) ? name.split(".").pop()!.toLowerCase() : "";
    if (["js", "ts", "cjs", "mjs"].includes(e0)) return "code";
    if (["json", "yml", "yaml"].includes(e0)) return "data";
    return "config";
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "sh", "go", "rs", "py"].includes(ext)) return "code";
  if (["css", "scss", "sass", "less", "pcss"].includes(ext)) return "style";
  if (["html", "htm"].includes(ext)) return "markup";
  if (["json", "yaml", "yml", "toml", "lock", "env", "tf"].includes(ext)) return "data";
  if (["md", "mdx", "txt", "pdf"].includes(ext)) return "doc";
  if (["svg", "png", "jpg", "jpeg", "gif", "webp", "ico"].includes(ext)) return "image";
  return "other";
}

export class FsEngine {
  private accent: string;
  private onState: (p: Partial<UiState>) => void;

  private container!: HTMLDivElement;
  private scene!: HTMLCanvasElement;
  private mini!: HTMLCanvasElement;
  private tooltip!: HTMLDivElement;

  private nodes: any[] = [];
  private byId: Record<number, any> = {};
  private idc = 0;
  fileCount = 0;
  folderCount = 0;
  private root: any = null;
  private focus: any = null;
  private mode: Mode = "tree";

  private cam: any = null;
  private camT: any = null;
  private right: any = null;
  private up: any = null;
  private hovered: any = null;
  private picklist: any[] = [];
  private stars: { x: number; y: number; s: number; a: number }[] = [];
  private selectedName: string | null = null;

  private W = 1280;
  private H = 800;
  private dpr = 1;
  private mdpr = 1;
  private _mx: number | null = null;
  private _my: number | null = null;
  private dragging = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;
  private _activeList: any[] = [];
  private _FC = 0;
  private _COL = 176;
  private _ancNode: any = null;
  private _ancPrevX: number | null = null;
  private raf = 0;
  private running = false;
  private ro: ResizeObserver | null = null;

  constructor(opts: { accent?: string; onState: (p: Partial<UiState>) => void }) {
    this.accent = opts.accent || "#54c7ff";
    this.onState = opts.onState;
  }

  // ================= DATA =================
  private index(root: RawNode) {
    this.nodes = []; this.byId = {}; this.idc = 0; this.fileCount = 0; this.folderCount = 0;
    const walk = (node: any, parent: any, depth: number, ancestors: any[]) => {
      node.id = this.idc++; node.parent = parent; node.depth = depth; node.ancestors = ancestors;
      node.ancestorsSet = new Set(ancestors); node.path = ancestors.concat(node);
      node.isFolder = Array.isArray(node.children);
      node.ext = node.isFolder ? "" : (node.name.includes(".") && node.name.charAt(0) !== "."
        ? node.name.split(".").pop().toLowerCase()
        : (node.name.charAt(0) === "." ? node.name.slice(1) : ""));
      node.type = node.isFolder ? "folder" : typeFor(node.name);
      node.color = COLORS[node.type];
      this.nodes.push(node); this.byId[node.id] = node;
      if (node.isFolder) {
        this.folderCount++;
        node.children.sort((a: any, b: any) => {
          const fa = Array.isArray(a.children), fb = Array.isArray(b.children);
          if (fa !== fb) return fa ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        node.children.forEach((c: any) => walk(c, node, depth + 1, node.path));
      } else { this.fileCount++; }
    };
    walk(root, null, 0, []);
    this.root = root;
  }

  // ================= LAYOUTS =================
  private layoutTreeFocus(focus: any) {
    const COL = 176, ROW = 138, FILEROW = 52, MAXD = 8;
    const prev = this._activeList || [];
    for (const n of prev) { n._active = false; n._activePrev = true; }
    this._activeList = [];
    const reg = (node: any, df: number) => {
      node._df = df;
      node._relTag = df === 0 ? "focus" : df === 1 ? "child" : df === 2 ? "grand" : "deep";
      node._active = true; this._activeList.push(node);
    };
    const colRef = { c: 0 };
    const place = (node: any, depth: number) => {
      reg(node, depth); node._depthL = depth; node._stack = 0;
      const open = depth === 0 || node._open > 0.5;
      if (node.isFolder && node.children.length && open && depth < MAXD) {
        const folders = node.children.filter((k: any) => k.isFolder);
        const files = node.children.filter((k: any) => !k.isFolder);
        const centers: number[] = [], mins: number[] = [], maxs: number[] = [];
        for (const k of folders) { place(k, depth + 1); centers.push(k._col); mins.push(k._colMin); maxs.push(k._colMax); }
        if (files.length) {
          const fcol = colRef.c; colRef.c += 1; centers.push(fcol); mins.push(fcol); maxs.push(fcol);
          files.forEach((k: any, i: number) => { reg(k, depth + 1); k._depthL = depth; k._stack = i + 1; k._col = fcol; k._colMin = fcol; k._colMax = fcol; });
        }
        if (centers.length) { node._col = (Math.min(...centers) + Math.max(...centers)) / 2; node._colMin = Math.min(...mins); node._colMax = Math.max(...maxs); }
        else { node._col = colRef.c++; node._colMin = node._colMax = node._col; }
      } else { node._col = colRef.c; colRef.c += 1; node._colMin = node._colMax = node._col; }
    };
    place(focus, 0);
    const fc = focus._col; this._FC = fc; this._COL = COL;
    for (const n of this._activeList) {
      const bx = (fc - n._col) * COL, by = -n._depthL * ROW;
      n.tpos = n._stack ? { x: bx - 34, y: by - n._stack * FILEROW, z: 0 } : { x: bx, y: by, z: 0 };
      if (!n._activePrev) { const par = n.parent; if (par && par.x != null) { n.x = par.x; n.y = par.y; n.z = par.z; } }
    }
    for (const n of prev) n._activePrev = false;
  }

  private updateOpenness() {
    const W = this.W || 1280, H = this.H || 800, focal = H * 0.95;
    const dist = this.cam ? this.cam.dist : 1200, scale = focal / dist;
    const COL = this._COL || 176, fc = this._FC || 0;
    const mx = this._mx == null ? W / 2 : this._mx;
    const cursorWX = (this.cam ? this.cam.tx : 0) - (mx - W / 2) * dist / focal;
    for (const n of this.nodes) {
      if (!n.isFolder) { n._open = 0; continue; }
      let t: number;
      if (n === this.focus) t = 1;
      else {
        const par = n.parent;
        const parentOpen = par === this.focus || (par && (par._open || 0) > 0.6 && par._active);
        const depth = n._df || 1, cur = n._open || 0;
        const xA = (fc - (n._colMax != null ? n._colMax : n._col)) * COL, xB = (fc - (n._colMin != null ? n._colMin : n._col)) * COL;
        const pad = COL * (cur > 0.5 ? 1.1 : 0.55);
        const inCol = cursorWX > xA - pad && cursorWX < xB + pad;
        const thr = 0.62 + (depth - 1) * 0.45;
        const want = cur > 0.5 ? scale > thr * 0.78 : scale > thr;
        t = parentOpen && n._active && inCol && want ? 1 : 0;
      }
      n._open = (n._open || 0) + (t - (n._open || 0)) * 0.09;
    }
  }

  private fib(i: number, n: number) {
    const off = 2 / n, y = i * off - 1 + off / 2, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = i * 2.399963;
    return { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
  }
  private layoutOrbit(node: any, fromDir: any, depth: number) {
    if (!node.opos) node.opos = { x: 0, y: 0, z: 0 };
    if (!node.isFolder || !node.children.length) return;
    const ch = node.children, n = ch.length;
    const R = Math.max(95, 280 - depth * 34);
    for (let i = 0; i < n; i++) {
      let d = this.fib(i, n);
      if (fromDir) {
        d = { x: d.x - fromDir.x * 0.55, y: d.y - fromDir.y * 0.55, z: d.z - fromDir.z * 0.55 };
        const l = Math.hypot(d.x, d.y, d.z) || 1; d = { x: d.x / l, y: d.y / l, z: d.z / l };
      }
      ch[i].opos = { x: node.opos.x + d.x * R, y: node.opos.y + d.y * R, z: node.opos.z + d.z * R };
      this.layoutOrbit(ch[i], d, depth + 1);
    }
  }
  private computeLayouts() {
    this.root.opos = { x: 0, y: 0, z: 0 }; this.layoutOrbit(this.root, null, 0);
    this.focus = this.focus || this.root; this.layoutTreeFocus(this.focus);
    const tree = this.mode === "tree";
    this.nodes.forEach((n) => { const p = (tree ? n.tpos : n.opos) || n.opos; n.x = p.x; n.y = p.y; n.z = p.z; });
  }

  // ================= CAMERA / NAV =================
  private centroid(node: any) {
    const key = this.mode === "tree" ? "tpos" : "opos"; let sx = 0, sy = 0, sz = 0, c = 0;
    const add = (nd: any, w: number) => { const p = nd[key]; sx += p.x * w; sy += p.y * w; sz += p.z * w; c += w; };
    add(node, 3); if (node.isFolder) node.children.forEach((ch: any) => add(ch, 1));
    return { x: sx / c, y: sy / c, z: sz / c };
  }
  private frameFocus(instant: boolean) {
    const f = this.focus, mode = this.mode;
    if (mode === "tree") {
      const p = f.tpos || { x: 0, y: 0, z: 0 };
      this.camT.tx = p.x; this.camT.ty = p.y - 300; this.camT.tz = 0;
      this.camT.yaw = Math.PI; this.camT.pitch = 0.0; this.camT.dist = 1000;
    } else {
      const ctr = this.centroid(f); let maxd = 130;
      if (f.isFolder) for (const ch of f.children) { const q = ch.opos; const d = Math.hypot(q.x - ctr.x, q.y - ctr.y, q.z - ctr.z); if (d > maxd) maxd = d; }
      const fit = Math.max(360, Math.min(2800, maxd * 2.35 + 120));
      this.camT.tx = ctr.x; this.camT.ty = ctr.y; this.camT.tz = ctr.z; this.camT.yaw = 0.7; this.camT.pitch = 0.34; this.camT.dist = fit;
    }
    if (instant) Object.assign(this.cam, this.camT);
  }
  private setCrumbs() {
    this.onState({ crumbs: this.focus.path.map((p: any) => ({ name: p.name, id: p.id })) });
  }
  goToFolder(node: any) {
    this.focus = node; this.layoutTreeFocus(node); this.frameFocus(false); this.setCrumbs();
    this.selectedName = null; this.onState({ selected: null });
  }
  goToId(id: number) { const n = this.byId[id]; if (n && n.isFolder) this.goToFolder(n); }
  goUp() { if (this.focus && this.focus.parent) this.goToFolder(this.focus.parent); }
  private select(node: any) {
    this.selectedName = node.name;
    this.onState({
      selected: {
        name: node.name, color: node.color, typeLabel: LABELS[node.type] ?? "File",
        ext: (node.ext || "—").toUpperCase(), parent: node.parent ? node.parent.name : "—",
        path: "/" + node.path.map((p: any) => p.name).join("/"),
      },
    });
  }
  closeDetail() { this.selectedName = null; this.onState({ selected: null }); }
  setMode(m: Mode) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === "tree") this.layoutTreeFocus(this.focus);
    this.onState({ mode: m });
    this.frameFocus(false);
  }

  private vis(n: any): string | false {
    if (this.mode !== "tree") {
      const f = this.focus; if (n === f) return "focus"; if (f.ancestorsSet.has(n)) return "anc";
      if (n.ancestorsSet.has(f)) { const d = n.depth - f.depth; if (d === 1) return "child"; if (d === 2) return "grand"; }
      return false;
    }
    return n._active ? n._relTag : false;
  }

  // ================= MOUNT =================
  mount(
    els: { container: HTMLDivElement; scene: HTMLCanvasElement; mini: HTMLCanvasElement; tooltip: HTMLDivElement },
    tree: RawNode,
    startMode: Mode,
  ) {
    this.container = els.container; this.scene = els.scene; this.mini = els.mini; this.tooltip = els.tooltip;
    this.mode = startMode === "orbit" ? "orbit" : "tree";
    this.index(tree); this.focus = this.root; this.computeLayouts();
    this.cam = { yaw: Math.PI + 0.26, pitch: 0.4, dist: 560, tx: 0, ty: 0, tz: 210 };
    this.camT = Object.assign({}, this.cam);
    this.frameFocus(true);
    this.stars = Array.from({ length: 150 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() < 0.85 ? 1 : 2, a: 0.12 + Math.random() * 0.5 }));
    this.setCrumbs(); this.onState({ mode: this.mode });
    this.scene.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    this.scene.addEventListener("wheel", this.onWheel, { passive: false });
    this.scene.addEventListener("pointerleave", this.onLeave);
    this.scene.addEventListener("contextmenu", this.onCtx);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.container);
    this.running = true; this.loop();
  }
  unmount() {
    this.running = false; cancelAnimationFrame(this.raf); this.ro?.disconnect();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    if (this.scene) {
      this.scene.removeEventListener("pointerdown", this.onDown);
      this.scene.removeEventListener("wheel", this.onWheel);
      this.scene.removeEventListener("pointerleave", this.onLeave);
      this.scene.removeEventListener("contextmenu", this.onCtx);
    }
  }

  private resize = () => {
    const cont = this.container, c = this.scene; if (!cont || !c) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cont.clientWidth || window.innerWidth || 1280, H = cont.clientHeight || window.innerHeight || 800;
    this.W = W; this.H = H;
    const cw = Math.round(W * this.dpr), ch = Math.round(H * this.dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const m = this.mini;
    if (m) { this.mdpr = this.dpr; const mw = Math.round(188 * this.dpr), mh = Math.round(118 * this.dpr); if (m.width !== mw) { m.width = mw; m.height = mh; } }
  };

  // ================= INTERACTION =================
  private onCtx = (e: Event) => e.preventDefault();
  private onDown = (e: PointerEvent) => {
    this.dragging = true; this.panning = e.shiftKey || e.button === 1 || e.button === 2;
    this.lastX = e.clientX; this.lastY = e.clientY; this.moved = 0; this.scene.style.cursor = "grabbing";
  };
  private onMove = (e: PointerEvent) => {
    const cont = this.container; if (!cont) return; const rect = cont.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top; this._mx = mx; this._my = my;
    if (this.dragging) {
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      const panMode = this.mode === "tree" || this.panning;
      if (panMode && this.right && this.up) {
        const k = this.camT.dist * 0.0017;
        this.camT.tx -= (this.right.x * dx - this.up.x * dy) * k;
        this.camT.ty -= (this.right.y * dx - this.up.y * dy) * k;
        this.camT.tz -= (this.right.z * dx - this.up.z * dy) * k;
      } else { this.camT.yaw -= dx * 0.005; this.camT.pitch = Math.max(-1.35, Math.min(1.35, this.camT.pitch + dy * 0.005)); }
      return;
    }
    const hit = this.pick(mx, my); this.hovered = hit; const tt = this.tooltip;
    if (hit && tt) {
      tt.style.opacity = "1"; tt.style.left = mx + "px"; tt.style.top = my + "px";
      tt.textContent = hit.isFolder ? `${hit.name}  ·  ${hit.children.length} items` : `${hit.name}  ·  ${(hit.ext || "file").toUpperCase()}`;
      this.scene.style.cursor = "pointer";
    } else if (tt) { tt.style.opacity = "0"; this.scene.style.cursor = this.dragging ? "grabbing" : "grab"; }
  };
  private onUp = (e: PointerEvent) => {
    if (!this.dragging) return; this.dragging = false; this.scene.style.cursor = "grab";
    if (this.moved < 5) {
      const rect = this.container.getBoundingClientRect();
      const hit = this.pick(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) { if (hit.isFolder) this.goToFolder(hit); else this.select(hit); }
    }
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault(); const W = this.W, H = this.H; if (!W) return;
    const d = this.camT.dist; const nd = Math.max(120, Math.min(3000, d * Math.exp(e.deltaY * 0.0009)));
    const r = this.right, u = this.up;
    if (r && u) {
      const focal = H * 0.95; const mx = this._mx == null ? W / 2 : this._mx, my = this._my == null ? H / 2 : this._my;
      const ax = (mx - W / 2) / focal, ay = -(my - H / 2) / focal, k = d - nd;
      this.camT.tx += (r.x * ax + u.x * ay) * k; this.camT.ty += (r.y * ax + u.y * ay) * k; this.camT.tz += (r.z * ax + u.z * ay) * k;
    }
    this.camT.dist = nd;
  };
  private onLeave = () => { if (this.tooltip) this.tooltip.style.opacity = "0"; this.hovered = null; };
  private pick(mx: number, my: number) {
    let best: any = null, bz = Infinity;
    for (const e of this.picklist) {
      const dx = mx - e.x, dy = my - e.y;
      const hit = Math.max(e.r + (e.node.isFolder ? 15 : 11), 13);
      const inDot = dx * dx + dy * dy <= hit * hit;
      const inLabel = e.lw && mx >= e.x + e.r + 2 && mx <= e.x + e.r + 10 + e.lw && Math.abs(my - e.y) <= e.lh;
      if ((inDot || inLabel) && e.zc < bz) { best = e.node; bz = e.zc; }
    }
    return best;
  }

  // ================= RENDER LOOP =================
  private loop = () => {
    if (!this.running) return;
    const cont = this.container; if (cont) { const cw = cont.clientWidth, chh = cont.clientHeight; if (!this.W || (cw > 0 && (cw !== this.W || chh !== this.H))) this.resize(); }
    const c = this.scene; if (!c) { this.raf = requestAnimationFrame(this.loop); return; }
    const ctx = c.getContext("2d")!; const W = this.W, H = this.H, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(150,180,220,1)"; for (const s of this.stars) { ctx.globalAlpha = s.a * 0.6; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); } ctx.globalAlpha = 1;
    const vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.15, W / 2, H * 0.5, H * 0.95); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(2,4,9,0.6)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    const mode = this.mode;
    if (mode === "tree") { this.updateOpenness(); this.layoutTreeFocus(this.focus); }
    for (const n of this.nodes) { const p = (mode === "tree" ? n.tpos : n.opos) || n.opos; n.x += (p.x - n.x) * 0.07; n.y += (p.y - n.y) * 0.07; n.z += (p.z - n.z) * 0.07; }
    if (mode === "tree") {
      const anc = this.hovered && this.hovered._active ? this.hovered : null;
      if (anc) {
        if (anc !== this._ancNode) { this._ancNode = anc; this._ancPrevX = anc.x; }
        else if (this._ancPrevX != null) { const d = anc.x - this._ancPrevX; this.camT.tx += d; this.cam.tx += d; }
        this._ancPrevX = anc.x;
      } else this._ancNode = null;
    }
    const cam = this.cam, cm = this.camT;
    cam.yaw += (cm.yaw - cam.yaw) * 0.1; cam.pitch += (cm.pitch - cam.pitch) * 0.1; cam.dist += (cm.dist - cam.dist) * 0.09;
    cam.tx += (cm.tx - cam.tx) * 0.1; cam.ty += (cm.ty - cam.ty) * 0.1; cam.tz += (cm.tz - cam.tz) * 0.1;

    const cx = cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw);
    const cy = cam.ty + cam.dist * Math.sin(cam.pitch);
    const cz = cam.tz + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
    let fx = cam.tx - cx, fy = cam.ty - cy, fz = cam.tz - cz; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, ry = 0, rz = fx; const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    this.right = { x: rx, y: ry, z: rz }; this.up = { x: ux, y: uy, z: uz };
    const focal = H * 0.95;
    const proj = (p: any) => { const ax = p.x - cx, ay = p.y - cy, az = p.z - cz; const zc = ax * fx + ay * fy + az * fz; if (zc < 2) return null; const xc = ax * rx + ay * ry + az * rz, yc = ax * ux + ay * uy + az * uz; return { x: W / 2 + (xc / zc) * focal, y: H / 2 - (yc / zc) * focal, zc, scale: focal / zc }; };

    const vis: any[] = []; this.picklist = [];
    for (const n of this.nodes) {
      const rel = this.vis(n); if (!rel) { n._lastScale = 0; continue; }
      const s = proj(n); if (!s) { n._lastScale = 0; continue; }
      n._s = s; n._rel = rel; n._lastScale = s.scale; vis.push(n); n._pe = null;
      const r = n.isFolder ? Math.max(3, Math.min(20, s.scale * 7)) : Math.max(2, Math.min(11, s.scale * 4.6));
      const pe = { node: n, x: s.x, y: s.y, r, zc: s.zc, lw: 0, lh: 0 }; this.picklist.push(pe); n._pe = pe;
    }
    const alphaOf: Record<string, number> = { focus: 1, child: 0.95, grand: 0.72, deep: 0.52, anc: 0.32 };
    ctx.lineWidth = 1;
    for (const n of vis) {
      const p = n.parent; if (!p || !p._s) continue; if (!this.vis(p)) continue;
      const a = Math.min(alphaOf[n._rel] || 0.3, alphaOf[p._rel] || 0.3);
      ctx.strokeStyle = "rgba(120,160,215," + a * 0.34 + ")"; ctx.lineWidth = Math.max(0.4, Math.min(2.4, n._s.scale * 1.1));
      ctx.beginPath(); ctx.moveTo(p._s.x, p._s.y); ctx.lineTo(n._s.x, n._s.y); ctx.stroke();
    }
    vis.sort((a, b) => b._s.zc - a._s.zc);
    ctx.textBaseline = "middle";
    for (const n of vis) {
      const s = n._s, rel = n._rel, a = alphaOf[rel] || 0.3; const isF = n.isFolder; const hov = this.hovered === n;
      const r = isF ? Math.max(3, Math.min(22, s.scale * 7)) : Math.max(2, Math.min(11, s.scale * 4.6)); n._r = r;
      ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = n.color; ctx.shadowBlur = (isF ? 16 : 9) * (rel === "grand" ? 0.5 : 1);
      if (isF) {
        ctx.fillStyle = "rgba(8,12,20,0.9)"; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.16); ctx.strokeStyle = n.color; ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.42, 0, 7); ctx.fill();
      } else { ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill(); }
      ctx.restore();
      if (hov) { ctx.save(); ctx.globalAlpha = 0.95; ctx.strokeStyle = "#eaf1fb"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(s.x, s.y, r + 5, 0, 7); ctx.stroke(); ctx.restore(); }
      if (n._pe) { n._pe.lw = 0; n._pe.lh = 0; }
    }
    const cands: any[] = [];
    for (const n of vis) {
      const s = n._s, rel = n._rel, isF = n.isFolder, hov = this.hovered === n;
      const eligible = hov || rel === "focus" || (isF && (rel === "child" || rel === "focus" || s.scale > 0.5)) || s.scale > 0.42;
      if (!eligible) continue;
      const prio = hov ? 1e6 : rel === "focus" ? 9e5 : (isF ? 4e5 : 0) + s.scale * 1000;
      cands.push({ n, s, rel, isF, hov, prio });
    }
    cands.sort((a, b) => b.prio - a.prio);
    const drawn: any[] = [];
    const hits = (b: any) => { for (const d of drawn) { if (b.x < d.x + d.w && b.x + b.w > d.x && b.y < d.y + d.h && b.y + b.h > d.y) return true; } return false; };
    for (const cd of cands) {
      const { n, s, rel, isF, hov } = cd; const r = n._r || 4;
      const zf = Math.max(1, Math.min(1.75, s.scale / 0.7));
      const fs = Math.max(9, Math.min(25, (isF ? (rel === "focus" ? 15 : 12) : 11) * zf));
      ctx.font = (isF ? "600 " : "400 ") + fs + "px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(n.name).width; const lx = s.x + r + 6, ly = s.y;
      const box = { x: lx - 4, y: ly - fs * 0.72, w: tw + 9, h: fs * 1.44 };
      const force = hov || rel === "focus";
      if (!force && hits(box)) continue;
      drawn.push(box);
      if (n._pe) { n._pe.lw = tw + 9; n._pe.lh = Math.max(10, fs * 0.78); }
      ctx.globalAlpha = hov ? 1 : rel === "anc" ? 0.42 : 0.94;
      ctx.fillStyle = "rgba(6,10,18,0.66)"; ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = isF ? "#eef2f8" : n.color; ctx.fillText(n.name, lx, ly + 0.5); ctx.globalAlpha = 1;
      if (this.selectedName === n.name && !isF) { ctx.strokeStyle = "#eaf1fb"; ctx.lineWidth = 1; ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2); }
    }
    this.drawMini(vis, { cx, cz }, { fx, fz }); this.raf = requestAnimationFrame(this.loop);
  };

  private drawMini(vis: any[], camp: { cx: number; cz: number }, fwd: { fx: number; fz: number }) {
    const m = this.mini; if (!m) return; const ctx = m.getContext("2d")!; const d = this.mdpr || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0); const W = 188, H = 118; ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(6,11,20,0.6)"; ctx.fillRect(0, 0, W, H);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const n of vis) { const X = n.x, Z = n.z; if (X < minX) minX = X; if (X > maxX) maxX = X; if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z; }
    if (!isFinite(minX)) return;
    minX = Math.min(minX, camp.cx); maxX = Math.max(maxX, camp.cx); minZ = Math.min(minZ, camp.cz); maxZ = Math.max(maxZ, camp.cz);
    const pad = 14; const sx = maxX - minX || 1, sz = maxZ - minZ || 1; const sc = Math.min((W - pad * 2) / sx, (H - pad * 2) / sz);
    const ox = (W - sx * sc) / 2 - minX * sc, oz = (H - sz * sc) / 2 - minZ * sc;
    const mapx = (X: number) => ox + X * sc, mapz = (Z: number) => oz + Z * sc;
    for (const n of vis) { const p = n.parent; if (!p || vis.indexOf(p) < 0) continue; ctx.strokeStyle = "rgba(120,160,215,0.18)"; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(mapx(p.x), mapz(p.z)); ctx.lineTo(mapx(n.x), mapz(n.z)); ctx.stroke(); }
    for (const n of vis) { ctx.fillStyle = n.color; ctx.globalAlpha = n._rel === "anc" ? 0.4 : 0.9; ctx.beginPath(); ctx.arc(mapx(n.x), mapz(n.z), n.isFolder ? 2.4 : 1.4, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    const cmx = mapx(camp.cx), cmz = mapz(camp.cz); const fl = Math.hypot(fwd.fx, fwd.fz) || 1; const dx = fwd.fx / fl, dz = fwd.fz / fl;
    ctx.fillStyle = this.accent; ctx.beginPath(); const ang = Math.atan2(dz, dx); const sz2 = 5;
    ctx.moveTo(cmx + Math.cos(ang) * sz2, cmz + Math.sin(ang) * sz2);
    ctx.lineTo(cmx + Math.cos(ang + 2.5) * sz2, cmz + Math.sin(ang + 2.5) * sz2);
    ctx.lineTo(cmx + Math.cos(ang - 2.5) * sz2, cmz + Math.sin(ang - 2.5) * sz2);
    ctx.closePath(); ctx.fill();
  }
}

export { COLORS as FS_COLORS };

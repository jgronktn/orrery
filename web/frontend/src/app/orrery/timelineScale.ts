// Pure helpers for the horizontal activity timeline: tick scale/spacing, label
// formatting, and per-type color/label. Ported from the old canvas plot
// (TimelinePlot.tsx) but re-themed for warm paper — no canvas, no rendering.
import type { TimelineNode } from "../../api/client";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

// Candidate tick intervals (1s … ~5y). niceStep picks the smallest that gives
// at least ~targetPx between ticks at the current zoom. The large entries
// (months/years, approximated) keep labels from crowding when zoomed far out.
export const SCALE = [
  S, 2 * S, 5 * S, 10 * S, 15 * S, 30 * S,
  M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M,
  H, 2 * H, 3 * H, 6 * H, 12 * H,
  D, 2 * D, 7 * D, 14 * D, 30 * D,
  60 * D, 90 * D, 180 * D, 365 * D, 730 * D, 1825 * D,
];

/** The largest tick interval — used to floor zoom-out so ticks never crowd. */
export const MAX_STEP = SCALE[SCALE.length - 1]!;

export function niceStep(pxPerMs: number, targetPx = 150): number {
  const want = targetPx / pxPerMs;
  for (const s of SCALE) if (s >= want) return s;
  return SCALE[SCALE.length - 1]!;
}

const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const pad = (n: number) => (n < 10 ? "0" + n : "" + n);

// The timeline is rendered in UTC: the backend dates day-granular items (due
// dates, drops) at noon UTC, so UTC keeps a day centered on 12:00 with midnight
// at each edge — regardless of the viewer's local offset.
export const fmtTime = (t: number) => {
  const d = new Date(t);
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
};
export const fmtClock = (t: number) => {
  const d = new Date(t);
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
};
export const fmtDate = (t: number) => {
  const d = new Date(t);
  return MON[d.getUTCMonth()] + " " + d.getUTCDate();
};
export const fmtDateY = (t: number) => {
  const d = new Date(t);
  return MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
};

/** A tick label appropriate to the current step size (time → day → month → year). */
export function fmtTick(t: number, step: number): string {
  const d = new Date(t);
  if (step >= 330 * D) return "" + d.getUTCFullYear();
  if (step >= 28 * D) return MON[d.getUTCMonth()] + " " + d.getUTCFullYear();
  if (step >= D) return MON[d.getUTCMonth()] + " " + d.getUTCDate();
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}

// ── Type → color / label (warm-paper muted palette) ─────────────────
export const TYPE_COLOR: Record<string, string> = {
  code: "#5a7d9a",
  style: "#8a6a9a",
  markup: "#b05c6e",
  data: "#5f7a4a",
  doc: "#6f7363",
  image: "#b07a3e",
  email: "#2e6f6a",
  task: "#a8842c",
  milestone: "#353a32",
  reminder: "#b25c72",
  note: "#5a6e8c",
  other: "#7e8270",
};
export const TYPE_LABEL: Record<string, string> = {
  code: "Source",
  style: "Stylesheet",
  markup: "Markup",
  data: "Data",
  doc: "Document",
  image: "Asset",
  email: "Email",
  task: "Action item",
  milestone: "Milestone",
  reminder: "Reminder",
  note: "Note",
  other: "File",
};

export function typeColor(n: TimelineNode): string {
  return TYPE_COLOR[n.type] ?? TYPE_COLOR.other!;
}
export function typeLabel(n: TimelineNode): string {
  return TYPE_LABEL[n.type] ?? TYPE_LABEL.other!;
}

/** Curated "activity" = dropped docs/emails + action items/reminders/
 * milestones (id doc:/task:). Native git-scanned corpus files (file:) are
 * excluded unless the user opts to show all. */
export function isActivity(n: TimelineNode): boolean {
  return n.id.startsWith("doc:") || n.id.startsWith("task:");
}

/** The FILES_ROOT-relative store path for a file/email timeline node — for
 * matching the file tree's `store_path`. `file:` nodes carry it in their id
 * (their `path` is container-relative); `doc:` nodes carry it in `path`.
 * Returns null for non-file nodes (tasks/reminders/etc.). */
export function nodeStorePath(n: TimelineNode | null | undefined): string | null {
  if (!n) return null;
  if (n.id.startsWith("file:")) return n.id.slice(5);
  if (n.id.startsWith("doc:")) return n.path ?? null;
  return null;
}

/** Human "days from now" for a timeline item, in UTC calendar days (matching
 * the timeline's UTC rendering): "today", "tomorrow", "yesterday", "in N days",
 * or "N days ago". */
export function daysFromNow(timeMs: number): string {
  const D = 86_400_000;
  const diff = Math.floor(timeMs / D) - Math.floor(Date.now() / D);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

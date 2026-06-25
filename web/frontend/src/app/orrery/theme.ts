// Per-function accent colors + orbital geometry for the orrery map.
//
// Accents follow the Claude Design handoff palette (README §function
// accents). The backend defines five active functions (corp/engr/it/hr/acct);
// we assign each a distinct hue from that palette. An accent is applied at
// full strength on a selected disc/ring/fill and as alpha tints elsewhere —
// use `tint()` for the `<accent>14`/`2E`/`66`-style overlays in the spec.

export interface FnTheme {
  /** stage placement: polar from center, angle in degrees (0=E, 90=S). */
  r: number;
  a: number;
}

export const ACCENTS: Record<string, string> = {
  corp: "#3B5B92", // Corporate — blue
  engr: "#2E6F6A", // Engineering — teal
  it: "#4E7E8E", // IT — steel
  hr: "#B25C72", // Human Resources — rose
  acct: "#A8842C", // Accounting — amber
};

export const FALLBACK_ACCENT = "#6E6960";

export function accentOf(key: string): string {
  return ACCENTS[key] ?? FALLBACK_ACCENT;
}

/** accent + 2-digit alpha hex, e.g. tint("#2E6F6A", "14") → "#2E6F6A14". */
export function tint(accent: string, alpha: string): string {
  return `${accent}${alpha}`;
}

// Orbital geometry on a 580×580 stage (center 290,290), tuned to the
// Company Home screenshot. Bodies the backend doesn't expose simply don't
// render — geometry is keyed defensively.
export const GEOMETRY: Record<string, FnTheme> = {
  engr: { r: 155, a: 300 },
  corp: { r: 150, a: 198 },
  it: { r: 185, a: 18 },
  hr: { r: 175, a: 148 },
  acct: { r: 150, a: 98 },
};

export const STAGE = 580;
const CX = STAGE / 2;
const CY = STAGE / 2;

/** pixel position of a body's center on the stage. */
export function bodyXY(key: string): { x: number; y: number } {
  const g = GEOMETRY[key] ?? { r: 160, a: 0 };
  const rad = (g.a * Math.PI) / 180;
  return { x: CX + g.r * Math.cos(rad), y: CY + g.r * Math.sin(rad) };
}

// Risk ramp (monochrome, greige family) — mirrors the index.css risk tokens.
const RISK_LOW = { bg: "#edece5", fg: "#888578", label: "LOW" };
export const RISK: Record<string, { bg: string; fg: string; label: string }> = {
  low: RISK_LOW,
  medium: { bg: "#dcd9d1", fg: "#47463f", label: "MED" },
  high: { bg: "#2b2a26", fg: "#f6f4ef", label: "HIGH" },
};

export function risk(level: string | null | undefined) {
  return RISK[(level ?? "low").toLowerCase()] ?? RISK_LOW;
}

/** the short FUNC label shown in the company approvals table. */
export function funcLabel(key: string | null | undefined): string {
  return (key ?? "—").toUpperCase();
}

/** initial/abbr shown inside a function disc. */
export function fnAbbr(key: string, name: string): string {
  if (key === "it") return "IT";
  if (key === "hr") return "HR";
  return name.slice(0, 1).toUpperCase();
}

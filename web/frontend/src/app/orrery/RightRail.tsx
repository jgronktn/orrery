import { useMemo, useState } from "react";

import type { ProposalRecord, TimelineNode } from "../../api/client";
import { funcLabel, risk } from "./theme";
import { relAgo } from "./time";

// ── Dark timeline panel (event sparkline) ───────────────────────────

export function TimelinePanel({ events }: { events: TimelineNode[] }) {
  const { bars, span } = useMemo(() => buildSpark(events), [events]);
  return (
    <section className="border-b border-line bg-ink p-5 text-[#f4f6ee]">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.16em] text-[#8d917f]">
            TIMELINE
          </div>
          <div className="mt-0.5 text-[15px] font-semibold tracking-tight">
            {span.label}
          </div>
        </div>
        <div className="text-right font-mono text-[10px] text-[#a7ab95]">
          {events.length} events · {span.short}
        </div>
      </div>
      <Spark bars={bars} />
    </section>
  );
}

function Spark({ bars }: { bars: number[] }) {
  const W = 296;
  const H = 56;
  const max = Math.max(1, ...bars);
  const step = bars.length > 1 ? W / (bars.length - 1) : W;
  const pts: [number, number][] = bars.map((b, i) => [
    i * step,
    H - (b / max) * (H - 6),
  ]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-[76px] w-full"
      preserveAspectRatio="none"
    >
      <polygon points={area} fill="#f4f6ee" opacity={0.08} />
      <polyline
        points={line}
        fill="none"
        stroke="#f4f6ee"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      {last && (
        <>
          <line
            x1={W}
            y1={0}
            x2={W}
            y2={H}
            stroke="#f4f6ee"
            strokeWidth={1}
            opacity={0.4}
            strokeDasharray="2 2"
          />
          <circle cx={last[0]} cy={last[1]} r={2.5} fill="#f4f6ee" />
        </>
      )}
    </svg>
  );
}

function buildSpark(events: TimelineNode[]) {
  if (events.length === 0) {
    return { bars: [0, 0], span: { label: "No activity yet", short: "—" } };
  }
  const times = events.map((e) => e.time);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const days = Math.max(1, Math.round((max - min) / 86_400_000));
  const N = 28;
  const bars: number[] = new Array(N).fill(0);
  const span = max - min || 1;
  for (const t of times) {
    const i = Math.min(N - 1, Math.floor(((t - min) / span) * N));
    bars[i] = (bars[i] ?? 0) + 1;
  }
  return {
    bars,
    span: {
      label: days <= 3 ? `Past ${days} day${days === 1 ? "" : "s"}` : `Past ${days} days`,
      short: `${days}d`,
    },
  };
}

// ── Pending approvals ───────────────────────────────────────────────

export function ApprovalsPanel({
  approvals,
  funcOf,
  showFunc,
  scopeLabel,
  onApprove,
  onReject,
}: {
  approvals: ProposalRecord[];
  funcOf: (p: ProposalRecord) => string;
  showFunc: boolean;
  scopeLabel: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section>
      <div className="flex items-center justify-between border-b border-hairline px-5 pb-3.5 pt-[44px]">
        <span className="text-[13px] font-semibold text-ink">
          Pending approvals
        </span>
        <Badge n={approvals.length} />
      </div>

      {approvals.length === 0 ? (
        <div className="px-5 py-6 text-center text-[12.5px] text-hint">
          Nothing waiting in {scopeLabel}.
        </div>
      ) : (
        <div>
          <div
            className="grid items-center gap-2 px-5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint-alt"
            style={{ gridTemplateColumns: cols(showFunc) }}
          >
            {showFunc && <span>Func</span>}
            <span>Risk</span>
            <span>Proposal</span>
          </div>
          {approvals.map((p) => (
            <div key={p.id} className="border-t border-hairline">
              <button
                onClick={() => setOpen(open === p.id ? null : p.id)}
                className="grid w-full items-center gap-2 px-5 py-2 text-left hover:bg-rowhover"
                style={{ gridTemplateColumns: cols(showFunc) }}
              >
                {showFunc && (
                  <span className="font-mono text-[10px] text-muted-alt">
                    {funcLabel(funcOf(p))}
                  </span>
                )}
                <RiskTag level={p.risk} />
                <span className="truncate text-[12.5px] text-strong">
                  {p.summary}
                </span>
              </button>
              {open === p.id && (
                <div className="flex items-center justify-between gap-3 bg-paper px-5 py-2.5">
                  <span className="font-mono text-[10px] text-hint">
                    {p.agent_id} · {p.kind} · {relAgo(Date.parse(p.created_at))}
                  </span>
                  <span className="flex gap-2">
                    <button
                      onClick={() => onReject(p.id)}
                      className="rounded-lg border border-line-soft bg-white px-3 py-1 text-[12px] text-strong-alt hover:bg-rowhover"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => onApprove(p.id)}
                      className="rounded-lg bg-ink px-3 py-1 text-[12px] text-[#f4f6ee] hover:bg-ink-soft"
                    >
                      Approve
                    </button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function cols(showFunc: boolean): string {
  return showFunc ? "44px 46px 1fr" : "46px 1fr";
}

function RiskTag({ level }: { level: string }) {
  const r = risk(level);
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-center font-mono text-[9.5px] font-medium tracking-wide"
      style={{ background: r.bg, color: r.fg }}
    >
      {r.label}
    </span>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span
      className="grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold"
      style={
        n > 0
          ? { background: "#353a32", color: "#f4f6ee" }
          : { background: "#eceee3", color: "#8d917f" }
      }
    >
      {n}
    </span>
  );
}

// ── Docked agent ask bar ────────────────────────────────────────────

export function AskBar({
  agentName,
  scopeLabel,
  suggestion,
  onAsk,
  busy,
}: {
  agentName: string;
  scopeLabel: string;
  suggestion: string;
  onAsk: (prompt: string) => void;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const q = text.trim();
    if (q && !busy) {
      onAsk(q);
      setText("");
    }
  };
  return (
    <div className="border-t border-line bg-paper px-4 pb-[31px] pt-[31px]">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[12px] font-semibold text-[#f4f6ee]">
          {agentName.slice(0, 1)}
        </span>
        <span className="text-[13px] font-semibold text-ink">{agentName}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-hint">
          {scopeLabel}
        </span>
      </div>
      <button
        onClick={() => onAsk(suggestion)}
        disabled={busy}
        className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-line-soft bg-paper-alt px-3 py-2 text-left text-[12px] text-muted hover:bg-rowhover disabled:opacity-50"
      >
        <span aria-hidden>✦</span>
        <span className="truncate">{suggestion}</span>
      </button>
      <div className="flex items-end gap-2 rounded-xl border border-line-soft bg-white px-3 py-2">
        <textarea
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`Ask ${agentName}…`}
          className="min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-hint"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-[#f4f6ee] hover:bg-ink-soft disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}

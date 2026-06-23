import { useState } from "react";

import type { ProposalRecord, TimelineNode } from "../../api/client";
import { FunctionTimeline } from "./FunctionTimeline";
import { funcLabel, risk } from "./theme";
import { relAgo } from "./time";

// ── Timeline panel — a compact version of the function-page timeline ─

export function TimelinePanel({
  events,
  scope,
  accent,
  onDropFile,
}: {
  events: TimelineNode[];
  scope?: string;
  accent?: string;
  onDropFile?: (file: File) => void;
}) {
  return (
    <section className="border-b border-line bg-paper-alt">
      <div className="flex items-center justify-between px-5 pb-1.5 pt-3.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {scope ? `${scope} · timeline` : "Timeline"}
        </span>
        <span className="font-mono text-[10px] text-hint">{events.length}</span>
      </div>
      <div style={{ height: 180 }}>
        <FunctionTimeline
          nodes={events}
          accent={accent ?? "#353a32"}
          compact
          onDropFile={onDropFile}
        />
      </div>
    </section>
  );
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
  onReopen,
  reopenCount,
}: {
  agentName: string;
  scopeLabel: string;
  suggestion: string;
  onAsk: (prompt: string) => void;
  busy?: boolean;
  // When the conversation is closed but has history, the caller passes a
  // reopen handler + message count to surface a "view conversation" button.
  onReopen?: () => void;
  reopenCount?: number;
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
      {onReopen && reopenCount ? (
        <button
          onClick={onReopen}
          className="mb-2 flex w-full items-center gap-2 rounded-lg border border-line-soft bg-paper-alt px-3 py-2 text-left text-[12px] text-strong-alt hover:bg-rowhover"
        >
          <span aria-hidden>↩</span>
          <span className="truncate">
            View conversation · {reopenCount} message{reopenCount === 1 ? "" : "s"}
          </span>
        </button>
      ) : null}
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

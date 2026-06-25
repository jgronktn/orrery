import { useState } from "react";

import type { ProposalRecord, TimelineNode } from "../../api/client";
import { FunctionTimeline } from "./FunctionTimeline";
import { funcLabel, risk } from "./theme";
import { relAgo } from "./time";
import { daysFromNow, fmtDate } from "./timelineScale";

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
          accent={accent ?? "#2b2a26"}
          compact
          onDropFile={onDropFile}
        />
      </div>
    </section>
  );
}

// ── Right-rail accordion: Pending approvals · Reminders ─────────────
// Two selectable bars; one section open at a time. Reminders open by
// default. Reminders = upcoming timeline reminders (past ones drop off).

export function RailAccordion({
  approvals,
  funcOf,
  showFunc,
  scopeLabel,
  onApprove,
  onReject,
  reminderSource,
}: {
  approvals: ProposalRecord[];
  funcOf: (p: ProposalRecord) => string;
  showFunc: boolean;
  scopeLabel: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  reminderSource: TimelineNode[];
}) {
  const [open, setOpen] = useState<"approvals" | "reminders">("reminders");

  // Upcoming reminders only: drop anything dated before today (UTC start of
  // day, since timeline items sit at noon UTC). Soonest first.
  const now = new Date();
  const todayStartUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const reminders = reminderSource
    .filter((n) => n.type === "reminder" && n.time >= todayStartUTC)
    .sort((a, b) => a.time - b.time);

  return (
    <section className="bg-[#f1f1ef]">
      <RailBar
        label="Pending approvals"
        open={open === "approvals"}
        count={approvals.length}
        onClick={() => setOpen("approvals")}
      />
      {open === "approvals" && (
        <ApprovalsBody
          approvals={approvals}
          funcOf={funcOf}
          showFunc={showFunc}
          scopeLabel={scopeLabel}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}
      <RailBar
        label="Reminders"
        open={open === "reminders"}
        count={reminders.length}
        onClick={() => setOpen("reminders")}
      />
      {open === "reminders" && (
        <RemindersBody reminders={reminders} scopeLabel={scopeLabel} />
      )}
    </section>
  );
}

// A selectable accordion header bar.
function RailBar({
  label,
  open,
  count,
  onClick,
}: {
  label: string;
  open: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-[#f8f8f6] bg-[#e8e8e4] px-5 py-3.5 text-left hover:bg-rowhover"
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] leading-none text-hint" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="text-[13px] font-semibold text-ink">{label}</span>
      </span>
      <Badge n={count} />
    </button>
  );
}

// Upcoming reminders, soonest first.
function RemindersBody({
  reminders,
  scopeLabel,
}: {
  reminders: TimelineNode[];
  scopeLabel: string;
}) {
  if (reminders.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-[12.5px] text-hint">
        No upcoming reminders in {scopeLabel}.
      </div>
    );
  }
  return (
    <div>
      {reminders.map((r) => (
        <div
          key={r.id}
          className="flex items-start justify-between gap-3 border-t border-hairline px-5 py-2.5"
        >
          <span className="flex min-w-0 items-start gap-2">
            <span
              className="mt-1 h-2 w-2 shrink-0 rounded-full"
              style={{ background: "#a86676" }}
            />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] text-strong">
                {r.name}
              </span>
              {r.function && (
                <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-alt">
                  {funcLabel(r.function)}
                </span>
              )}
              {r.note && (
                <span className="block truncate text-[11px] text-hint">
                  {r.note}
                </span>
              )}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-[10px] text-muted-alt">
              {fmtDate(r.time)}
            </span>
            <span className="block font-mono text-[9.5px] text-hint">
              {daysFromNow(r.time)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Pending approvals list (the accordion's other section).
function ApprovalsBody({
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
    <>
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
                      className="rounded-lg bg-ink px-3 py-1 text-[12px] text-[#f6f4ef] hover:bg-ink-soft"
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
    </>
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
          ? { background: "#2b2a26", color: "#f6f4ef" }
          : { background: "#edece5", color: "#888578" }
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
        <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[12px] font-semibold text-[#f6f4ef]">
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
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-[#f6f4ef] hover:bg-ink-soft disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}

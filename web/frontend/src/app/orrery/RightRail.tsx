import { useState } from "react";

import type { ProposalRecord, TimelineNode } from "../../api/client";
import { FunctionTimeline } from "./FunctionTimeline";
import { ThinkingLabel } from "./ThinkingLabel";
import { funcLabel, risk } from "./theme";
import { relAgo } from "./time";
import { daysFromNow, fmtDate, typeColor } from "./timelineScale";
import { isActionable } from "./timelineSurface";

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

// ── Right-rail accordion: Pending approvals · Open items ────────────
// Two selectable bars; one section open at a time. Open items open by
// default. Open items = action items + reminders that aren't done yet
// (notes, decisions, and milestones are ongoing records, not listed here).

export function RailAccordion({
  approvals,
  funcOf,
  showFunc,
  scopeLabel,
  onApprove,
  onReject,
  reminderSource,
  onReminderSelect,
}: {
  approvals: ProposalRecord[];
  funcOf: (p: ProposalRecord) => string;
  showFunc: boolean;
  scopeLabel: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  reminderSource: TimelineNode[];
  onReminderSelect?: (r: TimelineNode) => void;
}) {
  const [open, setOpen] = useState<"approvals" | "items">("items");

  // Open action items + reminders (not done). Overdue ones stay — they're
  // still open. Soonest/oldest first so what's due is at the top.
  const items = reminderSource
    .filter(
      (n) => n.kind === "task" && isActionable(n.type) && n.status !== "done",
    )
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
        label="Open items"
        open={open === "items"}
        count={items.length}
        onClick={() => setOpen("items")}
      />
      {open === "items" && (
        <OpenItemsBody
          items={items}
          scopeLabel={scopeLabel}
          onSelect={onReminderSelect}
        />
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
      className="flex h-[50px] w-full items-center justify-between border-b border-[#f8f8f6] bg-[#e8e8e4] px-5 text-left hover:bg-rowhover"
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] leading-none text-hint" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
      </span>
      <Badge n={count} />
    </button>
  );
}

// Open action items + reminders, soonest first. Rows are clickable when
// onSelect is given (opens the item's detail panel, where it can be completed).
function OpenItemsBody({
  items,
  scopeLabel,
  onSelect,
}: {
  items: TimelineNode[];
  scopeLabel: string;
  onSelect?: (r: TimelineNode) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-[12.5px] text-hint">
        Nothing open in {scopeLabel}.
      </div>
    );
  }
  const cls =
    "flex w-full items-start justify-between gap-3 border-t border-hairline px-5 py-2.5 text-left";
  return (
    <div>
      {items.map((r) => {
        const inner = (
          <>
            <span className="flex min-w-0 items-start gap-2">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ background: typeColor(r) }}
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
          </>
        );
        return onSelect ? (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            title={`Open ${r.name}`}
            className={`${cls} cursor-pointer hover:bg-rowhover`}
          >
            {inner}
          </button>
        ) : (
          <div key={r.id} className={cls}>
            {inner}
          </div>
        );
      })}
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
    <div className="flex flex-col border-t border-line bg-[#f1f1ef]">
      {/* header bar — same treatment as the Pending approvals / Reminders bars */}
      <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-[#f8f8f6] bg-[#e8e8e4] px-5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-[#f6f4ef]">
          {agentName.slice(0, 1)}
        </span>
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          {agentName}
        </span>
        {onReopen ? (
          <button
            onClick={onReopen}
            title={reopenCount ? "View conversation" : "Open chat"}
            className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#50708a] hover:opacity-75"
          >
            <span className="grid h-6 min-w-6 place-items-center rounded-full border-2 border-[#50708a] bg-transparent px-1.5 font-bold leading-none tracking-normal">
              {reopenCount || "✦"}
            </span>
            {reopenCount ? "view" : "open chat"}
          </button>
        ) : (
          <span className="ml-auto truncate font-mono text-[10px] uppercase tracking-[0.08em] text-hint">
            {scopeLabel}
          </span>
        )}
      </div>
      <div className="px-4 pb-[31px] pt-3">
      {busy ? (
        // Live feedback right where the user asked — the conversation's
        // "Thinking…" can be scrolled off or in a collapsed pane.
        <div className="mb-2 flex w-full items-center gap-2 rounded-lg border border-line-soft bg-paper-alt px-3 py-2 text-[12px] text-muted">
          <span className="h-2 w-2 animate-orrery-pulse rounded-full bg-[#50708a]" />
          <ThinkingLabel agentName={agentName} />
        </div>
      ) : (
        <button
          onClick={() => onAsk(suggestion)}
          className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-line-soft bg-paper-alt px-3 py-2 text-left text-[12px] text-muted hover:bg-rowhover"
        >
          <span aria-hidden>✦</span>
          <span className="truncate">{suggestion}</span>
        </button>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-line-soft bg-white px-3 py-2">
        <textarea
          value={text}
          rows={2}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? "Waiting for a reply…" : `Ask ${agentName}…`}
          className="min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-hint disabled:opacity-60"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-[#f6f4ef] hover:bg-ink-soft disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? (
            <span className="h-2 w-2 animate-orrery-pulse rounded-full bg-[#f6f4ef]" />
          ) : (
            "↑"
          )}
        </button>
      </div>
      </div>
    </div>
  );
}

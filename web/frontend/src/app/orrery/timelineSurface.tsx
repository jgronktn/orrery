import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api, type Message, type TimelineNode } from "../../api/client";
import { fmtClock, fmtDateY, typeLabel } from "./timelineScale";

// Shared pieces of the activity-timeline surface, used by both the Function
// page and the Project page: the add-item composer (kind chips), the agent
// answer panel, and the selected-item detail panel.

export const KINDS = [
  { value: "task", label: "Action item", color: "#a8842c" },
  { value: "milestone", label: "Milestone", color: "#353a32" },
  { value: "reminder", label: "Reminder", color: "#b25c72" },
  { value: "note", label: "Note", color: "#5a6e8c" },
] as const;

// Display order in the composer: Note · Reminder · Action item · Milestone.
const CHIPS = [KINDS[3], KINDS[2], KINDS[0], KINDS[1]];

export function Composer({
  kind,
  title,
  due,
  disabled,
  onChoose,
  onTitle,
  onDue,
  onSubmit,
  onCancel,
}: {
  kind: string | null;
  title: string;
  due: string;
  disabled: boolean;
  onChoose: (k: string) => void;
  onTitle: (v: string) => void;
  onDue: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const active = KINDS.find((k) => k.value === kind) ?? null;
  return (
    <div className="flex items-center justify-center gap-6 border-b border-line bg-paper-alt px-8 py-2.5">
      {CHIPS.map((k) => {
        const on = kind === k.value;
        return (
          <button
            key={k.value}
            title="Drag onto the timeline, or click to add at today"
            draggable={!disabled}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-orrery-kind", k.value);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => !disabled && onChoose(k.value)}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-rowhover disabled:opacity-40"
            style={{
              cursor: disabled ? "default" : "grab",
              background: on ? `${k.color}14` : undefined,
              boxShadow: on ? `inset 0 0 0 1px ${k.color}66` : undefined,
            }}
          >
            <span style={{ color: k.color }}>
              <KindGlyph value={k.value} />
            </span>
            <span className="text-[12.5px] font-medium text-strong">{k.label}</span>
          </button>
        );
      })}

      {active && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
              else if (e.key === "Escape") onCancel();
            }}
            placeholder={`New ${active.label.toLowerCase()}… (Enter to add)`}
            className="w-72 rounded-lg border border-line-soft bg-white px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-hint"
          />
          <input
            type="date"
            value={due}
            onChange={(e) => onDue(e.target.value)}
            title="Date (defaults to today)"
            className="rounded-lg border border-line-soft bg-white px-2 py-1.5 text-[12.5px] text-strong outline-none"
          />
          <button
            onClick={onCancel}
            title="Cancel"
            aria-label="Cancel"
            className="grid h-8 w-8 place-items-center rounded-full border border-line-soft bg-white text-[13px] text-hint hover:bg-rowhover hover:text-strong"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function KindGlyph({ value }: { value: string }) {
  if (value === "milestone") {
    return (
      <svg width="32" height="32" viewBox="0 0 16 16" aria-hidden>
        <path d="M3.5 1.5v13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M3.5 2.5h8l-1.8 2.6 1.8 2.6h-8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    );
  }
  if (value === "reminder") {
    return (
      <svg width="32" height="32" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M4 7a4 4 0 018 0c0 3 1 4 1.5 4.5h-11C3 11 4 10 4 7z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M6.5 13a1.5 1.5 0 003 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (value === "note") {
    // a small page with a folded corner + text lines
    return (
      <svg width="32" height="32" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M3.5 2h6l3 3v9h-9z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M9.5 2v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5.5 8h5M5.5 10.5h5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  // action item — a checkbox (square with a check)
  return (
    <svg width="32" height="32" viewBox="0 0 16 16" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.2 8.2l1.8 1.8 3.6-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AskAnswer({
  accent,
  prompt,
  answer,
  busy,
  onClose,
}: {
  accent: string;
  prompt: string;
  answer: string;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-8 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-hint">You asked</div>
          <div className="mt-0.5 text-[14px] font-semibold text-ink">{prompt}</div>
        </div>
        <button onClick={onClose} className="shrink-0 font-mono text-[12px] text-hint hover:text-strong">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {busy && !answer ? (
          <div className="flex items-center gap-2 text-[13px] text-hint">
            <span className="h-2 w-2 animate-orrery-pulse rounded-full" style={{ background: accent }} />
            Thinking…
          </div>
        ) : (
          <div className="max-w-[760px] text-[14px] leading-relaxed text-strong [&_a]:underline [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// A scrolling transcript of the persisted agent conversation: user turns and
// assistant turns stack newest-at-bottom, with the in-flight question shown
// optimistically while the agent is thinking.
export function Conversation({
  accent,
  agentName,
  messages,
  pending,
  busy,
  onClose,
  onDeleteTurn,
}: {
  accent: string;
  agentName: string;
  messages: Message[];
  pending: string | null;
  busy: boolean;
  onClose: () => void;
  // Remove a whole exchange: a prompt plus its response(s). Receives every
  // message id in the turn.
  onDeleteTurn?: (ids: string[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, busy]);

  const empty = messages.length === 0 && !pending;
  // Group the flat message list into turns: each user message starts a new
  // turn; assistant replies attach to the turn above them.
  const turns: Message[][] = [];
  for (const m of messages) {
    if (m.role === "user" || turns.length === 0) turns.push([m]);
    else turns[turns.length - 1]!.push(m);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-hint">
          {agentName} · conversation
        </div>
        <button onClick={onClose} className="shrink-0 font-mono text-[12px] text-hint hover:text-strong">
          ✕
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {empty ? (
          <div className="grid h-full place-items-center text-[12.5px] text-hint">
            No messages yet — ask the agent below.
          </div>
        ) : (
          turns.map((turn, i) => {
            const ids = turn.map((m) => m.id);
            const del = onDeleteTurn ? () => onDeleteTurn(ids) : undefined;
            return (
              <div key={ids[0] ?? i} className="space-y-2">
                {turn.map((m, j) =>
                  m.role === "user" ? (
                    <UserTurn
                      key={m.id}
                      accent={accent}
                      content={m.content}
                      onDelete={j === 0 ? del : undefined}
                    />
                  ) : (
                    <AssistantTurn
                      key={m.id}
                      accent={accent}
                      content={m.content}
                      onDelete={j === 0 ? del : undefined}
                    />
                  ),
                )}
              </div>
            );
          })
        )}
        {pending && <UserTurn accent={accent} content={pending} />}
        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-hint">
            <span className="h-2 w-2 animate-orrery-pulse rounded-full" style={{ background: accent }} />
            Thinking…
          </div>
        )}
      </div>
    </div>
  );
}

function UserTurn({
  accent,
  content,
  onDelete,
}: {
  accent: string;
  content: string;
  onDelete?: () => void;
}) {
  return (
    <div className="flex justify-end">
      <div
        className="flex max-w-[80%] items-start gap-2 rounded-2xl rounded-br-sm px-3.5 py-2 text-[13.5px] text-ink"
        style={{ background: `${accent}1a` }}
      >
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{content}</span>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Remove this prompt and its response"
            aria-label="Remove this prompt and its response"
            className="mt-0.5 grid h-[25px] w-[25px] shrink-0 cursor-pointer place-items-center rounded-full border bg-transparent text-[14px] leading-none text-ink/55 hover:text-[#8a3b2e]"
            style={{ borderColor: `${accent}80` }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantTurn({
  accent,
  content,
  onDelete,
}: {
  accent: string;
  content: string;
  onDelete?: () => void;
}) {
  return (
    <div className="group flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: accent }}>
          Agent
        </span>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Remove this prompt and its response"
            className="font-mono text-[11px] text-line-soft opacity-0 hover:text-[#8a3b2e] group-hover:opacity-100"
          >
            ✕
          </button>
        )}
      </div>
      <div className="max-w-[760px] text-[13.5px] leading-relaxed text-strong [&_a]:underline [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-paper [&_pre]:p-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

export function DetailPanel({
  node,
  accent,
  onClose,
  onSetNote,
  onSetDate,
  onDelete,
}: {
  node: TimelineNode;
  accent: string;
  onClose: () => void;
  onSetNote: (note: string | null) => void;
  onSetDate: (date: string) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(node.note ?? "");
  useEffect(() => setNote(node.note ?? ""), [node.id, node.note]);
  const editable = node.id.startsWith("doc:") || node.id.startsWith("task:");
  const removable = editable;
  const utcDate = new Date(node.time).toISOString().slice(0, 10);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.12em]" style={{ color: accent }}>
            {typeLabel(node)}
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-ink" title={node.name}>
            {node.name}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close details"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-soft bg-white text-[18px] leading-none text-hint hover:bg-rowhover hover:text-strong"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[12.5px] text-strong">
        <Row label="When">
          {editable ? (
            <span className="flex items-center gap-2">
              <input
                type="date"
                value={utcDate}
                onChange={(e) => e.target.value && onSetDate(e.target.value)}
                className="rounded-lg border border-line-soft bg-white px-2 py-1 text-[12.5px] text-ink outline-none"
              />
              <span className="font-mono text-[10px] text-hint">UTC</span>
            </span>
          ) : (
            <>
              {fmtDateY(node.time)} · {fmtClock(node.time)} UTC
            </>
          )}
        </Row>
        {node.facet && <Row label="Folder">{node.facet}</Row>}
        {node.status && <Row label="Status">{node.status}</Row>}
        {node.desc && (
          <Row label="Detail">
            <span className="whitespace-pre-line">{node.desc}</span>
          </Row>
        )}
        {node.path && (
          <Row label="Path">
            <span className="break-all font-mono text-[11px] text-muted">
              files/{node.path}
            </span>
          </Row>
        )}
        {node.path && (
          <Row label="File">
            <a
              href={api.fileRawUrl(node.path)}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: accent }}
            >
              Open
            </a>
          </Row>
        )}

        <div>
          <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
            Note / link
          </div>
          <textarea
            value={note}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note or URL…"
            className="w-full resize-none rounded-lg border border-line-soft bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-hint"
          />
          <button
            onClick={() => onSetNote(note.trim() || null)}
            className="mt-1.5 rounded-lg border border-line-soft bg-white px-3 py-1 text-[12px] text-strong-alt hover:bg-rowhover"
          >
            Save note
          </button>
        </div>
      </div>

      {removable && (
        <div className="border-t border-line px-4 py-3">
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-line-soft bg-white px-3 py-1.5 text-[12px] text-[#8a3b2e] hover:bg-[#fbecea]"
          >
            Remove from timeline
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Artifact, Message, Proposal } from "../api/client";

export default function Messages({
  messages,
  busy,
  emptyHint,
}: {
  messages: Message[];
  busy: boolean;
  emptyHint: string;
}) {
  if (messages.length === 0 && !busy) {
    return (
      <div className="h-full grid place-items-center text-slate-400 text-sm px-6 text-center">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {messages.map((m) => (
        <MessageView key={m.id} message={m} />
      ))}
      {busy && (
        <p className="text-sm text-slate-400">Engineering agent is working…</p>
      )}
    </div>
  );
}

function MessageView({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const proposals = (message.proposals ?? []) as Proposal[];
  const artifacts = (message.artifacts ?? []) as Artifact[];
  return (
    <div className={isUser ? "text-right" : ""}>
      <div
        className={
          isUser
            ? "inline-block rounded-2xl bg-slate-800 text-white px-4 py-2 text-sm max-w-[80%] text-left whitespace-pre-wrap"
            : "inline-block max-w-full"
        }
      >
        {isUser ? (
          message.content
        ) : (
          <div className="text-sm text-slate-800 leading-relaxed [&_a]:text-blue-600 [&_a]:underline [&_table]:border-collapse [&_table]:my-2 [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
              }}
            >
              {message.content}
            </Markdown>
          </div>
        )}
      </div>

      {artifacts.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {artifacts.map((a, i) => (
            <a
              key={i}
              href={a.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 underline"
            >
              📄 {a.title}
            </a>
          ))}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {proposals.map((p, i) => (
            <ProposalCard key={i} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const riskColor =
    proposal.risk === "high"
      ? "bg-red-100 text-red-700"
      : proposal.risk === "medium"
        ? "bg-amber-100 text-amber-700"
        : "bg-green-100 text-green-700";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-700">Proposal</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${riskColor}`}>
          {proposal.risk} risk
        </span>
      </div>
      <p className="mt-1 text-slate-600">{proposal.summary}</p>
      <p className="mt-1 text-xs text-slate-400">
        {proposal.risk === "low"
          ? "Low risk — auto-approved."
          : "Sent to the approvals queue →"}
      </p>
    </div>
  );
}

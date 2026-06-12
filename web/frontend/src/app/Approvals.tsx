import { useState } from "react";

import type { ProposalRecord } from "../api/client";

export default function Approvals({
  proposals,
  onApprove,
  onReject,
}: {
  proposals: ProposalRecord[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Pending approvals
      </h2>
      {proposals.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing waiting.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {proposals.map((p) => (
            <ApprovalItem
              key={p.id}
              proposal={p}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApprovalItem({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: ProposalRecord;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const riskColor =
    proposal.risk === "high"
      ? "bg-red-100 text-red-700"
      : proposal.risk === "medium"
        ? "bg-amber-100 text-amber-700"
        : "bg-green-100 text-green-700";

  const act = async (fn: (id: string) => Promise<void>) => {
    setBusy(true);
    try {
      await fn(proposal.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-lg border p-2.5 text-sm ${
        proposal.risk === "high" ? "border-red-300 bg-red-50" : "border-slate-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${riskColor}`}
        >
          {proposal.risk}
        </span>
        <span className="text-xs text-slate-400">{proposal.kind}</span>
      </div>
      <p className="mt-1 text-slate-700">{proposal.summary}</p>
      <div className="mt-2 flex gap-2">
        <button
          disabled={busy}
          onClick={() => void act(onApprove)}
          className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => void act(onReject)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </li>
  );
}

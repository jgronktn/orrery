import { useParams } from "react-router-dom";

import { Shell } from "./Shell";

// Placeholder — the full Project View surface (phase tracker, phase-grouped
// log, tasks, project agents, approval) is a later build increment.
export default function ProjectView() {
  const { id = "" } = useParams();
  return (
    <Shell
      company="PPI"
      crumbs={[
        { label: "Map", to: "/", back: true },
        { label: "Project", mono: true },
      ]}
    >
      <div className="grid h-[600px] place-items-center text-center">
        <div>
          <div className="text-[22px] font-semibold text-ink">Project</div>
          <p className="mt-2 font-mono text-[12px] text-muted">{id}</p>
          <p className="mt-2 text-[13px] text-muted">
            Project View surface — a later increment.
          </p>
        </div>
      </div>
    </Shell>
  );
}

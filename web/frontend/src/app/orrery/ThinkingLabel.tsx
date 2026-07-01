import { useEffect, useState } from "react";

// A lightweight "still working" ticker shown while an agent request is in
// flight. Orrery has no streaming yet (the agent returns its whole answer at
// the end), so this is client-side reassurance — an elapsed clock plus a
// message that escalates over time — NOT true per-step progress. Mount it only
// while busy: the timer starts on mount and is cleared on unmount, so each
// question restarts it from zero.
export function ThinkingLabel({ agentName }: { agentName?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  const who = agentName ?? "The agent";
  const phase =
    elapsed < 5
      ? `${who} is thinking…`
      : elapsed < 15
        ? "Working through your documents…"
        : elapsed < 30
          ? "Still working…"
          : "Taking longer than usual — hang tight…";
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <>
      <span className="truncate">{phase}</span>
      {elapsed >= 3 && (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-hint">
          {clock}
        </span>
      )}
    </>
  );
}

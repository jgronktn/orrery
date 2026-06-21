import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { api, type FunctionInfo } from "../../api/client";
import { Shell } from "./Shell";
import { accentOf } from "./theme";

// Placeholder — the full Function Stream surface (timeline ribbon, composer,
// projects, file drop, approvals) is the next build increment. This renders
// the real function header so navigation from Company Home is live.
export default function FunctionStream() {
  const { key = "" } = useParams();
  const [fn, setFn] = useState<FunctionInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getFunction(key).then(setFn).catch((e) => setErr(String(e)));
  }, [key]);

  return (
    <Shell
      company="PPI"
      crumbs={[
        { label: "Map", to: "/", back: true },
        { label: fn?.name ?? key, dot: accentOf(key) },
        { label: "STREAM", mono: true },
      ]}
      status={`${(fn?.name ?? key).toUpperCase()} STREAM`}
    >
      <div className="grid h-[600px] place-items-center text-center">
        <div>
          <div
            className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full text-[18px] font-semibold text-white"
            style={{ background: accentOf(key) }}
          >
            {(fn?.name ?? key).slice(0, 1).toUpperCase()}
          </div>
          <div className="text-[22px] font-semibold text-ink">
            {fn?.name ?? key}
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {err ?? "Function Stream surface — building next."}
          </p>
        </div>
      </div>
    </Shell>
  );
}

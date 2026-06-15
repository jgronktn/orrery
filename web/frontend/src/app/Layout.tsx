import { useState } from "react";

import { api, ApiError, type FsTreeNode } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import FsExplorer from "./FsExplorer";
import Workspace from "./Workspace";

const AGENT_ID = "engineering";

export default function Layout() {
  const { user, logout } = useAuth();
  const [tree, setTree] = useState<FsTreeNode | null>(null);
  const [opening, setOpening] = useState(false);

  const openFiles = async () => {
    if (opening) return;
    setOpening(true);
    try {
      setTree(await api.agentTree(AGENT_ID));
    } catch (e) {
      console.error(e instanceof ApiError ? e.message : e);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-slate-800">Orrery</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            engineering
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <button
            onClick={() => void openFiles()}
            disabled={opening}
            className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
          >
            {opening ? "Opening…" : "🗂 Browse files"}
          </button>
          <span>{user?.email}</span>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 p-4">
        <Workspace />
      </div>

      {tree && (
        <FsExplorer
          tree={tree}
          onClose={() => setTree(null)}
          onChanged={() => {
            api.agentTree(AGENT_ID).then(setTree).catch(console.error);
          }}
        />
      )}
    </div>
  );
}

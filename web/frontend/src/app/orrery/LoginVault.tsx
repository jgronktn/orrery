import { useEffect, useState } from "react";

// Standalone subscription/login account list for the IT function's credential
// vault "moon". Entries are added/edited in the UI and kept in localStorage for
// now (no secrets — just account metadata); this will move to a Bitwarden
// read-through later.

interface Login {
  id: string;
  svc: string;
  user: string;
  cat: string;
  url: string;
  mfa: boolean;
}

const KEY = "orrery-logins";
const CATS = [
  "Cloud", "Identity", "Engineering", "Infra",
  "Security", "Vendor", "Business", "Devices", "Other",
];

function load(): Login[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function LoginVault({ accent, onClose }: { accent: string; onClose: () => void }) {
  const [logins, setLogins] = useState<Login[]>(() => load());
  // null = form closed; "new" = adding; a Login = editing that account.
  const [formFor, setFormFor] = useState<Login | "new" | null>(null);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(logins));
  }, [logins]);

  const save = (l: Omit<Login, "id">) => {
    if (formFor === "new") {
      setLogins((cur) => [...cur, { ...l, id: crypto.randomUUID() }]);
    } else if (formFor) {
      const id = formFor.id;
      setLogins((cur) => cur.map((x) => (x.id === id ? { ...x, ...l } : x)));
    }
    setFormFor(null);
  };
  const remove = (id: string) => setLogins((cur) => cur.filter((l) => l.id !== id));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-paper-alt">
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: `${accent}1f`, color: accent }}>
            <KeyGlyph />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">Account Logins</div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-hint">
              {logins.length} accounts · Bitwarden (read-through, coming soon)
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setFormFor((f) => (f === "new" ? null : "new"))}
            className="rounded-lg px-3 py-1 text-[12px] font-medium text-white"
            style={{ background: accent }}
          >
            ＋ Add account
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-line-soft bg-white px-3 py-1 text-[12px] text-strong-alt hover:bg-rowhover"
          >
            ‹ Back to map
          </button>
        </div>
      </div>

      {formFor !== null && (
        <AccountForm
          key={formFor === "new" ? "new" : formFor.id}
          accent={accent}
          initial={formFor === "new" ? null : formFor}
          onSave={save}
          onCancel={() => setFormFor(null)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {logins.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] text-hint">
            No accounts yet — add one with “＋ Add account”.
          </p>
        ) : (
          <>
            <div
              className="grid items-center gap-3 border-b border-hairline px-6 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint-alt"
              style={{ gridTemplateColumns: COLS }}
            >
              <span>Service</span>
              <span>Account</span>
              <span>Category</span>
              <span>MFA</span>
              <span />
            </div>
            {logins.map((l) => (
              <div
                key={l.id}
                className="group grid items-center gap-3 border-b border-hairline px-6 py-2.5 text-[12.5px] text-strong hover:bg-rowhover"
                style={{ gridTemplateColumns: COLS }}
              >
                <span className="truncate font-medium text-ink" title={l.svc}>
                  {l.url ? (
                    <a href={l.url} target="_blank" rel="noreferrer" className="underline" style={{ color: accent }}>
                      {l.svc}
                    </a>
                  ) : (
                    l.svc
                  )}
                </span>
                <span className="truncate font-mono text-[11.5px] text-muted" title={l.user}>
                  {l.user || "—"}
                </span>
                <span>
                  {l.cat && (
                    <span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: `${accent}14`, color: accent }}>
                      {l.cat}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: l.mfa ? accent : "#b05c6e" }}>
                  {l.mfa ? "on" : "off"}
                </span>
                <span className="flex justify-self-end gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => setFormFor(l)}
                    title="Edit"
                    className="grid h-6 w-6 place-items-center rounded text-hint hover:bg-line hover:text-strong"
                  >
                    <PencilGlyph />
                  </button>
                  <button
                    onClick={() => remove(l.id)}
                    title="Remove"
                    className="grid h-6 w-6 place-items-center rounded text-hint hover:bg-line hover:text-[#8a3b2e]"
                  >
                    <XGlyph />
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function AccountForm({
  accent,
  initial,
  onSave,
  onCancel,
}: {
  accent: string;
  initial: Login | null;
  onSave: (l: Omit<Login, "id">) => void;
  onCancel: () => void;
}) {
  const [svc, setSvc] = useState(initial?.svc ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [cat, setCat] = useState(initial?.cat ?? CATS[0]!);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [mfa, setMfa] = useState(initial?.mfa ?? false);

  const submit = () => {
    if (!svc.trim()) return;
    onSave({ svc: svc.trim(), user: user.trim(), cat, url: url.trim(), mfa });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-6 py-3">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
        {initial ? "Edit" : "New"}
      </span>
      <input
        autoFocus
        value={svc}
        onChange={(e) => setSvc(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Service *"
        className="min-w-[160px] flex-1 rounded-lg border border-line-soft bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-hint"
      />
      <input
        value={user}
        onChange={(e) => setUser(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Account / email"
        className="min-w-[160px] flex-1 rounded-lg border border-line-soft bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-hint"
      />
      <select
        value={cat}
        onChange={(e) => setCat(e.target.value)}
        className="rounded-lg border border-line-soft bg-white px-2 py-1.5 text-[12.5px] text-strong outline-none"
      >
        {CATS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="URL"
        className="min-w-[160px] flex-1 rounded-lg border border-line-soft bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-hint"
      />
      <label className="flex items-center gap-1.5 text-[12px] text-muted">
        <input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} />
        MFA
      </label>
      <button
        onClick={submit}
        disabled={!svc.trim()}
        className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
        style={{ background: accent }}
      >
        {initial ? "Save" : "Add"}
      </button>
      <button
        onClick={onCancel}
        className="rounded-lg border border-line-soft bg-white px-3 py-1.5 text-[12px] text-strong-alt hover:bg-rowhover"
      >
        Cancel
      </button>
    </div>
  );
}

const COLS = "1.6fr 1.6fr 1fr 0.5fr 56px";

function KeyGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <circle cx="5.5" cy="6.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.6 8.6L13 14M11 12l1.5-1.5M12.5 13.5L14 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

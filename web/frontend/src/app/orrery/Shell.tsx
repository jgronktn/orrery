import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { accentOf } from "./theme";
import { initials } from "./time";

// The warm-paper shell every surface shares: a 1440px card centered on the
// page background, with a 56px topbar (breadcrumb · live status · avatar).

export interface Crumb {
  label: string;
  to?: string; // omitted = current / non-link
  dot?: string; // accent color for a leading dot (function crumbs)
  mono?: boolean; // render in mono (level tags like STREAM)
  back?: boolean; // render as a "← Map" chip
}

export function Shell({
  company,
  crumbs,
  status,
  children,
}: {
  company: string;
  crumbs: Crumb[];
  status?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-paper">
      <Topbar company={company} crumbs={crumbs} status={status} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Topbar({
  company,
  crumbs,
  status,
}: {
  company: string;
  crumbs: Crumb[];
  status?: string;
}) {
  const { user } = useAuth();
  return (
    <div className="flex h-14 items-center justify-between border-b border-line bg-[#FAFAFA] px-[18px]">
      {/* left — breadcrumb */}
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="font-bold text-ink">{company}</span>
        {crumbs.map((c, i) => (
          <Crumbpart key={i} c={c} />
        ))}
      </div>

      {/* center — live status */}
      {status && (
        <div className="hidden items-center gap-2 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-hint animate-orrery-pulse" />
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-hint">
            {status}
          </span>
        </div>
      )}

      {/* right — avatar */}
      <div className="flex items-center gap-3">
        <span className="hidden font-bold tracking-tight text-ink sm:inline">
          {company}
        </span>
        <span
          className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[11px] font-semibold text-[#f6f4ef]"
          title={user?.display_name}
        >
          {user ? initials(user.display_name) : "··"}
        </span>
      </div>
    </div>
  );
}

function Crumbpart({ c }: { c: Crumb }) {
  const dot = c.dot ?? (c.label && accentOf(c.label));
  const inner = (
    <span
      className={
        c.back
          ? "inline-flex items-center gap-1 rounded-lg border border-line-soft bg-[#efece4] px-2 py-0.5 text-[12px] text-strong-alt hover:bg-rowhover"
          : c.mono
            ? "font-mono text-[10px] uppercase tracking-[0.1em] text-faint"
            : "inline-flex items-center gap-1.5 text-[13px] text-strong"
      }
    >
      {c.back && <span aria-hidden>‹</span>}
      {c.dot && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: dot }}
          aria-hidden
        />
      )}
      {c.label}
    </span>
  );
  return (
    <>
      <span className="text-line-soft" aria-hidden>
        /
      </span>
      {c.to ? <Link to={c.to}>{inner}</Link> : inner}
    </>
  );
}

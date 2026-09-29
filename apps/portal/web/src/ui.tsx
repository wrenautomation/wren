/** Small shared pieces: loading a call, numbers, dates, where someone is now. */
import { type ReactNode, useEffect, useState } from "react";
import { ApiError, type Now, type Reason } from "./api.js";

export type Load<T> = { data: T | null; error: ApiError | null; loading: boolean };

/** Run `fn` whenever `key` changes; the last answer stays on screen while the next loads. */
export function useCall<T>(key: string, fn: () => Promise<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ data: null, error: null, loading: true });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `fn` reads.
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (err: unknown) =>
        live &&
        setState((s) => ({
          data: s.data,
          error: err instanceof ApiError ? err : new ApiError(String(err), 0),
          loading: false,
        })),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

export function Failed({ error }: { error: ApiError }) {
  return (
    <div className="failed" role="alert">
      {error.message}
    </div>
  );
}

export const num = (n: number) => n.toLocaleString("en-US");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2025-03-14" -> "Mar 2025"; days would claim a precision the data rarely has. */
export function month(day: string | null): string {
  if (!day) return "";
  const [y, m] = day.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${y}`;
}

export function ago(day: string | null, today = new Date()): string {
  if (!day) return "never";
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const months =
    (today.getUTCFullYear() - d.getUTCFullYear()) * 12 + today.getUTCMonth() - d.getUTCMonth();
  if (months < 1) return "this month";
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(months / 12);
  return `${years} yr${years > 1 ? "s" : ""} ago`;
}

/** Where they are now, in words. */
export function NowCell({ now }: { now: Now | null }) {
  if (!now) return <span className="quiet">Not looked up</span>;
  if (now.kind === "still_there") return <span>Still there</span>;
  if (now.kind === "left") return <span className="tag tag-left">Left</span>;
  return (
    <span>
      <span className="tag tag-moved">Moved</span>{" "}
      {now.company ? <b>{now.company}</b> : "somewhere new"}
      {now.title ? <span className="quiet"> · {now.title}</span> : null}
    </span>
  );
}

export function Reasons({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="reasons">
      {reasons.map((r) => (
        <li key={r.reason}>
          <span className="pts">{r.points > 0 ? `+${r.points}` : r.points}</span> {r.reason}
        </li>
      ))}
    </ul>
  );
}

export function Stat({
  value,
  label,
  note,
}: {
  value: ReactNode;
  label: string;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

export function Pager({
  offset,
  size,
  total,
  onPage,
}: {
  offset: number;
  size: number;
  total: number;
  onPage: (offset: number) => void;
}) {
  if (total <= size) return null;
  return (
    <div className="pager">
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => onPage(Math.max(0, offset - size))}
      >
        Previous
      </button>
      <span>
        {num(offset + 1)}–{num(Math.min(offset + size, total))} of {num(total)}
      </span>
      <button type="button" disabled={offset + size >= total} onClick={() => onPage(offset + size)}>
        Next
      </button>
    </div>
  );
}

const KINDS: Record<string, string> = {
  job_change: "Job change",
  still_there: "Still there",
  left: "Left",
  hiring: "Hiring",
  crm: "Your CRM",
};
export const kindLabel = (k: string) =>
  KINDS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const VIAS: Record<string, string> = {
  linkedin: "LinkedIn",
  web: "Web search",
  site: "Company site",
  crm: "Your CRM",
};
export const viaLabel = (v: string) =>
  VIAS[v] ?? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const hostOf = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

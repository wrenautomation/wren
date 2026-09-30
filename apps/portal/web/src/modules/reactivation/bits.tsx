/** Pieces Reactivation's pages share: where someone is now, why they rank, and what we found. */
import { hostOf, month, Tag } from "@wren/ui";
import type { MouseEvent, ReactNode } from "react";
import type { Now, Reason, Source } from "../../api.js";
import { at } from "./nav.js";

/** Where they are now, in words. */
export function NowCell({ now }: { now: Now | null }) {
  if (!now) return <span className="rx-quiet">Not looked up</span>;
  if (now.kind === "still_there") return <span>Still there</span>;
  if (now.kind === "left") return <Tag>Left</Tag>;
  return (
    <span>
      <Tag tone="rust">Moved</Tag> {now.company ? <b>{now.company}</b> : "somewhere new"}
      {now.title ? <span className="rx-quiet"> · {now.title}</span> : null}
    </span>
  );
}

/** What adds up to the score: "+30 Moved to a new company". */
export function Reasons({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="rx-reasons">
      {reasons.map((r) => (
        <li key={r.reason}>
          <span className="rx-pts">{r.points > 0 ? `+${r.points}` : r.points}</span> {r.reason}
        </li>
      ))}
    </ul>
  );
}

/** A name, linked to their brief when we know who it is, and their company. */
export function Who({
  name,
  firm,
  personId,
}: {
  name: string;
  firm: string;
  personId: number | null;
}) {
  return (
    <span className="rx-who">
      {personId ? (
        <a href={at("people", { person: personId })}>
          <b>{name}</b>
        </a>
      ) : (
        <b>{name}</b>
      )}
      <span className="rx-quiet"> · {firm}</span>
    </span>
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

/** A brief cites its sources with marks like [f12] or [f3, c7]. */
export const MARKS = /\[\s*([fc]\d+(?:\s*[,;]\s*[fc]\d+)*)\s*\]/gi;
/** The brief's words alone, for places too small for its sources. */
export const stripMarks = (s: string) => s.replace(MARKS, "").replace(/\s+([.,;])/g, "$1");

/** The brief with its marks as numbered links down to the sources they cite. */
export function Cited({ text, marks }: { text: string; marks: Map<string, Source> }) {
  const order = [...marks.keys()];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    out.push(text.slice(last, m.index).replace(/\s+$/, ""));
    const ids = (m[1] ?? "").split(/\s*[,;]\s*/);
    out.push(
      <sup key={m.index} className="rx-marks">
        {ids.map((id) => {
          const n = order.indexOf(id.toLowerCase()) + 1;
          return n ? (
            <a key={id} href={`#src-${id.toLowerCase()}`} onClick={(e) => jump(e, id)}>
              {n}
            </a>
          ) : null;
        })}
      </sup>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Scroll to the source inside the drawer without touching the page's address. */
function jump(e: MouseEvent, id: string) {
  e.preventDefault();
  document
    .getElementById(`src-${id.toLowerCase()}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function SourceItem({ source: s, n }: { source: Source; n: number }) {
  const host = hostOf(s.url);
  return (
    <li id={`src-${s.mark.toLowerCase()}`} className="rx-source">
      <span className="rx-source-n">{n}</span>
      <div>
        <p>
          <b>{kindLabel(s.kind)}</b>
          <span className="rx-quiet">
            {" "}
            · {viaLabel(s.via)}
            {s.observedAt ? ` · ${month(s.observedAt.slice(0, 10))}` : ""}
          </span>
        </p>
        {s.title ? <p>{s.title}</p> : null}
        {s.url && host ? (
          // The demo hides profile names, so its profile links lead nowhere: shown, not linked.
          s.url.includes("•••") ? (
            <p className="rx-quiet">{host}</p>
          ) : (
            <p>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {host}
              </a>
            </p>
          )
        ) : null}
      </div>
    </li>
  );
}

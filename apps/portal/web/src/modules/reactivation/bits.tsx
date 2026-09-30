/** Pieces Reactivation's pages share: where someone is now, why they rank, and what we found. */
import { Cite, hostOf, month, num, SourceCard, SourceList, Tag } from "@wren/ui";
import { type ReactNode, useCallback, useState } from "react";
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
  search: "Web search",
  email: "Email check",
  web: "Web search",
  site: "Company site",
  crm: "Your CRM",
};
export const viaLabel = (v: string) =>
  VIAS[v] ?? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A brief cites its sources with marks like [f12] or [f3, c7]. */
export const MARKS = /\[\s*([fc]\d+(?:\s*[,;]\s*[fc]\d+)*)\s*\]/gi;
/** The marks a line cites, lowercase, in order. */
export const marksOf = (text: string): string[] =>
  [...text.matchAll(MARKS)].flatMap((m) =>
    (m[1] ?? "").split(/\s*[,;]\s*/).map((id) => id.toLowerCase()),
  );
/** The brief's words alone, for places too small for its sources. */
export const stripMarks = (s: string) => s.replace(MARKS, "").replace(/\s+([.,;:!?])/g, "$1");

/** Picks a source by its mark and scrolls its card into view. */
export type PickSource = (mark: string) => void;

/** The brief with its marks as numbered chips pointing at the sources below. */
export function Cited({
  text,
  order,
  lit,
  onPick,
}: {
  text: string;
  /** Marks in card order, lowercase: a chip's number is its place here. */
  order: string[];
  lit?: string | null | undefined;
  onPick: PickSource;
}) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    out.push(text.slice(last, m.index).replace(/\s+$/, ""));
    const ids = [...new Set(marksOf(m[0]))];
    out.push(
      <span key={m.index} className="rx-cites">
        {ids.map((id) => {
          const n = order.indexOf(id) + 1;
          return n ? (
            <Cite
              key={id}
              n={n}
              href={`#src-${id}`}
              label={`Source ${n}`}
              on={lit === id}
              onPick={() => onPick(id)}
            />
          ) : null;
        })}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Lights a source card and brings it into view, leaving the page's address alone. */
export function useSourcePick(): [string | null, PickSource] {
  const [lit, setLit] = useState<string | null>(null);
  const pick = useCallback((mark: string) => {
    setLit(mark);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`src-${mark}`)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, []);
  return [lit, pick];
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A day as "Sep 2026", or null when it isn't one. */
const monthOf = (v: unknown) => month(str(v)) || null;
const roleAt = (title: string | null, company: string | null) =>
  [title, company].filter(Boolean).join(" at ") || null;

/** What the reading said, in a few labeled lines. Unknown kinds show none. */
export function detailOf(s: Source): [string, string][] {
  const v = s.value;
  const rows: [string, string | null][] = (() => {
    switch (s.kind) {
      case "job_change":
        return [
          ["Now", roleAt(str(v.title), str(v.to))],
          ["Before", str(v.from)],
          ["Dates", str(v.dates)],
        ];
      case "still_there":
        return str(v.reason)
          ? [["How we know", str(v.reason)]]
          : [
              ["Role", roleAt(str(v.title), str(v.company))],
              ["Dates", str(v.dates)],
            ];
      case "left": {
        const last =
          v.lastRole && typeof v.lastRole === "object"
            ? (v.lastRole as Record<string, unknown>)
            : {};
        return [
          ["Now", "No current role found"],
          ["Last role", roleAt(str(last.title), str(last.company))],
          ["Dates", str(last.dates)],
        ];
      }
      case "hiring": {
        const roles = Array.isArray(v.roles)
          ? v.roles.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
          : [];
        const count = typeof v.count === "number" ? v.count : roles.length;
        return [
          ["Open roles", num(count)],
          ...roles
            .slice(0, 3)
            .map((r): [string, string | null] => [
              "Role",
              [str(r.title), str(r.location)].filter(Boolean).join(", ") || null,
            ]),
        ];
      }
      case "crm":
        return [
          ["Status", str(v.status)],
          ["Owner", str(v.owner)],
          ["Last contact", monthOf(v.lastContactedOn)],
          ["Last placement", monthOf(v.lastPlacementOn)],
        ];
      default:
        return [];
    }
  })();
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

/** One source as a kit card. `n` matches its chips. */
export function SourceItem({
  source: s,
  n,
  lit = false,
}: {
  source: Source;
  n: number;
  lit?: boolean;
}) {
  const host = hostOf(s.url);
  const when = s.observedAt ? month(s.observedAt.slice(0, 10)) : null;
  return (
    <SourceCard
      id={`src-${s.mark.toLowerCase()}`}
      n={n}
      kind={kindLabel(s.kind)}
      meta={[viaLabel(s.via) === kindLabel(s.kind) ? null : viaLabel(s.via), when]
        .filter(Boolean)
        .join(" · ")}
      title={s.title}
      sure={s.confidence}
      detail={detailOf(s)}
      lit={lit}
      link={
        s.url && host
          ? // The demo hides profile names, so its profile links lead nowhere: shown, not linked.
            { href: s.url.includes("•••") ? null : s.url, label: host }
          : null
      }
    />
  );
}

/** The sources as numbered cards, one lit when its chip was picked. */
export function SourceCards({
  sources,
  lit,
}: {
  sources: Source[];
  lit?: string | null | undefined;
}) {
  return (
    <SourceList>
      {sources.map((s, i) => (
        <SourceItem key={s.mark} source={s} n={i + 1} lit={lit === s.mark.toLowerCase()} />
      ))}
    </SourceList>
  );
}

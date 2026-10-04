/** Pieces Reactivation's pages share: where someone is now, why they rank, and what we found. */
import { hostOf, month, num, type RecordSource, SourceCard, SourceList } from "@wren/ui";
import type { Source } from "../../api.js";

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

/** One source as a kit card's fields; its `mark` is what chips point at. */
export function cardOf(s: Source): RecordSource {
  const host = hostOf(s.url);
  const when = s.observedAt ? month(s.observedAt.slice(0, 10)) : null;
  return {
    mark: s.mark,
    kind: kindLabel(s.kind),
    meta: [viaLabel(s.via) === kindLabel(s.kind) ? null : viaLabel(s.via), when]
      .filter(Boolean)
      .join(" · "),
    title: s.title,
    sure: s.confidence,
    detail: detailOf(s),
    // The demo hides profile names, so its profile links lead nowhere: shown, not linked.
    link: s.url && host ? { href: s.url.includes("•••") ? null : s.url, label: s.url } : null,
  };
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
        <SourceCard
          key={s.mark}
          {...cardOf(s)}
          id={`src-${s.mark.toLowerCase()}`}
          n={i + 1}
          lit={lit === s.mark.toLowerCase()}
        />
      ))}
    </SourceList>
  );
}

/**
 * What `crm run` says as it works, in a client's words: one line per person or
 * company a stage handles, and one as each stage starts and ends. The portal
 * shows them live; the shape is core's (`Feed`).
 */
import { errorText, type FeedEvent } from "@wren/core";
import type { FindingDraft } from "@wren/research";
import type { HiringResult } from "@wren/research/companies";
import type { LookupResult } from "@wren/research/people";
import type { CrmStageResult } from "./run.js";
import type { CrmStage } from "./status.js";

/** Each stage as it starts. */
export const STAGE_STARTS: Record<CrmStage, string> = {
  verify: "Checking which email addresses still work",
  lookup: "Finding where each person is now",
  signals: "Checking which companies are hiring",
  score: "Ranking who to call first",
  brief: "Writing a brief on each person, with sources",
  compose: "Drafting emails for your OK",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Where a fact came from, as the portal names it. */
const VIAS: Record<string, string> = {
  search: "Web search",
  web: "Web search",
  email: "Email check",
  site: "Company site",
  crm: "Your CRM",
};
const viaName = (via: string) =>
  via.startsWith("linkedin")
    ? "LinkedIn"
    : (VIAS[via] ?? via.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
const sourceOf = (f: FoundFact) => ({ label: viaName(f.via), href: f.sourceUrl });

export const fullName = (first: string | null, last: string | null) =>
  [first, last].filter(Boolean).join(" ") || "Someone";

/** A finding as a fresh result and a stored row both carry it. */
export interface FoundFact {
  kind: string;
  value: Record<string, unknown>;
  via: string;
  sourceUrl: string | null;
}

/** The finding worth a line: a move or a departure before "still there". */
function headline(findings: FindingDraft[]): FindingDraft | null {
  const rank = (k: string) =>
    k === "job_change" ? 0 : k === "left" ? 1 : k === "still_there" ? 2 : 3;
  return [...findings].sort((a, b) => rank(a.kind) - rank(b.kind))[0] ?? null;
}

/** Where a person is now, from the finding that says so; null = we couldn't tell. */
export function whereLine(name: string, f: FoundFact | null): FeedEvent {
  const base = { step: "lookup", subject: name } as const;
  if (!f) return { ...base, kind: "did", line: `Couldn't tell for sure where ${name} is now` };
  const v = f.value;
  if (f.kind === "job_change") {
    const title = str(v.title);
    return {
      ...base,
      kind: "found",
      line: `${name} moved to ${str(v.to) ?? "a new company"}${title ? `, ${title}` : ""}`,
      source: sourceOf(f),
    };
  }
  if (f.kind === "left")
    return {
      ...base,
      kind: "found",
      line: `${name} left ${str(v.from) ?? "their company"}`,
      source: sourceOf(f),
    };
  return {
    ...base,
    kind: "did",
    line: `${name} is still at ${str(v.company) ?? "the same company"}`,
    source: sourceOf(f),
  };
}

export function lookupLine(name: string, r: LookupResult): FeedEvent {
  if (r.state === "capped")
    return {
      step: "lookup",
      subject: name,
      kind: "waiting",
      line: `${name} waits for ${r.retryAt ? day(r.retryAt) : "later"}: today's lookups are used up`,
    };
  return whereLine(name, r.state === "matched" ? headline(r.findings) : null);
}

export interface HiringOutcome {
  state: HiringResult["state"];
  finding: FoundFact | null;
  retryAt: Date | null;
}

export function hiringLine(firm: string, r: HiringOutcome): FeedEvent {
  const base = { step: "signals", subject: firm } as const;
  if (r.state === "hiring" && r.finding) {
    const n = Number(r.finding.value.count) || 0;
    return {
      ...base,
      kind: "found",
      line: `${firm} is hiring: ${n} open ${n === 1 ? "role" : "roles"}`,
      count: n,
      source: sourceOf(r.finding),
    };
  }
  if (r.state === "no_openings") return { ...base, kind: "did", line: `${firm} has no open roles` };
  if (r.state === "capped")
    return {
      ...base,
      kind: "waiting",
      line: `${firm} waits for ${r.retryAt ? day(r.retryAt) : "later"}: today's checks are used up`,
    };
  return { ...base, kind: "did", line: `Couldn't tell if ${firm} is hiring` };
}

export function briefLine(
  name: string,
  state: "written" | "empty" | "failed",
  lines: number,
): FeedEvent {
  const base = { step: "brief", subject: name } as const;
  if (state === "written")
    return {
      ...base,
      kind: "found",
      line: `Wrote a brief on ${name}: ${lines} sourced ${lines === 1 ? "line" : "lines"}`,
      count: lines,
    };
  if (state === "empty")
    return { ...base, kind: "did", line: `Nothing sure enough to say about ${name} yet` };
  return { ...base, kind: "failed", line: `The brief on ${name} didn't pass the fact check` };
}

export function composeLine(
  name: string,
  outcome: "drafted" | "approved" | "failed" | "suppressed",
): FeedEvent {
  const base = { step: "compose", subject: name } as const;
  if (outcome === "drafted")
    return { ...base, kind: "found", line: `Drafted an email to ${name}: waiting for your OK` };
  if (outcome === "approved")
    return { ...base, kind: "found", line: `Drafted an email to ${name}: approved to send` };
  if (outcome === "suppressed")
    return { ...base, kind: "did", line: `Left ${name} out: they asked not to be emailed` };
  return { ...base, kind: "failed", line: `The email to ${name} didn't pass the fact check` };
}

/** A unit that threw: the line says who, `detail` says why (operators only). */
export const failedLine = (step: CrmStage, subject: string, err: unknown): FeedEvent => ({
  step,
  kind: "failed",
  subject,
  line: `Couldn't finish ${subject}; it will be tried again`,
  detail: errorText(err),
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each stage's last line: a live run says it from its stats, the replay from the records. */
export const STAGE_DONE = {
  verify: (n: number, work: number, bounce: number) =>
    `Checked ${plural(n, "address", "addresses")}: ${work} work, ${bounce} bounce, ${n - work - bounce} can't tell`,
  lookup: (n: number, moved: number, left: number) =>
    `Looked up ${plural(n, "person", "people")}: ${moved} moved, ${left} left`,
  signals: (n: number, hiring: number) =>
    `Checked ${plural(n, "company", "companies")}: ${hiring} hiring`,
  score: () => "Ranked everyone by who to call first",
  brief: (n: number) => `Wrote ${plural(n, "brief")}`,
  compose: (n: number) => `Drafted ${plural(n, "email")}`,
} as const;

/** The stage's last line, from its stats; `count` is how many it handled. */
export function stageDone(r: CrmStageResult): FeedEvent {
  if (r.stats.aborted)
    return {
      step: r.stage,
      kind: "waiting",
      line: "Stopped here for now",
      detail: r.stats.aborted,
    };
  const [line, count] = ((): [string, number | null] => {
    switch (r.stage) {
      case "verify": {
        const v = r.stats;
        // The verdicts count addresses; `selected` counts candidates.
        const n = v.valid + v.invalid + v.risky + v.catch_all + v.local_invalid + v.local_errors;
        return [STAGE_DONE.verify(n, v.valid, v.invalid + v.local_invalid), n];
      }
      case "lookup": {
        const v = r.stats;
        return [
          STAGE_DONE.lookup(v.selected, v.findings.job_change ?? 0, v.findings.left ?? 0),
          v.selected,
        ];
      }
      case "signals":
        return [STAGE_DONE.signals(r.stats.selected, r.stats.hiring), r.stats.selected];
      case "score":
        return [STAGE_DONE.score(), null];
      case "brief":
        return [STAGE_DONE.brief(r.stats.written), r.stats.written];
      case "compose":
        return [STAGE_DONE.compose(r.stats.drafted), r.stats.drafted];
    }
  })();
  return { step: r.stage, kind: "done", line, count };
}

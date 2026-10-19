/**
 * Which entry opened a journey (designs/2026-10-18-journeys.md, "Attribution"). Pure: the step
 * reads the body and the person's first touch, and passes them in.
 */
import type { Entry, FunnelBody } from "./model.js";

/** What a cause says about where the person came from. All optional. */
export interface CauseFacts {
  /** An entry id the cause names outright (a `/go/` link, a manual open). */
  entry?: string;
  channel?: string;
  campaign?: string;
  /** A prior journey: its funnel and the stage it entered. */
  funnel?: string;
  stage?: string;
  /** A research list or discovery run id. */
  source?: string;
  /** A saved query's id. */
  group?: string;
}

const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/** Does this cause belong to this entry? A `manual` entry only matches by id. */
function matches(e: Entry, c: CauseFacts): boolean {
  if (e.kind === "manual") return false;
  if (e.kind === "funnel")
    return (
      !!e.funnel &&
      c.funnel === e.funnel.id &&
      (e.funnel.at === undefined || c.stage === e.funnel.at)
    );
  if (e.kind === "sourced") return !!e.source && c.source === e.source;
  if (e.kind === "group") return !!e.group && c.group === e.group;
  // organic, outbound, ads, referral: by channel and campaign. An entry with neither matches nothing.
  if (e.channel === undefined && e.campaign === undefined) return false;
  return (
    (e.channel === undefined || same(e.channel, c.channel)) &&
    (e.campaign === undefined || same(e.campaign, c.campaign))
  );
}

/** The stage an entry opens a journey at. */
export const entryTo = (body: FunnelBody, e: Entry): string | undefined =>
  e.to ?? body.stages[0]?.key;

/** The stages a journey may open at: every entry's `to`, default the first stage. */
export function entryStages(body: FunnelBody): string[] {
  const first = body.stages[0]?.key;
  if (first === undefined) return [];
  if (body.entries.length === 0) return [first];
  return [...new Set(body.entries.map((e) => e.to ?? first))];
}

/**
 * The entry that opened this journey: the one the cause names, else the first in priority order
 * the cause matches, else the first the person's first touch matches, else `manual`.
 */
export function entryOf(
  body: FunnelBody,
  cause: CauseFacts,
  firstTouch?: CauseFacts | null,
): Entry {
  const named = cause.entry ? body.entries.find((e) => e.id === cause.entry) : undefined;
  if (named) return named;
  const byCause = body.entries.find((e) => matches(e, cause));
  if (byCause) return byCause;
  const byTouch = firstTouch ? body.entries.find((e) => matches(e, firstTouch)) : undefined;
  if (byTouch) return byTouch;
  return body.entries.find((e) => e.kind === "manual") ?? { id: "manual", kind: "manual" };
}

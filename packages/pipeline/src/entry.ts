/**
 * Which source opened a journey (designs/2026-10-19-business-map.md). Pure: the step reads the
 * body and the person's first touch, and passes them in. A source is a node of kind `source`; a
 * parked one opens nothing.
 */
import type { ShapeBody, ShapeEdge, SourceNode } from "./model.js";

/** What a cause says about where the person came from. All optional. */
export interface CauseFacts {
  /** A source id the cause names outright (a `/go/` link, a manual open). */
  entry?: string;
  channel?: string;
  /** The platform a link names (utm_source): meta for a paid touch, whose channel is ads. */
  platform?: string;
  campaign?: string;
  /** The ad campaign's id in `ad_days`, when `campaign` is a name or a `/go/` word that names one. */
  adCampaign?: string;
  /** A research list or discovery run id. */
  source?: string;
  /** A saved query's id. */
  group?: string;
}

/** The entry a journey has when no source claims it. */
export const MANUAL = "manual";

const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/** Does this cause belong to this source? A `manual` source only matches by id. */
function matches(s: SourceNode, c: CauseFacts): boolean {
  if (s.via === "manual") return false;
  if (s.via === "sourced") return !!s.source && c.source === s.source;
  if (s.via === "group") return !!s.group && c.group === s.group;
  // organic, outbound, ads, referral: by channel and campaign. A source with neither matches nothing.
  // A channel is the cause's channel or its platform (`ads` or `meta`); a campaign is the word or
  // the ad campaign's id.
  if (s.channel === undefined && s.campaign === undefined) return false;
  return (
    (s.channel === undefined || same(s.channel, c.channel) || same(s.channel, c.platform)) &&
    (s.campaign === undefined || same(s.campaign, c.campaign) || same(s.campaign, c.adCampaign))
  );
}

/** Every source that may open journeys, in body order. */
export const liveSources = (body: ShapeBody): SourceNode[] =>
  body.nodes.filter((n): n is SourceNode => n.kind === "source" && !n.parked);

/** The flow edge from a source to a node, if there is one. */
export const sourceEdge = (body: ShapeBody, source: string, to: string): ShapeEdge | undefined =>
  body.edges.find((e) => e.kind === "flow" && e.from === source && e.to === to);

/** The sources that may open a journey at `to`: live, with a flow edge to it. */
export const sourcesInto = (body: ShapeBody, to: string): SourceNode[] =>
  liveSources(body).filter((s) => sourceEdge(body, s.id, to));

/**
 * May this cause open a journey at `to` for a person with none? A manual open (`byHand`) needs a
 * live source with an edge to `to`. Else it needs such a source that causes feed (organic,
 * outbound, ads, referral), or a group or sourced source the cause names. So a manual source
 * never lets the node's own trigger open journeys for strangers.
 */
export function opensAt(body: ShapeBody, to: string, byHand: boolean, c: CauseFacts): boolean {
  const here = sourcesInto(body, to);
  if (here.length === 0) return false;
  if (byHand) return true;
  return here.some((s) => {
    if (s.via === "group") return !!s.group && c.group === s.group;
    if (s.via === "sourced") return !!s.source && c.source === s.source;
    return s.via !== "manual";
  });
}

/** The nodes a journey may open at: every live source's targets, once each, in edge order. */
export function entryNodes(body: ShapeBody): string[] {
  const live = new Set(liveSources(body).map((s) => s.id));
  return [
    ...new Set(body.edges.filter((e) => e.kind === "flow" && live.has(e.from)).map((e) => e.to)),
  ];
}

/**
 * The source that opened this journey: the one the cause names, else the first in body order the
 * cause matches, else the first the person's first touch matches, else a manual source, else null
 * (the caller records `MANUAL`). With `to`, sources that open at `to` come first.
 */
export function entryOf(
  body: ShapeBody,
  cause: CauseFacts,
  firstTouch?: CauseFacts | null,
  to?: string,
): SourceNode | null {
  const live = liveSources(body);
  const named = cause.entry ? live.find((s) => s.id === cause.entry) : undefined;
  if (named) return named;
  const here = to ? live.filter((s) => sourceEdge(body, s.id, to)) : [];
  const pool = here.length > 0 ? here : live;
  const byCause = pool.find((s) => matches(s, cause));
  if (byCause) return byCause;
  const byTouch = firstTouch ? pool.find((s) => matches(s, firstTouch)) : undefined;
  if (byTouch) return byTouch;
  return pool.find((s) => s.via === "manual") ?? null;
}

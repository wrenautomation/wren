/**
 * Research's limits (designs/2026-10-26-limits.md): each bucket and daily count, with its code
 * default. The `limits` table in main overrides one (`wren limits set`, Accounts in the portal).
 * Most parts run on Wren's niches only or spend one pool for Wren and every client, so the
 * Wren-wide row is the one that holds.
 */
import type { Bucket } from "@wren/core/buckets";
import { bucketOf, type LimitDef, limitOf } from "@wren/core/limits";
import type { Queryable } from "@wren/db";
import { AD_LIBRARY_BUCKET } from "./enrichment/ad-library.js";
import { EXA_SEARCH_BUCKET } from "./enrichment/exa-search.js";
import { GROUP_READ_BUCKET, GROUP_SEARCH_BUCKET } from "./enrichment/fb-groups.js";
import { INSTAGRAM_BUCKET } from "./enrichment/instagram.js";
import { TRIGGERS_BUCKET } from "./enrichment/news-triggers.js";
import { GOOGLE_PER_DAY } from "./enrichment/profiles.js";
import { TEAM_BUCKET } from "./enrichment/team.js";
import { YOUTUBE_BUCKET } from "./enrichment/youtube.js";
import { YOUTUBE_SEARCH_BUCKET } from "./enrichment/youtube-search.js";
import { COLLECTORS } from "./signals/collectors.js";
import { type Collector, SIGNALS_GOOGLE_PER_DAY } from "./signals/index.js";

const bucket = (
  name: string,
  b: Bucket,
  scope: LimitDef["scope"],
  unit: string,
  why: string,
): LimitDef => ({ name, unit, why, perDay: b.perDay, burst: b.burst, scope });

const GOOGLE_LIMIT: LimitDef = {
  name: "research.google",
  unit: "Google searches a local day",
  why: "profiles, team, company events and signals together, under autobrowse's `web` cap",
  perDay: GOOGLE_PER_DAY,
  burst: null,
  scope: "shared",
};
const SIGNALS_GOOGLE_LIMIT: LimitDef = {
  name: "research.signals.google",
  unit: "Google searches a local day",
  why: "the signal collectors' share of research.google",
  perDay: SIGNALS_GOOGLE_PER_DAY,
  burst: null,
  scope: "shared",
};
export const INSTAGRAM_LIMIT = bucket(
  "research.instagram",
  INSTAGRAM_BUCKET,
  "shared",
  "Instagram profile reads",
  "Meta's business discovery, about 200 calls an hour",
);
export const YOUTUBE_LIMIT = bucket(
  "research.youtube",
  YOUTUBE_BUCKET,
  "shared",
  "YouTube channel reads on Wren's key",
  "3 of the key's 10,000 units a day each; a client on its own key has its key's quota",
);
export const YOUTUBE_SEARCH_LIMIT = bucket(
  "research.youtube-search",
  YOUTUBE_SEARCH_BUCKET,
  "wren",
  "YouTube searches",
  "101 units each, from what channel reads leave",
);
export const AD_LIBRARY_LIMIT = bucket(
  "research.ad-library",
  AD_LIBRARY_BUCKET,
  "wren",
  "Ad Library keyword reads",
  "with group reads, under autobrowse's `fb-public` cap",
);
export const GROUP_SEARCH_LIMIT = bucket(
  "research.group-search",
  GROUP_SEARCH_BUCKET,
  "wren",
  "Facebook group searches",
  "a Google page or two each, on the Mac's IP",
);
export const GROUP_READ_LIMIT = bucket(
  "research.group-read",
  GROUP_READ_BUCKET,
  "wren",
  "Facebook group page reads",
  "with Ad Library, under autobrowse's `fb-public` cap",
);
export const EXA_SEARCH_LIMIT = bucket(
  "research.exa-search",
  EXA_SEARCH_BUCKET,
  "wren",
  "Exa searches",
  "the free credits a month",
);
export const TRIGGERS_LIMIT = bucket(
  "research.triggers",
  TRIGGERS_BUCKET,
  "wren",
  "news searches",
  "RSS is free; this spaces the reads",
);
export const TEAM_LIMIT = bucket(
  "research.team",
  TEAM_BUCKET,
  "wren",
  "team searches",
  "7 mills each, from the free credits a month",
);

/** A signal collector's subjects a day: one pool for Wren and every client (`collectorRoom`). */
const collectorLimit = (c: Pick<Collector, "name" | "bucket">): LimitDef =>
  bucket(`research.signals.${c.name}`, c.bucket, "shared", `${c.name} subjects`, "signal reads");

export const RESEARCH_LIMITS: readonly LimitDef[] = [
  GOOGLE_LIMIT,
  SIGNALS_GOOGLE_LIMIT,
  INSTAGRAM_LIMIT,
  YOUTUBE_LIMIT,
  YOUTUBE_SEARCH_LIMIT,
  AD_LIBRARY_LIMIT,
  GROUP_SEARCH_LIMIT,
  GROUP_READ_LIMIT,
  EXA_SEARCH_LIMIT,
  TRIGGERS_LIMIT,
  TEAM_LIMIT,
  ...COLLECTORS.map(collectorLimit),
];

/** The collectors with their stored buckets. */
export async function collectorsWithLimits<C extends Collector>(
  main: Queryable,
  collectors: readonly C[],
): Promise<C[]> {
  const out: C[] = [];
  for (const c of collectors)
    out.push({ ...c, bucket: await bucketOf(main, null, collectorLimit(c)) });
  return out;
}

/** Google's day, all research and the collectors' share. */
export async function googleLimits(main: Queryable): Promise<{ perDay: number; signals: number }> {
  return {
    perDay: (await limitOf(main, null, GOOGLE_LIMIT)).perDay,
    signals: (await limitOf(main, null, SIGNALS_GOOGLE_LIMIT)).perDay,
  };
}

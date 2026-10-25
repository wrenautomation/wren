/**
 * The client of autobrowse's fetch ladder, `web GET /fetch` (designs/2026-10-18-fetch-ladder.md).
 * The render pass calls it for a blocked page; autobrowse climbs `impersonate`, `render` and
 * `exit` on the Mac. A block is data in the answer. A failed call is the other result.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import type { LadderTier } from "./tier-memory.js";

/** One rung the ladder tried, and what it met there. */
export interface FetchStep {
  tier: string;
  status: number | null;
  block: string | null;
}

/** What `web GET /fetch` answers (`Fetched`): the fields this side reads. */
interface Fetched {
  finalUrl: string;
  status: number | null;
  html: string;
  /** The rung that answered: the last one tried. */
  tier: LadderTier;
  /** null: a usable page; else the signal the last rung still hit. */
  block: string | null;
  tries: FetchStep[];
}

/** `cap`: the day's `fetch` bucket is spent (429). `offline`: any other failed call. */
type LadderFailure = "cap" | "offline";

/** One `web GET /fetch`. A failed call is a result, never a throw. */
export async function fetchLadder(
  sites: SiteClient,
  url: string,
  from: LadderTier,
): Promise<{ fetched: Fetched } | { failed: LadderFailure }> {
  try {
    return { fetched: await sites.call<Fetched>("web", "GET", "/fetch", { url, from }) };
  } catch (err) {
    return { failed: err instanceof SiteCallError && err.status === 429 ? "cap" : "offline" };
  }
}

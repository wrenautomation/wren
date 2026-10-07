/**
 * Calling autobrowse sites politely: a short 429 is pacing (wait, ask again),
 * a long one is a daily cap (stop asking until then). People and company
 * research share one rule, so a cap means the same thing everywhere.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";

/**
 * A 429 asking for this long or less is pacing: wait and ask again. Longer is
 * a daily cap. autobrowse refuses a paced call once its slot is 2+ minutes out.
 */
export const PACE_MAX_S = 300;
const PACE_TRIES = 3;

/** A daily cap said stop: when to try again. */
export class Capped extends Error {
  constructor(
    readonly site: string,
    readonly retryAt: Date,
    readonly why: string,
  ) {
    super(why);
  }
}

/** A 4xx that says no to this one request (private profile, not found); null for anything else. */
export const refusedBy = (err: unknown): number | null =>
  err instanceof SiteCallError && err.status >= 400 && err.status < 500 ? err.status : null;

/**
 * A metered site's read that failed (5xx) was still spent: one is enough to
 * stop asking that site for the rest of a run. LinkedIn's reads are a
 * person's own account, so a stage stops on the first.
 */
export const failedRead = (err: unknown, site: string): boolean =>
  err instanceof SiteCallError && err.site === site && err.status >= 500;

/** A search that said stop: until when (null = the rest of the day), and why. */
export interface Stopped {
  until: Date | null;
  why: string;
}

/**
 * Did this search (Google through `web`) say stop? A cap stops it until the
 * cap lifts; a failed read (a sorry page, a CAPTCHA) for the day. Null for
 * anything else. A stopped search is skipped, never fatal: Exa carries on.
 */
export function searchStopped(err: unknown, site: string): Stopped | null {
  if (err instanceof Capped && err.site === site) return { until: err.retryAt, why: err.why };
  if (failedRead(err, site)) return { until: null, why: (err as Error).message };
  return null;
}

/** Seconds a 429 asks us to wait; null for any other error. No figure = an hour. */
export function retryAfter(err: unknown): number | null {
  if (!(err instanceof SiteCallError) || err.status !== 429) return null;
  return Number(/retry after (\d+)s/.exec(err.message)?.[1] ?? 3_600);
}

export const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * SiteClient.call that waits out pacing (a short 429) and turns a daily cap
 * (a long one) into Capped.
 */
export function paced(sites: SiteClient, clock: () => Date, sleep: (ms: number) => Promise<void>) {
  return async <T>(...args: Parameters<SiteClient["call"]>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await sites.call<T>(...args);
      } catch (err) {
        const secs = retryAfter(err);
        if (secs === null || !(err instanceof SiteCallError)) throw err;
        if (secs > PACE_MAX_S || attempt >= PACE_TRIES)
          throw new Capped(err.site, new Date(clock().getTime() + secs * 1000), err.message);
        await sleep(secs * 1000);
      }
    }
  };
}

/** The GCRA bucket lives in core, where vendor read limits use it too. */
export { type Bucket, bucketRoom } from "@wren/core/buckets";

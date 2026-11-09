/**
 * The people map's pass (designs/2026-10-15-people-map.md), one per workspace: loose handles
 * keyed, site counts read (Wren's, when the lander's export is set), then the hot profiles' rows
 * rebuilt (`hotProfiles`; every profile once a day) and `stage` / `warmth` mirrored as traits. `PeopleMap/fleet` (Wren's) and
 * `PeopleMap/<client>/fleet` run it on `wake`; row triggers wake it at commit. The warm gate never
 * waits on it: it reads live.
 */

import type { Db } from "@wren/db";
import * as restate from "@wren/runtime";
import {
  type HotMark,
  hotMark,
  hotProfiles,
  keyLooseHandles,
  readSiteCounts,
  refreshPeople,
  type SiteCountReader,
} from "./people-map.js";
import { exclusiveHandler, NO_INPUT, sharedHandler } from "./restate/form.js";
import { clientOfKey } from "./restate/keys.js";

/** The net's beat. */
/** The least time between two passes of one workspace. */
const PEOPLE_MAP_GAP_MS = 60_000;
/** Every profile rebuilt this often: title, niche and headcount edits, and lines deleted. */
const PEOPLE_MAP_FULL_MS = 24 * 3_600_000;

interface PeopleMapStats {
  handles: { seen: number; keyed: number };
  siteReads: number;
  written: number;
  dropped: number;
  traits: number;
  /** Profiles rebuilt; null on a full pass. */
  hot: number | null;
  mark: HotMark;
  ms: number;
}

/**
 * One workspace's pass: the profiles hot since `mark`, or every profile without one. Pure of
 * Restate, so tests and the CLI run it on a database.
 */
export async function peopleMapPass(
  db: Db,
  o: { site?: SiteCountReader | null; mark?: HotMark | null } = {},
): Promise<PeopleMapStats> {
  const t0 = Date.now();
  const handles = await keyLooseHandles(db);
  const siteReads = o.site ? await readSiteCounts(db, o.site) : 0;
  if (!o.mark) {
    const mark = await hotMark(db);
    const r = await refreshPeople(db);
    return { handles, siteReads, ...r, hot: null, mark, ms: Date.now() - t0 };
  }
  const { ids, mark } = await hotProfiles(db, o.mark);
  const r = await refreshPeople(db, { ids });
  return { handles, siteReads, ...r, hot: ids.length, mark, ms: Date.now() - t0 };
}

interface PeopleMapDeps {
  main: Db;
  clientDb(id: string): Db;
  /** Every client with a database, for the net. */
  clients(): Promise<string[]>;
  /** Counts Wren's visitors' site logs; unset, visits come from visitor keys alone. */
  site?: SiteCountReader | null;
}

const PEOPLE_MAP = { name: "PeopleMap" } as const;
/** Wren's own pass's key; a client's is `<client>/fleet`. */
const PEOPLE_MAP_KEY = "fleet";
const LAST = "last";
/** Where the last good pass left off, and when the last full one ran. */
const MARK = "mark";

/** A workspace's pass on `wake`, and its last outcome on `status`. */
export function makePeopleMap(d: PeopleMapDeps) {
  return restate.object({
    name: PEOPLE_MAP.name,
    handlers: {
      wake: exclusiveHandler({ input: NO_INPUT }, async (ctx: restate.ObjectContext) => {
        const client = ctx.key === PEOPLE_MAP_KEY ? null : (clientOfKey(ctx.key)?.client ?? null);
        if (ctx.key !== PEOPLE_MAP_KEY && !client) return { skipped: "no such workspace" };
        const now = new Date(await ctx.date.now());
        const last = await ctx.get<{ at: string }>(LAST);
        if (last && now.getTime() - Date.parse(last.at) < PEOPLE_MAP_GAP_MS)
          return { skipped: "soon" };
        const kept = await ctx.get<HotMark & { fullAt: string }>(MARK);
        const full = !kept || now.getTime() - Date.parse(kept.fullAt) >= PEOPLE_MAP_FULL_MS;
        const mark = full ? null : { keyAfter: kept.keyAfter, since: kept.since };
        // A failed pass is said in `status` and tried by the next wake, never retried hot.
        const out = await ctx.run("pass", async () => {
          try {
            return client
              ? await peopleMapPass(d.clientDb(client), { mark })
              : await peopleMapPass(d.main, { site: d.site ?? null, mark });
          } catch (err) {
            return { error: String(err).slice(0, 5000) };
          }
        });
        // A failed pass keeps the old mark: the next one covers its window.
        if ("mark" in out)
          ctx.set(MARK, { ...out.mark, fullAt: full ? now.toISOString() : (kept?.fullAt ?? "") });
        ctx.set(LAST, { at: now.toISOString(), ...out });
        return out;
      }),
      status: sharedHandler({ input: NO_INPUT }, async (ctx: restate.ObjectSharedContext) => ({
        key: ctx.key,
        last: (await ctx.get(LAST)) ?? null,
      })),
    },
  });
}

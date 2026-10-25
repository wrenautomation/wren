/**
 * The people map's pass (designs/2026-10-15-people-map.md), one per workspace: loose handles
 * keyed, site counts read (Wren's, when the lander's export is set), then every profile's row
 * rebuilt and `stage` / `warmth` mirrored as traits. `PeopleMap/fleet` (Wren's) and
 * `PeopleMap/<client>/fleet` run it on `wake`; `PeopleMapNet/all` wakes every workspace each
 * 15 minutes. The warm gate never waits on it: it reads live.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import {
  keyLooseHandles,
  readSiteCounts,
  refreshPeople,
  type SiteCountReader,
} from "./people-map.js";
import { exclusiveHandler, NO_INPUT, sharedHandler } from "./restate/form.js";
import { clientKey, clientOfKey } from "./restate/keys.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/loop.js";

/** The net's beat. */
const PEOPLE_MAP_NET_MS = 15 * 60_000;
/** The least time between two passes of one workspace. */
const PEOPLE_MAP_GAP_MS = 60_000;

interface PeopleMapStats {
  handles: { seen: number; keyed: number };
  siteReads: number;
  written: number;
  dropped: number;
  traits: number;
  ms: number;
}

/** One workspace's pass. Pure of Restate, so tests and the CLI run it on a database. */
export async function peopleMapPass(
  db: Db,
  o: { site?: SiteCountReader | null } = {},
): Promise<PeopleMapStats> {
  const t0 = Date.now();
  const handles = await keyLooseHandles(db);
  const siteReads = o.site ? await readSiteCounts(db, o.site) : 0;
  const r = await refreshPeople(db);
  return { handles, siteReads, ...r, ms: Date.now() - t0 };
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

type Self = { wake: (ctx: restate.ObjectContext) => Promise<unknown> };

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
        // A failed pass is said in `status` and tried by the next wake, never retried hot.
        const out = await ctx.run("pass", async () => {
          try {
            return client
              ? await peopleMapPass(d.clientDb(client))
              : await peopleMapPass(d.main, { site: d.site ?? null });
          } catch (err) {
            return { error: String(err).slice(0, 5000) };
          }
        });
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

/** `PeopleMapNet/all`: every 15 minutes, a wake to Wren's people map and every client's. */
export function makePeopleMapNet(d: Pick<PeopleMapDeps, "main" | "clients">) {
  return makeLoopObject("PeopleMapNet", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<{ woken: number; keys: string[] }>(ctx, d.main, now, {
      name: "people map net",
      ledger: { command: "people map net", argv: { daemon: true } },
      body: async () => {
        const keys = [
          PEOPLE_MAP_KEY,
          ...(await d.clients()).map((c) => clientKey(c, PEOPLE_MAP_KEY)),
        ];
        return { woken: keys.length, keys };
      },
      delayAfter: () => PEOPLE_MAP_NET_MS,
      retryMs: PEOPLE_MAP_NET_MS,
    })) as PassOutcome<{ woken: number; keys: string[] }>;
    for (const key of outcome.stats?.keys ?? []) ctx.objectSendClient<Self>(PEOPLE_MAP, key).wake();
    return outcome;
  });
}

export type PeopleMapService = ReturnType<typeof makePeopleMap>;
export type PeopleMapNetService = ReturnType<typeof makePeopleMapNet>;

/**
 * The touch feed (designs/2026-10-18-journeys.md, "Causes"): `recordTouch` has many writers
 * outside Restate, so the executor hears a touch from this tail loop, not from them. `TouchToJourney/all`
 * reads each workspace's untold touches (`fired_at` null), tells the executor once per touch
 * (`trigger.touch`, subject `touch:<id>`, event kind `person`), then marks them told. At least
 * once (WA-1062, designs/2026-11-04-at-least-once.md): a crash between the send and the mark tells
 * a touch again, and the executor enters a subject once. A late commit is read on the next pass,
 * so nothing waits to settle. A new touch wakes it at commit (`wren_wake`, migration 0353); the
 * net runs every 15 minutes (designs/2026-11-01-loop-calls.md).
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { executorFire, type Fired } from "./executor.js";
import { makeLoopObject, runPass } from "./restate/loop.js";

/** The most touches told per workspace in one pass; the rest go on the next. */
const TOUCH_BATCH = 200;
/** The net's beat: a new touch wakes the feed at commit. */
const TOUCH_FEED_MS = 15 * 60_000;
const TOUCH_FEED = "TouchToJourney";
/** The id cursors before WA-1062: cleared on the first pass. */
const OLD_CURSORS = "cursors";

type Row = Record<string, unknown>;
const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

const idList = (ids: readonly number[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** Whether the workspace keeps touches at all. */
async function hasTouches(db: Queryable): Promise<boolean> {
  const [r] = await rows(db, sql`select to_regclass('public.touches') is not null yes`);
  return r?.yes === true;
}

/** One workspace's untold touch ids, oldest first; null when it keeps no touches. Pure of Restate. */
export async function untoldTouches(db: Queryable, limit = TOUCH_BATCH): Promise<number[] | null> {
  if (!(await hasTouches(db))) return null;
  const got = await rows(
    db,
    sql`select id from touches where fired_at is null order by id limit ${limit}`,
  );
  return got.map((r) => Number(r.id));
}

/** Marks `ids` told, after their fires are journaled. */
export async function markTouchesFired(db: Queryable, ids: readonly number[]): Promise<void> {
  if (!ids.length) return;
  await db.execute(
    sql`update touches set fired_at = now() where id in (${idList(ids)}) and fired_at is null`,
  );
}

/** The executor's fire for one touch: the facts it is heard by and the event it enters with. */
export function touchFired(client: string | null, t: TouchRow): Fired {
  const data: Record<string, unknown> = {
    touch: t.id,
    kind: t.kind,
    direction: t.direction,
    platform: t.platform,
    handle: t.handle,
    account: t.account,
    url: t.url,
    text: t.text ? t.text.slice(0, 5000) : null,
    at: t.at,
    // The writer: a journey can skip `following` (a follow list read back, made long ago).
    source: t.source,
    // The key `journey.move` finds the person by, and the profile itself when the key has one.
    [`handle:${t.platform}`]: t.handle,
    ...(t.profile === null ? {} : { profile: t.profile }),
  };
  return {
    client,
    facts: { trigger: "trigger.touch", kind: t.kind, direction: t.direction, platform: t.platform },
    event: { subject: `touch:${t.id}`, kind: "person", data },
  };
}

export interface TouchRow {
  id: number;
  kind: string;
  direction: string;
  platform: string;
  handle: string;
  account: string | null;
  url: string | null;
  text: string | null;
  at: string;
  source: string;
  profile: number | null;
}

/** The touches `ids`, with their handle, platform and the profile that handle keys to. */
export async function touchRows(db: Queryable, ids: readonly number[]): Promise<TouchRow[]> {
  if (!ids.length) return [];
  const got = await rows(
    db,
    sql`select t.id, t.kind, t.direction, t.account, t.url, t.text, t.at, t.source, h.platform, h.handle,
        (select k.profile_id from profile_keys k
          where k.kind = 'handle:' || h.platform and k.value = h.handle limit 1) profile
      from touches t join social_handles h on h.id = t.handle_id
      where t.id in (${idList(ids)}) order by t.id`,
  );
  return got.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    direction: String(r.direction),
    platform: String(r.platform),
    handle: String(r.handle),
    account: (r.account as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    text: (r.text as string | null) ?? null,
    at: new Date(r.at as string | Date).toISOString(),
    source: String(r.source),
    profile: r.profile === null || r.profile === undefined ? null : Number(r.profile),
  }));
}

interface TouchToJourneyDeps {
  main: Db;
  clientDb(id: string): Db;
  /** Every client with a database. */
  clients(): Promise<string[]>;
}

interface TouchToJourneyStats {
  /** Touches told this pass. */
  told: number;
  /** What each workspace read, for the events step. */
  batches: { client: string | null; ids: number[] }[];
  /** Client workspaces that failed to read; Wren's own failing fails the pass. */
  errors: string[];
}

/** `TouchToJourney/all`: each workspace's untold touches told to the executor, on a new touch or the net. */
export function makeTouchToJourney(d: TouchToJourneyDeps) {
  const dbOf = (client: string | null) => (client ? d.clientDb(client) : d.main);
  return makeLoopObject(TOUCH_FEED, async (ctx: restate.ObjectContext) => {
    ctx.clear(OLD_CURSORS);
    const outcome = await runPass<TouchToJourneyStats>(ctx, d.main, {
      name: "touch feed",
      ledger: { command: "touch feed", argv: { daemon: true } },
      body: async () => {
        const batches: TouchToJourneyStats["batches"] = [];
        const errors: string[] = [];
        const work = [null, ...(await d.clients())];
        for (const client of work) {
          try {
            const ids = await untoldTouches(dbOf(client));
            if (ids?.length) batches.push({ client, ids });
          } catch (err) {
            // Wren's own workspace failing fails the pass; a client's is said and skipped.
            if (!client) throw err;
            errors.push(`${client}: ${String(err).slice(0, 2000)}`);
          }
        }
        return { told: batches.reduce((n, b) => n + b.ids.length, 0), batches, errors };
      },
      delayAfter: (s) =>
        s.batches.some((b) => b.ids.length >= TOUCH_BATCH) ? 5_000 : TOUCH_FEED_MS,
      retryMs: TOUCH_FEED_MS,
    });
    const batches = outcome.stats?.batches ?? [];
    if (!batches.length) return outcome;
    // Built in their own step, so the pass's record keeps ids only.
    const fires = await ctx.run("touch events", async () => {
      const out: Fired[] = [];
      for (const b of batches)
        for (const t of await touchRows(dbOf(b.client), b.ids)) out.push(touchFired(b.client, t));
      return out;
    });
    for (const f of fires) executorFire(ctx, f);
    // After the sends are journaled: a crash before this tells them again, never skips them.
    await ctx.run("touches told", async () => {
      for (const b of batches)
        try {
          await markTouchesFired(dbOf(b.client), b.ids);
        } catch (err) {
          // A client's failing: told again next pass. Wren's own retries the step.
          if (!b.client) throw err;
          console.warn(`touch feed: ${b.client} not marked: ${String(err).slice(0, 500)}`);
        }
    });
    return outcome;
  });
}

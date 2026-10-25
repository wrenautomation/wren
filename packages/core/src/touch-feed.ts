/**
 * The touch feed (designs/2026-10-18-journeys.md, "Causes"): `recordTouch` has many writers
 * outside Restate, so the spine hears a touch from this tail loop, not from them. `TouchFeed/all`
 * reads each workspace's `touches` past its cursor every minute and tells the spine once per new
 * touch (`trigger.touch`, subject `touch:<id>`, event kind `person`). A missed tick is caught up
 * by the next. The cursors live in loop state. A workspace's first pass starts at its newest
 * touch: history is never told. Only rows older than `SETTLE_MS` are read, so a slow writer's
 * lower id that commits late is not skipped.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { makeLoopObject, runPass } from "./restate/loop.js";
import { type Fired, spineFire } from "./spine.js";

/** The most touches told per workspace in one pass; the rest go on the next. */
export const TOUCH_BATCH = 200;
/** A touch is read this long after it was written. */
export const SETTLE_MS = 30_000;
/** The beat between passes. */
export const TOUCH_FEED_MS = 60_000;
/** The key of Wren's own workspace in the cursors; a client's is its id. */
export const WREN_CURSOR = "wren";
export const TOUCH_FEED = "TouchFeed";
const CURSORS = "cursors";

/** Where each workspace's feed got to: the last touch id told. */
export type Cursors = Record<string, number>;

/**
 * A workspace's next cursor. None yet: start at its newest touch, telling none. Else the last id
 * read, or where it was when nothing new came.
 */
export function nextCursor(cursor: number | undefined, read: readonly number[], newest: number) {
  if (cursor === undefined) return newest;
  return read.length ? Math.max(cursor, read[read.length - 1] as number) : cursor;
}

type Row = Record<string, unknown>;
const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

/** Whether the workspace keeps touches at all. */
export async function hasTouches(db: Queryable): Promise<boolean> {
  const [r] = await rows(db, sql`select to_regclass('public.touches') is not null yes`);
  return r?.yes === true;
}

/** The newest touch id, 0 when none. */
export async function newestTouch(db: Queryable): Promise<number> {
  const [r] = await rows(db, sql`select coalesce(max(id), 0) id from touches`);
  return Number(r?.id ?? 0);
}

/** The ids past `after` that have settled (written before `now` less `SETTLE_MS`), oldest first. */
export async function settledAfter(
  db: Queryable,
  after: number,
  now: Date,
  limit = TOUCH_BATCH,
): Promise<number[]> {
  const got = await rows(
    db,
    sql`select id from touches
      where id > ${after} and created_at < ${new Date(now.getTime() - SETTLE_MS).toISOString()}::timestamptz
      order by id limit ${limit}`,
  );
  return got.map((r) => Number(r.id));
}

/** One workspace's pass: the ids to tell and where the cursor goes. Pure of Restate. */
export async function touchPass(
  db: Queryable,
  cursor: number | undefined,
  now: Date,
): Promise<{ ids: number[]; next: number } | null> {
  if (!(await hasTouches(db))) return null;
  if (cursor === undefined) return { ids: [], next: await newestTouch(db) };
  const ids = await settledAfter(db, cursor, now);
  return { ids, next: nextCursor(cursor, ids, 0) };
}

/** The spine's fire for one touch: the facts it is heard by and the event it enters with. */
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
      where t.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) order by t.id`,
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

export interface TouchFeedDeps {
  main: Db;
  clientDb(id: string): Db;
  /** Every client with a database. */
  clients(): Promise<string[]>;
}

export interface TouchFeedStats {
  /** Touches told this pass. */
  told: number;
  /** Where each workspace's cursor goes. */
  cursors: Cursors;
  /** What each workspace read, for the events step. */
  batches: { client: string | null; ids: number[] }[];
  /** Client workspaces that failed to read; Wren's own failing fails the pass. */
  errors: string[];
}

/** `TouchFeed/all`: every minute, each workspace's new touches told to the spine. */
export function makeTouchFeed(d: TouchFeedDeps) {
  return makeLoopObject(TOUCH_FEED, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const cursors = (await ctx.get<Cursors>(CURSORS)) ?? {};
    const outcome = await runPass<TouchFeedStats>(ctx, d.main, now, {
      name: "touch feed",
      ledger: { command: "touch feed", argv: { daemon: true } },
      body: async () => {
        const next: Cursors = { ...cursors };
        const batches: TouchFeedStats["batches"] = [];
        const errors: string[] = [];
        const work: { key: string; client: string | null }[] = [
          { key: WREN_CURSOR, client: null },
          ...(await d.clients()).map((c) => ({ key: c, client: c })),
        ];
        for (const w of work) {
          try {
            const got = await touchPass(
              w.client ? d.clientDb(w.client) : d.main,
              cursors[w.key],
              now,
            );
            if (!got) continue;
            next[w.key] = got.next;
            if (got.ids.length) batches.push({ client: w.client, ids: got.ids });
          } catch (err) {
            // Wren's own workspace failing fails the pass; a client's is said and skipped.
            if (!w.client) throw err;
            errors.push(`${w.client}: ${String(err).slice(0, 2000)}`);
          }
        }
        return {
          told: batches.reduce((n, b) => n + b.ids.length, 0),
          cursors: next,
          batches,
          errors,
        };
      },
      delayAfter: (s) =>
        s.batches.some((b) => b.ids.length >= TOUCH_BATCH) ? 5_000 : TOUCH_FEED_MS,
      retryMs: TOUCH_FEED_MS,
    });
    if (!outcome.stats) return outcome;
    // Built in their own step, so the pass's record keeps ids only.
    const fires = await ctx.run("touch events", async () => {
      const out: Fired[] = [];
      for (const b of outcome.stats?.batches ?? [])
        for (const t of await touchRows(b.client ? d.clientDb(b.client) : d.main, b.ids))
          out.push(touchFired(b.client, t));
      return out;
    });
    for (const f of fires) spineFire(ctx, f);
    ctx.set(CURSORS, outcome.stats.cursors);
    return outcome;
  });
}

export type TouchFeedService = ReturnType<typeof makeTouchFeed>;

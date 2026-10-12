/**
 * Pushes into the social loops (designs/2026-10-12-push-everywhere.md). A push wakes a pass, it
 * never carries a comment: the pass's read is the one path that keeps one, so a lost, repeated or
 * reordered push changes nothing.
 *
 * `SocialPush` (service) takes what the phone Worker checked: `meta` (a Meta webhook body, its
 * entries batched), `gbp` (a Business Profile review notice), `watch` (an autobrowse tab watcher saw
 * a badge change, or says it is alive). Each entry finds its owner, `wren` or a client, and lands
 * on that owner's `SocialPushed` object, which wakes `SocialWatch` (and `ReachWatch` for our own DMs).
 *
 * `SocialPushed/<owner>` keeps what was pushed until the pass `take`s it: posts to read now, due or
 * not, and platforms whose activity or inbox to read now. A burst is one pass. It also keeps when
 * each platform's watcher last said it was alive: `ReachWatch` reads a watched account cold
 * (`reach`), since the tab will say when something comes in.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Platform } from "@wren/core/content";
import { clientKey, exclusiveHandler, NO_INPUT, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { SOCIAL_UNIT } from "../components.js";
import { socialConnections } from "../connect/schema.js";
import { SOCIAL_KEY } from "./social.js";

/** What a push asks the pass to read now. */
export type PushKind = "comment" | "dm" | "review" | "activity";
export interface Pushed {
  platform: Platform;
  kind: PushKind;
  /** The post whose comments to read (a comment push). */
  post?: string;
}
/** One push, before its owner is known: the id the platform names (a Page, an account, a location). */
export interface PushedAt extends Pushed {
  account: string;
}

/** A `SocialPushed` set: one entry per platform, kind and post. */
export const pushKey = (p: Pushed) => `${p.platform}:${p.kind}:${p.post ?? ""}`;

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * A Meta webhook body as pushes. `page`: `feed` changes with `item: "comment"` name the post;
 * `messaging` is a DM. `instagram`: `comments` (and `live_comments`) name the media; `messaging` or
 * a `messages` change is a DM; `mentions` is activity. Anything else is dropped.
 */
export function metaPushes(body: unknown): PushedAt[] {
  const b = (body ?? {}) as { object?: unknown; entry?: unknown };
  const platform: Platform | null =
    b.object === "page" ? "facebook" : b.object === "instagram" ? "instagram" : null;
  if (!platform || !Array.isArray(b.entry)) return [];
  const out: PushedAt[] = [];
  for (const e of b.entry as Json[]) {
    const account = str(e.id) ?? (typeof e.id === "number" ? String(e.id) : null);
    if (!account) continue;
    if (Array.isArray(e.messaging) && e.messaging.length)
      out.push({ account, platform, kind: "dm" });
    for (const c of Array.isArray(e.changes) ? (e.changes as Json[]) : []) {
      const v = (c.value ?? {}) as Json;
      if (platform === "facebook" && c.field === "feed") {
        const post = str(v.post_id);
        if (v.item === "comment" && post) out.push({ account, platform, kind: "comment", post });
      } else if (c.field === "comments" || c.field === "live_comments") {
        const post = str((v.media as Json | undefined)?.id);
        out.push(
          post
            ? { account, platform, kind: "comment", post }
            : { account, platform, kind: "activity" },
        );
      } else if (c.field === "messages") out.push({ account, platform, kind: "dm" });
      else if (c.field === "mentions") out.push({ account, platform, kind: "activity" });
    }
  }
  return dedupe(out);
}

/** A Business Profile notice (`{type, location, review}`) as a push; null for other types. */
export function gbpPush(note: unknown): PushedAt | null {
  const n = (note ?? {}) as Json;
  if (n.type !== "NEW_REVIEW" && n.type !== "UPDATED_REVIEW") return null;
  const location = str(n.location) ?? str(n.review)?.replace(/\/reviews\/.*$/, "") ?? null;
  return location ? { account: location, platform: "google_business", kind: "review" } : null;
}

function dedupe<T extends Pushed>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${(x as Partial<PushedAt>).account ?? ""}|${pushKey(x)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `locations/<l>`, whatever account prefix a notice or a connection carries. */
const locationTail = (s: string) => /locations\/[^/]+$/.exec(s)?.[0] ?? s;

/**
 * Whose account a platform id is: `wren` for ours, else the client whose connection names it.
 * Null when nobody's: a Page subscribed to the app that no connection names any more.
 */
export async function ownerOf(
  db: Db,
  p: PushedAt,
  ours: { pageId?: string | null; igId?: string | null },
): Promise<string | null> {
  if (p.account === ours.pageId || p.account === ours.igId) return SOCIAL_KEY;
  const meta = p.platform === "facebook" || p.platform === "instagram";
  const rows = await db
    .select({ client: socialConnections.client })
    .from(socialConnections)
    .where(
      meta
        ? and(
            inArray(socialConnections.platform, ["facebook", "instagram"]),
            or(
              eq(socialConnections.externalId, p.account),
              sql`${socialConnections.extra}->>'pageId' = ${p.account}`,
            ),
          )
        : and(
            eq(socialConnections.platform, p.platform as "google_business"),
            sql`${socialConnections.externalId} like ${`%${locationTail(p.account)}`}`,
          ),
    )
    .limit(1);
  return rows[0]?.client ?? null;
}

/** The loop a push wakes for its owner. */
export const socialWatchKey = (owner: string) =>
  owner === SOCIAL_KEY ? SOCIAL_KEY : clientKey(owner, SOCIAL_UNIT);

const PENDING = "pending";
const REACH = "reach";
const ALIVE = "alive";
/** A watcher beats every 10 minutes; one missed beat still counts it alive. */
export const WATCH_ALIVE_MS = 25 * 60_000;
const JSON_SERDE = restate.serde.json as unknown as restate.Serde<null>;
const PUSHED = z.object({
  platform: z.string().min(1),
  kind: z.enum(["comment", "dm", "review", "activity"]),
  post: z.string().min(1).optional(),
});

/** What one owner was pushed, kept until its pass takes it. */
export const socialPushed = restate.object({
  name: "SocialPushed",
  handlers: {
    /** Keep these and wake the owner's pass (and our reach inbox for our own DMs). */
    add: exclusiveHandler(
      { ingressPrivate: true, input: z.array(PUSHED) },
      async (ctx: restate.ObjectContext, pushes: Pushed[]): Promise<number> => {
        const pending = (await ctx.get<Record<string, Pushed>>(PENDING)) ?? {};
        for (const p of pushes) pending[pushKey(p)] = p;
        ctx.set(PENDING, pending);
        wake(ctx, "SocialWatch", socialWatchKey(ctx.key));
        const dms = pushes.filter((p) => p.kind === "dm").map((p) => p.platform);
        if (ctx.key === SOCIAL_KEY && dms.length) {
          const reach = (await ctx.get<string[]>(REACH)) ?? [];
          ctx.set(REACH, [...new Set([...reach, ...dms])]);
          wake(ctx, "ReachWatch", "daily");
        }
        return Object.keys(pending).length;
      },
    ),
    /** Everything pushed since the last take; the set is empty after. */
    take: exclusiveHandler(
      { ingressPrivate: true, input: NO_INPUT },
      async (ctx: restate.ObjectContext): Promise<Pushed[]> => {
        const pending = (await ctx.get<Record<string, Pushed>>(PENDING)) ?? {};
        ctx.clear(PENDING);
        return Object.values(pending);
      },
    ),
    /** A watcher on this platform is reading: keep when. Wakes nothing. */
    alive: exclusiveHandler(
      { ingressPrivate: true, input: z.object({ platform: z.string().min(1) }) },
      async (ctx: restate.ObjectContext, { platform }: { platform: string }): Promise<void> => {
        const alive = (await ctx.get<Record<string, number>>(ALIVE)) ?? {};
        ctx.set(ALIVE, { ...alive, [platform]: await ctx.date.now() });
      },
    ),
    /**
     * `ReachWatch`'s view: platforms a DM was pushed for since it last asked (read now), and
     * platforms a watcher is alive on (read cold). The pushed set is empty after.
     */
    reach: exclusiveHandler(
      { ingressPrivate: true, input: NO_INPUT },
      async (ctx: restate.ObjectContext): Promise<ReachView> => {
        const pushed = (await ctx.get<string[]>(REACH)) ?? [];
        const alive = (await ctx.get<Record<string, number>>(ALIVE)) ?? {};
        const now = await ctx.date.now();
        ctx.clear(REACH);
        return {
          pushed,
          watched: Object.keys(alive).filter((p) => now - (alive[p] ?? 0) < WATCH_ALIVE_MS),
        };
      },
    ),
  },
});

/** What `SocialPushed/wren.reach` answers. */
export interface ReachView {
  pushed: string[];
  watched: string[];
}
export type SocialPushed = typeof socialPushed;

function wake(ctx: restate.ObjectContext, service: string, key: string): void {
  ctx.genericSend({ service, method: "wake", key, parameter: null, inputSerde: JSON_SERDE });
}

export interface SocialPushDeps {
  db: Db;
  /** Our own Page and Instagram account (`WREN_META_PAGE_ID`, `WREN_META_IG_ID`). */
  ours: { pageId?: string | null; igId?: string | null };
}

export interface PushResult {
  owners: string[];
  /** Ids no connection names: dropped. */
  unknown: number;
}

const WATCH = z.object({
  owner: z.string().min(1).max(64).describe("wren, or a client id"),
  platform: z.string().min(1).describe("linkedin"),
  kind: z.enum(["comment", "dm", "review", "activity", "alive"]).default("activity"),
});

export function makeSocialPush(deps: SocialPushDeps) {
  /** Group by owner, then one `add` each. */
  async function deliver(ctx: restate.Context, pushes: PushedAt[]): Promise<PushResult> {
    const owners = await ctx.run("owners", async () => {
      const out: { owner: string | null; push: Pushed }[] = [];
      for (const { account, ...push } of pushes)
        out.push({ owner: await ownerOf(deps.db, { account, ...push }, deps.ours), push });
      return out;
    });
    const by = new Map<string, Pushed[]>();
    let unknown = 0;
    for (const { owner, push } of owners) {
      if (!owner) unknown += 1;
      else by.set(owner, [...(by.get(owner) ?? []), push]);
    }
    for (const [owner, list] of by)
      ctx.objectSendClient<SocialPushed>({ name: "SocialPushed" }, owner).add(list);
    return { owners: [...by.keys()], unknown };
  }
  return restate.service({
    name: "SocialPush",
    handlers: {
      /** A Meta webhook body, signature checked by the phone Worker. */
      meta: serviceHandler(
        { input: z.unknown() },
        async (ctx: restate.Context, body: unknown): Promise<PushResult> =>
          deliver(ctx, metaPushes(body)),
      ),
      /** A Business Profile notice, decoded by the phone Worker. */
      gbp: serviceHandler(
        { input: z.unknown() },
        async (ctx: restate.Context, note: unknown): Promise<PushResult> => {
          const p = gbpPush(note);
          return p ? deliver(ctx, [p]) : { owners: [], unknown: 0 };
        },
      ),
      /**
       * A tab watcher saw its count rise: that platform's activity and inbox now (a title counts
       * both). `alive`: it is reading, so the platform's DMs can be read cold.
       */
      watch: serviceHandler(
        { input: WATCH },
        async (ctx: restate.Context, w: z.infer<typeof WATCH>): Promise<PushResult> => {
          const to = ctx.objectSendClient<SocialPushed>({ name: "SocialPushed" }, w.owner);
          const platform = w.platform as Platform;
          if (w.kind === "alive") to.alive({ platform });
          else
            to.add(
              w.kind === "activity"
                ? [
                    { platform, kind: "activity" },
                    { platform, kind: "dm" },
                  ]
                : [{ platform, kind: w.kind }],
            );
          return { owners: [w.owner], unknown: 0 };
        },
      ),
    },
  });
}
export type SocialPush = ReturnType<typeof makeSocialPush>;

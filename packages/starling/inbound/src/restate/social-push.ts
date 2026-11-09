/**
 * Pushes into the social loops (designs/2026-10-12-push-everywhere.md). A push wakes a pass. With
 * `carry` (`WREN_META_PUSH_EVENTS`, designs/2026-11-04-meta-push-flows.md) a Meta comment push is
 * kept as is, no read: the keep dedupes on the comment's ref and a keyword hit is one per comment,
 * so a repeated or reordered push changes nothing, and the slow pass is the net for a lost one.
 * A tap on a keyword DM's button (`kw:<hit>`) sends that keyword's follow-up.
 *
 * `SocialPush` (service) takes what the phone Worker checked: `meta` (a Meta webhook body, its
 * entries batched), `gbp` (a Business Profile review notice), `watch` (an autobrowse tab watcher saw
 * a badge change, or says it is alive). Each entry finds its owner, `wren` or a client, and lands
 * on that owner's `SocialPushHold` object, which wakes `SocialActivityRead` (and `ReachInboxRead` for our own DMs).
 *
 * `SocialPushHold/<owner>` keeps what was pushed until the pass `take`s it: posts to read now, due or
 * not, and platforms whose activity or inbox to read now. A burst is one pass. It also keeps when
 * each platform's watcher last said it was alive: `ReachInboxRead` reads a watched account cold
 * (`reach`), since the tab will say when something comes in.
 */

import type { Platform } from "@wren/core/autobrowse";
import {
  clientKey,
  exclusiveHandler,
  NO_INPUT,
  serviceHandler,
  WEBHOOK_SERVICE,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import * as restate from "@wren/runtime";
import type { CommentRow } from "@wren/starling-core";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { SOCIAL_UNIT } from "../components.js";
import { socialConnections } from "../connect/schema.js";
import { SOCIAL_KEY } from "./social.js";

/** `KeywordDm.tap`, as this file sends it (no import cycle). */
type KeywordTaps = {
  tap: (
    ctx: restate.Context,
    req: { client: string | null; platform: string; from: string; payload: string },
  ) => Promise<unknown>;
};
/** `PushedComments.keep`, as this file sends it. */
type PushedCommentsKeep = {
  keep: (
    ctx: restate.Context,
    req: { client: string | null; platform: string; post: string; rows: CommentRow[] },
  ) => Promise<unknown>;
};

/** What a push asks the pass to read now. */
type PushKind = "comment" | "dm" | "review" | "activity";
export interface Pushed {
  platform: Platform;
  kind: PushKind;
  /** The post whose comments to read (a comment push). */
  post?: string;
}
/** One push, before its owner is known: the id the platform names (a Page, an account, a location). */
interface PushedAt extends Pushed {
  account: string;
}

/** A `SocialPushHold` set: one entry per platform, kind and post. */
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

/** One comment a Meta push carried, as a read gives it. */
export interface CarriedComment {
  account: string;
  platform: "instagram" | "facebook";
  post: string;
  row: CommentRow;
}

const whenOf = (secs: unknown, fallback: unknown): string => {
  const n = typeof secs === "number" ? secs : typeof fallback === "number" ? fallback : null;
  // Meta sends seconds in `created_time` and `time`, ms in some `time`s
  return n === null ? new Date().toISOString() : new Date(n > 1e12 ? n : n * 1000).toISOString();
};

/**
 * The new comments a Meta push carries. Instagram `comments` (new only); Facebook `feed` with
 * `item: comment` and `verb: add` (an edit or a removal is the net read's). `mine`: written by the
 * account the entry is for.
 */
export function metaComments(body: unknown): CarriedComment[] {
  const b = (body ?? {}) as { object?: unknown; entry?: unknown };
  const platform = b.object === "page" ? "facebook" : b.object === "instagram" ? "instagram" : null;
  if (!platform || !Array.isArray(b.entry)) return [];
  const out: CarriedComment[] = [];
  for (const e of b.entry as Json[]) {
    const account = str(e.id) ?? (typeof e.id === "number" ? String(e.id) : null);
    if (!account) continue;
    for (const c of Array.isArray(e.changes) ? (e.changes as Json[]) : []) {
      const v = (c.value ?? {}) as Json;
      const from = (v.from ?? {}) as Json;
      const fromId = str(from.id);
      if (platform === "instagram" && c.field === "comments") {
        const post = str((v.media as Json | undefined)?.id);
        const id = str(v.id);
        if (!post || !id) continue;
        const parent = str(v.parent_id);
        out.push({
          account,
          platform,
          post,
          row: {
            id,
            postId: post,
            author: str(from.username) ?? "",
            text: typeof v.text === "string" ? v.text : "",
            at: whenOf(undefined, e.time),
            ...(parent ? { parentId: parent } : {}),
            ...(fromId && fromId === account ? { mine: true } : {}),
            raw: v,
          },
        });
      } else if (platform === "facebook" && c.field === "feed") {
        if (v.item !== "comment" || v.verb !== "add") continue;
        const post = str(v.post_id);
        const id = str(v.comment_id);
        if (!post || !id) continue;
        const parent = str(v.parent_id);
        out.push({
          account,
          platform,
          post,
          row: {
            id,
            postId: post,
            author: str(from.name) ?? "",
            text: typeof v.message === "string" ? v.message : "",
            at: whenOf(v.created_time, e.time),
            ...(parent && parent !== post ? { parentId: parent } : {}),
            ...(fromId && fromId === account ? { mine: true } : {}),
            raw: v,
          },
        });
      }
    }
  }
  return out;
}

/** A tap on a DM's button or quick reply: who tapped, and its payload. */
export interface Tap {
  account: string;
  platform: "instagram" | "facebook";
  from: string;
  payload: string;
}

/** The taps in a Meta push's `messaging` events (`postback.payload`, `message.quick_reply.payload`). */
export function metaTaps(body: unknown): Tap[] {
  const b = (body ?? {}) as { object?: unknown; entry?: unknown };
  const platform = b.object === "page" ? "facebook" : b.object === "instagram" ? "instagram" : null;
  if (!platform || !Array.isArray(b.entry)) return [];
  const out: Tap[] = [];
  for (const e of b.entry as Json[]) {
    const account = str(e.id) ?? (typeof e.id === "number" ? String(e.id) : null);
    if (!account || !Array.isArray(e.messaging)) continue;
    for (const m of e.messaging as Json[]) {
      const from = str((m.sender as Json | undefined)?.id);
      const payload =
        str((m.postback as Json | undefined)?.payload) ??
        str(((m.message as Json | undefined)?.quick_reply as Json | undefined)?.payload);
      // our own echo names us as the sender
      if (from && payload && from !== account) out.push({ account, platform, from, payload });
    }
  }
  return out;
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
const WATCH_ALIVE_MS = 25 * 60_000;
const JSON_SERDE = restate.serde.json as unknown as restate.Serde<null>;
const PUSHED = z.object({
  platform: z.string().min(1),
  kind: z.enum(["comment", "dm", "review", "activity"]),
  post: z.string().min(1).optional(),
});

/** What one owner was pushed, kept until its pass takes it. */
export const socialPushed = restate.object({
  name: "SocialPushHold",
  handlers: {
    /** Keep these and wake the owner's pass (and our reach inbox for our own DMs). */
    add: exclusiveHandler(
      { ingressPrivate: true, input: z.array(PUSHED) },
      async (ctx: restate.ObjectContext, pushes: Pushed[]): Promise<number> => {
        const pending = (await ctx.get<Record<string, Pushed>>(PENDING)) ?? {};
        for (const p of pushes) pending[pushKey(p)] = p;
        ctx.set(PENDING, pending);
        wake(ctx, "SocialActivityRead", socialWatchKey(ctx.key));
        const dms = pushes.filter((p) => p.kind === "dm").map((p) => p.platform);
        if (ctx.key === SOCIAL_KEY && dms.length) {
          const reach = (await ctx.get<string[]>(REACH)) ?? [];
          ctx.set(REACH, [...new Set([...reach, ...dms])]);
          wake(ctx, "ReachInboxRead", "daily");
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
     * `ReachInboxRead`'s view: platforms a DM was pushed for since it last asked (read now), and
     * platforms a watcher is alive on (read cold). The pushed set is empty after.
     */
    reach: exclusiveHandler(
      { ingressPrivate: true, input: NO_INPUT },
      async (ctx: restate.ObjectContext): Promise<ReachView> => {
        const pushed = (await ctx.get<string[]>(REACH)) ?? [];
        const watched = await watching(ctx);
        ctx.clear(REACH);
        return { pushed, watched };
      },
    ),
    /** `SocialActivityRead`'s view: platforms a watcher is alive on (their posts read when named). */
    watching: exclusiveHandler(
      { ingressPrivate: true, input: NO_INPUT },
      async (ctx: restate.ObjectContext): Promise<string[]> => watching(ctx),
    ),
  },
});

async function watching(ctx: restate.ObjectContext): Promise<string[]> {
  const alive = (await ctx.get<Record<string, number>>(ALIVE)) ?? {};
  const now = await ctx.date.now();
  return Object.keys(alive).filter((p) => now - (alive[p] ?? 0) < WATCH_ALIVE_MS);
}

/** What `SocialPushHold/wren.reach` answers. */
export interface ReachView {
  pushed: string[];
  watched: string[];
}
export type SocialPushed = typeof socialPushed;

function wake(ctx: restate.ObjectContext, service: string, key: string): void {
  ctx.genericSend({ service, method: "wake", key, parameter: null, inputSerde: JSON_SERDE });
}

interface SocialPushDeps {
  db: Db;
  /** Our own Page and Instagram account (`WREN_META_PAGE_ID`, `WREN_META_IG_ID`). */
  ours: { pageId?: string | null; igId?: string | null };
  /** `WREN_META_PUSH_EVENTS`: a comment push is kept as is, its post not read. */
  carry?: boolean;
}

interface PushResult {
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
      ctx.objectSendClient<SocialPushed>({ name: "SocialPushHold" }, owner).add(list);
    return { owners: [...by.keys()], unknown };
  }
  return restate.service({
    name: "SocialPush",
    options: WEBHOOK_SERVICE,
    handlers: {
      /** A Meta webhook body, signature checked by the phone Worker. */
      meta: serviceHandler(
        { input: z.unknown() },
        async (ctx: restate.Context, body: unknown): Promise<PushResult> => {
          // A tap on a keyword DM's button: its follow-up, whatever `carry` says.
          const taps = metaTaps(body);
          if (taps.length) {
            const owned = await ctx.run("tap owners", async () => {
              const out: { owner: string | null; tap: Tap }[] = [];
              for (const tap of taps)
                out.push({
                  owner: await ownerOf(
                    deps.db,
                    { account: tap.account, platform: tap.platform, kind: "dm" },
                    deps.ours,
                  ),
                  tap,
                });
              return out;
            });
            for (const { owner, tap } of owned)
              if (owner)
                ctx.serviceSendClient<KeywordTaps>({ name: "KeywordDm" }).tap({
                  client: owner === SOCIAL_KEY ? null : owner,
                  platform: tap.platform,
                  from: tap.from,
                  payload: tap.payload,
                });
          }
          if (!deps.carry) return deliver(ctx, metaPushes(body));
          const carried = metaComments(body);
          const posts = new Set(carried.map((c) => `${c.platform}:${c.post}`));
          // The posts it carried are kept here, not read; everything else wakes as before.
          const rest = metaPushes(body).filter(
            (p) => !(p.kind === "comment" && posts.has(`${p.platform}:${p.post ?? ""}`)),
          );
          const result = await deliver(ctx, rest);
          if (!carried.length) return result;
          const owned = await ctx.run("comment owners", async () => {
            const out: { owner: string | null; c: CarriedComment }[] = [];
            for (const c of carried)
              out.push({
                owner: await ownerOf(
                  deps.db,
                  { account: c.account, platform: c.platform, kind: "comment", post: c.post },
                  deps.ours,
                ),
                c,
              });
            return out;
          });
          const by = new Map<string, { owner: string; c: CarriedComment[] }>();
          for (const { owner, c } of owned) {
            if (!owner) {
              result.unknown += 1;
              continue;
            }
            const k = `${owner}|${c.platform}|${c.post}`;
            by.set(k, { owner, c: [...(by.get(k)?.c ?? []), c] });
          }
          for (const { owner, c } of by.values()) {
            const first = c[0] as CarriedComment;
            ctx.serviceSendClient<PushedCommentsKeep>({ name: "PushedCommentKeep" }).keep({
              client: owner === SOCIAL_KEY ? null : owner,
              platform: first.platform,
              post: first.post,
              rows: c.map((x) => x.row),
            });
            if (!result.owners.includes(owner)) result.owners.push(owner);
          }
          return result;
        },
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
          const to = ctx.objectSendClient<SocialPushed>({ name: "SocialPushHold" }, w.owner);
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

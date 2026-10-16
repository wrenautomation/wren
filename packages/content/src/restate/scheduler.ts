/**
 * `ContentScheduler/default`: publishes approved drafts when they are due.
 * Each publish is one call to the `Content` service (itself journaled down to
 * autobrowse's `sites`), bracketed by two journaled row moves: approved →
 * publishing before, published or failed after. A crash between them leaves a
 * `publishing` row a person can see and re-approve; nothing posts twice.
 *
 * Cadence: after a pass with work, look again in a minute; otherwise sleep
 * until the next scheduled draft, or `idleMs` when nothing is scheduled (a
 * fresh approval with no time also gets picked up then, or on `sync`).
 *
 * `ContentScheduler/<client>/posts`: the same over the client's own database, posting on its own
 * login (`Content` with `client`). Until an admin turns its posting on, approved drafts wait:
 * nothing is claimed, the pass says how many are held. Posts carry no link to Wren's lander.
 *
 * A post's link is its funnel's (`funnel.ts`): read when it is claimed, appended on its own line.
 *
 * The desk's browser busy past autobrowse's wait (`browserBusy`: 503, `not sent`): the draft goes
 * back to approved, its slot kept, "Waiting for the browser" on it; the rest of the pass skips
 * that platform, and the next pass comes in a minute. Never a failed draft, never a notice.
 *
 * A pass waits on one publish at most `PUBLISH_WAIT_MS` (designs/2026-10-16-loop-watchdog.md). A
 * publish Restate paused never answers, and a pass waiting on it held this key's lock for hours.
 * Past the wait the call runs on alone: the draft stays `publishing`, its invocation id is kept
 * in `publishing` state, and each later pass looks at it for a moment and settles the row.
 *
 * A publish that may have gone out ("may have gone through", designs/2026-10-16-maybe-sent.md) is
 * never marked failed: after a short settle, our channel's own listing is read for it (as the
 * account it went out as, from the start of the send). Found: published with the platform's id.
 * Provably absent: sent once more, and only once. Can't tell: the draft stays `publishing` and its
 * ledger row (`draft:<id>`) waits in To approve under "May have gone out".
 */
import * as restate from "@restatedev/restate-sdk";
import { sendsOn } from "@wren/core/clients";
import type { Platform, Post, Published } from "@wren/core/content";
import { browserBusy } from "@wren/core/content";
import { ShapeError } from "@wren/core/content/shapes";
import { type Seen, SETTLE_MS, sendFate, unclear } from "@wren/core/maybe-sent";
import type { Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  errorText,
  LIMITS,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
  within,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import { parkUnsure, pickedAccount } from "@wren/outreach";
import { clientContent } from "../clients.js";
import { postedLinks } from "../funnel.js";
import { lookWords, postOf, PLATFORM_SPECS } from "../platforms.js";
import {
  claim,
  dueDrafts,
  markFailed,
  markPublished,
  markUnsure,
  markWaiting,
  nextDue,
  noteOnDraft,
} from "../queue.js";
import { getDraft } from "../review.js";

export const SCHEDULER_KEY = "default";
const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const BUSY_MS = 60 * 1000;
const MAX_PER_PASS = 10;
/** The longest a pass waits on one publish before it moves on. */
export const PUBLISH_WAIT_MS = LIMITS.publish;
/** A first comment is a nicety: waited on this long, then noted on the draft. */
const COMMENT_WAIT_MS = LIMITS.read;
/** How long a pass looks at a publish it moved on from. */
const SETTLE_LOOK_MS = 1000;
/** State key: the publishes a pass moved on from, still to settle. */
const PUBLISHING = "publishing";

/** A publish still running after its pass moved on. */
export interface OpenPublish {
  invocationId: string;
  draftId: string;
  platform: Platform;
  /** The funnel link, for the row and the first comment. */
  link: string | null;
  comment: string | null;
  account: string | null;
  since: string;
  /** The words as sent, kept on the ledger if it may have gone out. */
  text?: string;
  /** How a person knows it in To approve: its title or first words. */
  target?: string;
  /** What a look after a lost answer reads for (`lookWords`). Absent: an older pass's. */
  words?: string[];
  media?: "image" | "video" | null;
  /** This draft's publishes so far: a second is the last before a person decides. */
  tries?: number;
}

/** A publish about to go out: everything but its invocation. */
type Pending = Omit<OpenPublish, "invocationId">;

/** The `Content` service's publish handler as the worker serves it. */
type ContentService = {
  publish: (
    ctx: restate.Context,
    req: { platform: Platform; post: Post; client?: string | null; account?: string | null },
  ) => Promise<Published>;
  reply: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      commentId: string;
      text: string;
      client?: string | null;
      account?: string | null;
    },
  ) => Promise<void>;
  findPost: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      words: string[];
      since: string;
      media?: "image" | "video" | null;
      client?: string | null;
      account?: string | null;
    },
  ) => Promise<Seen>;
};

export interface ContentSchedulerDeps {
  db: Db;
  /** Sleep between passes when nothing is scheduled (default 15 min). */
  idleMs?: number;
  notifier?: Notifier;
  /** A post just went out on `platform` (a client's, or Wren's at null): its replies read warm. */
  posted?: (ctx: restate.ObjectContext, platform: Platform, client: string | null) => void;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
  /** How long a pass waits on one publish (default `PUBLISH_WAIT_MS`); tests shorten it. */
  publishWaitMs?: number;
  /** How long a lost publish settles before its look (default `SETTLE_MS`); tests shorten it. */
  settleMs?: number;
}

export interface PublishStats {
  published: { id: string; platform: Platform; url: string }[];
  failed: { id: string; platform: Platform; error: string }[];
  /** Approved drafts still waiting after this pass (a batch is capped). */
  remaining: number;
  /** A client's due drafts held because its sends are off. */
  held?: number;
  /** Drafts put back because the desk's browser was busy: they go next pass. */
  waiting?: { id: string; platform: Platform }[];
  /** Publishes still running past the wait; a later pass settles them. */
  posting?: { id: string; platform: Platform; since: string }[];
  /** Publishes that may have gone out and no read could tell: they wait in To approve. */
  unsure?: { id: string; platform: Platform; why: string }[];
}

export function makeContentScheduler(deps: ContentSchedulerDeps) {
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const publishWaitMs = deps.publishWaitMs ?? PUBLISH_WAIT_MS;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  return makeLoopObject("ContentScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const owner = clientOfKey(ctx.key);
    if (!owner)
      return publishPass(ctx, now, {
        db: deps.db,
        client: null,
        notifier: deps.notifier,
      });
    if (!deps.clientDb) return stoppedPass<PublishStats>(ctx, now, "no client databases here");
    const id = owner.client;
    const plan = await ctx.run("client", () => clientContent(deps.db, id, "content.posting"));
    if (plan.kind === "gone") return stoppedPass<PublishStats>(ctx, now, plan.why);
    const db = deps.clientDb(id);
    if (!sendsOn(plan.client, "content.posting")) {
      // Sends off: nothing is claimed; approved drafts keep their slot until an admin says go.
      const due = await ctx.run("held", async () => (await dueDrafts(db, now, 1000)).length);
      const outcome: PassOutcome<PublishStats> = {
        stats: { published: [], failed: [], remaining: 0, held: due },
        error: null,
        failures: 0,
        delayMs: idleMs,
        now: now.toISOString(),
      };
      await setLastPass(ctx, outcome);
      return outcome;
    }
    return publishPass(ctx, now, { db, client: id });
  });

  /**
   * The publishes earlier passes moved on from: each looked at for a moment. Done: the row
   * settles as if the pass had waited. Still running: kept for the next pass.
   */
  async function settleOpen(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    stats: PublishStats,
    busy: Set<Platform>,
  ): Promise<OpenPublish[]> {
    const still: OpenPublish[] = [];
    for (const p of (await ctx.get<OpenPublish[]>(PUBLISHING)) ?? []) {
      try {
        const published = await ctx
          .invocation(restate.InvocationIdParser.fromString(p.invocationId))
          .attach<Published>()
          .orTimeout(SETTLE_LOOK_MS);
        await finish(ctx, o, content, p, published, stats);
      } catch (err) {
        if (err instanceof restate.TimeoutError) still.push(p);
        else await ended(ctx, o, content, p, err, stats, busy, still);
      }
    }
    return still;
  }

  /** A publish that answered: the row marked, the first comment, the warm-replies hook. */
  async function finish(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    p: OpenPublish,
    published: Published,
    stats: PublishStats,
  ): Promise<void> {
    await ctx.run(`published ${p.draftId}`, () =>
      markPublished(o.db, p.draftId, published, p.link),
    );
    stats.published.push({ id: p.draftId, platform: p.platform, url: published.url });
    if (p.comment && published.id) {
      // The post is up either way: a comment that fails or hangs is noted on the draft, never
      // retried into a second one.
      const commented = await within(
        ctx,
        content.reply({
          platform: p.platform,
          commentId: published.id,
          text: p.comment,
          ...(p.account ? { account: p.account } : {}),
        }),
        // A write: left running past the wait, since it may still land.
        { ms: COMMENT_WAIT_MS, call: "Content/reply", unit: p.draftId, keep: true },
      ).then(
        () => null,
        (err: unknown) => errorText(err),
      );
      if (commented)
        await ctx.run(`comment failed ${p.draftId}`, () =>
          noteOnDraft(o.db, p.draftId, `First comment with the link failed: ${commented}`),
        );
    }
    deps.posted?.(ctx, p.platform, o.client);
  }

  /**
   * A publish that ended in an error. A terminal refusal (no channel, the platform said no,
   * killed) is this draft's problem: recorded on the row, the pass moves on. The desk's browser
   * busy: back to approved, the platform skipped this pass. One that may have gone out: looked
   * for (`lost`), never failed. Anything else retries the pass.
   */
  async function ended(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    p: OpenPublish,
    err: unknown,
    stats: PublishStats,
    busy: Set<Platform>,
    open: OpenPublish[],
  ): Promise<void> {
    if (!(err instanceof restate.TerminalError) && !(err instanceof ShapeError)) throw err;
    const error = errorText(err);
    if (browserBusy(err)) {
      await ctx.run(`waiting ${p.draftId}`, () => markWaiting(o.db, p.draftId, error));
      busy.add(p.platform);
      stats.waiting = [...(stats.waiting ?? []), { id: p.draftId, platform: p.platform }];
      return;
    }
    if (sendFate(err) === "maybe") return lost(ctx, o, content, p, error, stats, busy, open);
    await ctx.run(`failed ${p.draftId}`, () => markFailed(o.db, p.draftId, error));
    stats.failed.push({ id: p.draftId, platform: p.platform, error });
  }

  /**
   * A publish that may have gone out: after a settle, our own listing is read for it. Found: it
   * is published, with the platform's id. Absent: once more, and only once. Else it waits on a
   * person in To approve, the draft left `publishing` so no pass takes it.
   */
  async function lost(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    p: OpenPublish,
    error: string,
    stats: PublishStats,
    busy: Set<Platform>,
    open: OpenPublish[],
  ): Promise<void> {
    await ctx.sleep(settleMs);
    const seen: Seen = p.words?.length
      ? await content.findPost({
          platform: p.platform,
          words: p.words,
          since: p.since,
          media: p.media ?? null,
          ...(o.client ? { client: o.client } : {}),
          ...(p.account ? { account: p.account } : {}),
        })
      : unclear("it was sent before posts were looked for");
    const now = new Date(await ctx.date.now());
    const name = PLATFORM_SPECS[p.platform].name;
    if (seen.kind === "found") {
      const published: Published = {
        id: seen.ref ?? "",
        url: seen.url ?? "",
        publishedAt: seen.at ?? now.toISOString(),
        fetchedWith: "api",
      };
      await finish(ctx, o, content, p, published, stats);
      await ctx.run(`found ${p.draftId}`, () =>
        noteOnDraft(
          o.db,
          p.draftId,
          `Found on ${name} after the publish said it may have gone through`,
        ),
      );
      return;
    }
    const tries = p.tries ?? 1;
    if (seen.kind === "absent" && tries < 2) {
      // Provably not there: it never landed. Sent once more, built from the row again.
      const post = await ctx.run(`post again ${p.draftId}`, async () => {
        const d = await getDraft(o.db, p.draftId);
        return postOf(d, p.comment ? null : p.link);
      });
      const { invocationId: _, ...pending } = p;
      return send(
        ctx,
        o,
        content,
        { ...pending, tries: tries + 1, since: now.toISOString() },
        post,
        stats,
        busy,
        open,
      );
    }
    const why =
      seen.kind === "absent"
        ? `${error.slice(0, 300)}; not on ${name} after two tries`
        : `${error.slice(0, 300)}; ${seen.why}`;
    await ctx.run(`unsure ${p.draftId}`, async () => {
      await parkUnsure(o.db, {
        item: `draft:${p.draftId}`,
        platform: p.platform,
        account: p.account,
        words: p.text ?? "",
        target: p.target ?? name,
        url: null,
        tries,
        why,
        now,
        since: new Date(p.since),
      });
      await markUnsure(o.db, p.draftId, why);
    });
    stats.unsure = [...(stats.unsure ?? []), { id: p.draftId, platform: p.platform, why }];
  }

  /**
   * One publish: called, waited on for `publishWaitMs`, then marked. Past the wait it runs on
   * alone and a later pass settles it.
   */
  async function send(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    pending: Pending,
    post: Post,
    stats: PublishStats,
    busy: Set<Platform>,
    open: OpenPublish[],
  ): Promise<void> {
    const call = content.publish({
      platform: pending.platform,
      post,
      ...(o.client ? { client: o.client } : {}),
      ...(pending.account ? { account: pending.account } : {}),
    });
    const p: OpenPublish = { invocationId: await call.invocationId, ...pending };
    try {
      const published = await within(ctx, call, {
        ms: publishWaitMs,
        call: "Content/publish",
        unit: p.draftId,
        keep: true,
      });
      await finish(ctx, o, content, p, published, stats);
    } catch (err) {
      if (err instanceof restate.TimeoutError) {
        // Still running (or paused by Restate): it settles on a later pass, and the queue moves on.
        await ctx.run(`still posting ${p.draftId}`, () =>
          noteOnDraft(
            o.db,
            p.draftId,
            `Still posting after ${Math.round(publishWaitMs / 60_000)} min; the scheduler moved on and settles it when the call ends.`,
          ),
        );
        open.push(p);
        return;
      }
      await ended(ctx, o, content, p, err, stats, busy, open);
    }
  }

  /** One pass: due drafts claimed, posted through `Content`, marked. */
  async function publishPass(
    ctx: restate.ObjectContext,
    now: Date,
    o: { db: Db; client: string | null; notifier?: Notifier | undefined },
  ): Promise<PassOutcome<PublishStats>> {
    const content = ctx.serviceClient<ContentService>({ name: "Content" });
    const stats: PublishStats = { published: [], failed: [], remaining: 0 };
    /** Platforms whose browser was busy this pass: their other drafts wait for the next. */
    const busy = new Set<Platform>();
    const open = await settleOpen(ctx, o, content, stats, busy);
    // Rows cross the journal as JSON: their Date columns are strings here; only id/platform/text/title/media/extra are read.
    const due = await ctx.run("due drafts", () => dueDrafts(o.db, now, MAX_PER_PASS + 1));
    const batch = due.slice(0, MAX_PER_PASS);
    stats.remaining = due.length - batch.length;
    for (const draft of batch) {
      if (busy.has(draft.platform)) continue;
      const claimed = await ctx.run(`claim ${draft.id}`, () => claim(o.db, draft.id));
      if (!claimed) continue;
      // A client's posts carry no Wren link; Wren's carry their funnel's, in the text or
      // as the first comment.
      const links = o.client
        ? { text: null, comment: null }
        : await ctx.run(`link ${draft.id}`, () => postedLinks(o.db, claimed));
      // A person's pick on the draft posts it as that login; none, the platform's default.
      const account = o.client
        ? null
        : await ctx.run(`account ${draft.id}`, () => pickedAccount(o.db, `draft:${draft.id}`));
      const post = postOf(claimed, links.text);
      await send(
        ctx,
        o,
        content,
        {
          draftId: draft.id,
          platform: draft.platform,
          link: links.text ?? links.comment,
          comment: links.comment,
          account,
          since: now.toISOString(),
          text: post.text,
          target: (claimed.title || claimed.text).replace(/\s+/g, " ").trim().slice(0, 120),
          words: lookWords(claimed, post),
          media: claimed.media?.kind ?? null,
          tries: 1,
        },
        post,
        stats,
        busy,
        open,
      );
    }
    ctx.set(PUBLISHING, open);
    if (open.length)
      stats.posting = open.map((p) => ({ id: p.draftId, platform: p.platform, since: p.since }));
    const next = await ctx.run("next due", () => nextDue(o.db, now));
    const delayMs =
      stats.remaining > 0 || busy.size > 0
        ? BUSY_MS
        : next
          ? Math.max(BUSY_MS, Math.min(idleMs, new Date(next).getTime() - now.getTime()))
          : idleMs;
    const outcome: PassOutcome<PublishStats> = {
      stats,
      error: null,
      failures: 0,
      delayMs,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    const notifier = o.notifier;
    const unsure = stats.unsure ?? [];
    if (notifier && (stats.published.length > 0 || stats.failed.length > 0 || unsure.length > 0)) {
      const lines = [
        ...stats.published.map((p) => `posted on ${p.platform}: ${p.url}`),
        ...stats.failed.map((f) => `${f.platform} failed: ${f.error}`),
        ...unsure.map((u) => `${u.platform} may have gone out, check it in To approve: ${u.why}`),
        ...(stats.posting ?? []).map((w) => `${w.platform} still posting since ${w.since}`),
      ];
      await ctx.run("notify", () =>
        notifier.notify(
          `content: ${stats.published.length} posted, ${stats.failed.length} failed${unsure.length ? `, ${unsure.length} may have gone out` : ""}`,
          lines.join("\n"),
          stats.failed.length > 0 || unsure.length > 0 ? "warning" : "info",
        ),
      );
    }
    return outcome;
  }
}

export type ContentScheduler = ReturnType<typeof makeContentScheduler>;

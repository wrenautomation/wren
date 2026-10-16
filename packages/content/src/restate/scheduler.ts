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
 */
import * as restate from "@restatedev/restate-sdk";
import { sendsOn } from "@wren/core/clients";
import type { Platform, Post, Published } from "@wren/core/content";
import { browserBusy } from "@wren/core/content";
import { ShapeError } from "@wren/core/content/shapes";
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
import { pickedAccount } from "@wren/outreach";
import { clientContent } from "../clients.js";
import { postedLinks } from "../funnel.js";
import { postOf } from "../platforms.js";
import {
  claim,
  dueDrafts,
  markFailed,
  markPublished,
  markWaiting,
  nextDue,
  noteOnDraft,
} from "../queue.js";

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
}

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
}

export function makeContentScheduler(deps: ContentSchedulerDeps) {
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const publishWaitMs = deps.publishWaitMs ?? PUBLISH_WAIT_MS;
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
        else await ended(ctx, o, p, err, stats, busy);
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
    if (p.comment) {
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
   * busy: back to approved, the platform skipped this pass. Anything else retries the pass.
   */
  async function ended(
    ctx: restate.ObjectContext,
    o: { db: Db },
    p: OpenPublish,
    err: unknown,
    stats: PublishStats,
    busy: Set<Platform>,
  ): Promise<void> {
    if (!(err instanceof restate.TerminalError) && !(err instanceof ShapeError)) throw err;
    const error = errorText(err);
    if (browserBusy(err)) {
      await ctx.run(`waiting ${p.draftId}`, () => markWaiting(o.db, p.draftId, error));
      busy.add(p.platform);
      stats.waiting = [...(stats.waiting ?? []), { id: p.draftId, platform: p.platform }];
      return;
    }
    await ctx.run(`failed ${p.draftId}`, () => markFailed(o.db, p.draftId, error));
    stats.failed.push({ id: p.draftId, platform: p.platform, error });
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
      const call = content.publish({
        platform: draft.platform,
        post: postOf(claimed, links.text),
        ...(o.client ? { client: o.client } : {}),
        ...(account ? { account } : {}),
      });
      const p: OpenPublish = {
        invocationId: await call.invocationId,
        draftId: draft.id,
        platform: draft.platform,
        link: links.text ?? links.comment,
        comment: links.comment,
        account,
        since: now.toISOString(),
      };
      try {
        const published = await within(ctx, call, {
          ms: publishWaitMs,
          call: "Content/publish",
          unit: draft.id,
          keep: true,
        });
        await finish(ctx, o, content, p, published, stats);
      } catch (err) {
        if (err instanceof restate.TimeoutError) {
          // Still running (or paused by Restate): it settles on a later pass, and the queue moves on.
          await ctx.run(`still posting ${draft.id}`, () =>
            noteOnDraft(
              o.db,
              draft.id,
              `Still posting after ${Math.round(publishWaitMs / 60_000)} min; the scheduler moved on and settles it when the call ends.`,
            ),
          );
          open.push(p);
          continue;
        }
        await ended(ctx, o, p, err, stats, busy);
      }
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
    if (notifier && (stats.published.length > 0 || stats.failed.length > 0)) {
      const lines = [
        ...stats.published.map((p) => `posted on ${p.platform}: ${p.url}`),
        ...stats.failed.map((f) => `${f.platform} failed: ${f.error}`),
        ...(stats.posting ?? []).map((w) => `${w.platform} still posting since ${w.since}`),
      ];
      await ctx.run("notify", () =>
        notifier.notify(
          `content: ${stats.published.length} posted, ${stats.failed.length} failed`,
          lines.join("\n"),
          stats.failed.length > 0 ? "warning" : "info",
        ),
      );
    }
    return outcome;
  }
}

export type ContentScheduler = ReturnType<typeof makeContentScheduler>;

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
 */
import * as restate from "@restatedev/restate-sdk";
import { sendsOn } from "@wren/core/clients";
import type { Platform, Post, Published } from "@wren/core/content";
import { ShapeError } from "@wren/core/content/shapes";
import type { Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  errorText,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import { clientContent } from "../clients.js";
import { postedLink } from "../funnel.js";
import { postOf } from "../platforms.js";
import { claim, dueDrafts, markFailed, markPublished, nextDue } from "../queue.js";

export const SCHEDULER_KEY = "default";
const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const BUSY_MS = 60 * 1000;
const MAX_PER_PASS = 10;

/** The `Content` service's publish handler as the worker serves it. */
type ContentService = {
  publish: (
    ctx: restate.Context,
    req: { platform: Platform; post: Post; client?: string | null },
  ) => Promise<Published>;
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
}

export interface PublishStats {
  published: { id: string; platform: Platform; url: string }[];
  failed: { id: string; platform: Platform; error: string }[];
  /** Approved drafts still waiting after this pass (a batch is capped). */
  remaining: number;
  /** A client's due drafts held because its sends are off. */
  held?: number;
}

export function makeContentScheduler(deps: ContentSchedulerDeps) {
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
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

  /** One pass: due drafts claimed, posted through `Content`, marked. */
  async function publishPass(
    ctx: restate.ObjectContext,
    now: Date,
    o: { db: Db; client: string | null; notifier?: Notifier | undefined },
  ): Promise<PassOutcome<PublishStats>> {
    const content = ctx.serviceClient<ContentService>({ name: "Content" });
    // Rows cross the journal as JSON: their Date columns are strings here; only id/platform/text/title/media/extra are read.
    const due = await ctx.run("due drafts", () => dueDrafts(o.db, now, MAX_PER_PASS + 1));
    const batch = due.slice(0, MAX_PER_PASS);
    const stats: PublishStats = { published: [], failed: [], remaining: due.length - batch.length };
    for (const draft of batch) {
      const claimed = await ctx.run(`claim ${draft.id}`, () => claim(o.db, draft.id));
      if (!claimed) continue;
      // A client's posts carry no Wren link; Wren's carry their funnel's.
      const link = o.client
        ? null
        : await ctx.run(`link ${draft.id}`, () => postedLink(o.db, claimed));
      try {
        const published = await content.publish({
          platform: draft.platform,
          post: postOf(claimed, link),
          ...(o.client ? { client: o.client } : {}),
        });
        await ctx.run(`published ${draft.id}`, () =>
          markPublished(o.db, draft.id, published, link),
        );
        stats.published.push({ id: draft.id, platform: draft.platform, url: published.url });
        deps.posted?.(ctx, draft.platform, o.client);
      } catch (err) {
        // A terminal refusal (no channel, the platform said no) is this draft's
        // problem: recorded on the row, the pass moves on. Anything else retries.
        if (!(err instanceof restate.TerminalError) && !(err instanceof ShapeError)) throw err;
        const error = errorText(err);
        await ctx.run(`failed ${draft.id}`, () => markFailed(o.db, draft.id, error));
        stats.failed.push({ id: draft.id, platform: draft.platform, error });
      }
    }
    const next = await ctx.run("next due", () => nextDue(o.db, now));
    const delayMs =
      stats.remaining > 0
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

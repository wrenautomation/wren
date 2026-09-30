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
 */
import * as restate from "@restatedev/restate-sdk";
import type { Platform, Post, Published } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import { errorText, LAST, makeLoopObject, type PassOutcome } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { postLink, postOf } from "../platforms.js";
import { claim, dueDrafts, markFailed, markPublished, nextDue } from "../queue.js";

export const SCHEDULER_KEY = "default";
const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const BUSY_MS = 60 * 1000;
const MAX_PER_PASS = 10;

/** The `Content` service's publish handler as the worker serves it. */
type ContentService = {
  publish: (ctx: restate.Context, req: { platform: Platform; post: Post }) => Promise<Published>;
};

export interface ContentSchedulerDeps {
  db: Db;
  /** Sleep between passes when nothing is scheduled (default 15 min). */
  idleMs?: number;
  notifier?: Notifier;
  /** The lander host posts link to (`/go/<code>/<draft>`); unset = posts carry no link. */
  linkSite?: string | null;
}

export interface PublishStats {
  published: { id: string; platform: Platform; url: string }[];
  failed: { id: string; platform: Platform; error: string }[];
  /** Approved drafts still waiting after this pass (a batch is capped). */
  remaining: number;
}

export function makeContentScheduler(deps: ContentSchedulerDeps) {
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  return makeLoopObject("ContentScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const content = ctx.serviceClient<ContentService>({ name: "Content" });
    // Rows cross the journal as JSON: their Date columns are strings here; only id/platform/text/title/media/extra are read.
    const due = await ctx.run("due drafts", () => dueDrafts(deps.db, now, MAX_PER_PASS + 1));
    const batch = due.slice(0, MAX_PER_PASS);
    const stats: PublishStats = { published: [], failed: [], remaining: due.length - batch.length };
    for (const draft of batch) {
      const claimed = await ctx.run(`claim ${draft.id}`, () => claim(deps.db, draft.id));
      if (!claimed) continue;
      try {
        const published = await content.publish({
          platform: draft.platform,
          post: postOf(claimed, postLink(deps.linkSite, claimed)),
        });
        await ctx.run(`published ${draft.id}`, () => markPublished(deps.db, draft.id, published));
        stats.published.push({ id: draft.id, platform: draft.platform, url: published.url });
      } catch (err) {
        // A terminal refusal (no channel, the platform said no) is this draft's
        // problem: recorded on the row, the pass moves on. Anything else retries.
        if (!(err instanceof restate.TerminalError)) throw err;
        const error = errorText(err);
        await ctx.run(`failed ${draft.id}`, () => markFailed(deps.db, draft.id, error));
        stats.failed.push({ id: draft.id, platform: draft.platform, error });
      }
    }
    const next = await ctx.run("next due", () => nextDue(deps.db, now));
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
    ctx.set(LAST, outcome);
    const notifier = deps.notifier;
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
  });
}

export type ContentScheduler = ReturnType<typeof makeContentScheduler>;

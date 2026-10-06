/**
 * `Watch/all`: every 15 minutes, read new mail in each inbox and each feed due a read, and send
 * both along the `watch` workflow, where triage settles mail and scoring settles feed items. Served on the Postgres box, like the books: the personal
 * inbox is read through the Mac's desk, and waiting there costs nothing. No notices: what needs
 * William shows in the Inbox app, and an inbox it couldn't read shows on the loop.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Mailbox } from "@wren/core/mailbox";
import { makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { type FetchFn, itemEvent, type PullStats, pullFeeds } from "./feeds.js";
import { type ReadStats, readMail } from "./read.js";
import { mailEvent } from "./triage.js";

export * from "./console.js";

export const WATCH_KEY = "all";
export const WATCH_EVERY_MS = 15 * 60_000;
/** The workflow, and the node the reader is in it. */
export const WATCH_FLOW = "watch";
export const WATCH_FROM = "read.mail";
export const WATCH_FEEDS_FROM = "read.items";

export interface WatchDeps {
  db: Db;
  mailboxes: readonly Mailbox[];
  fetch?: FetchFn;
}

type Stats = ReadStats & { feeds: PullStats };

export function makeWatch(deps: WatchDeps) {
  return makeLoopObject("Watch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<Stats>(ctx, deps.db, now, {
      name: "read",
      ledger: { command: "watch read", argv: { daemon: true } },
      body: async () => ({
        ...(await readMail(deps.db, deps.mailboxes, now)),
        feeds: await pullFeeds(deps.db, deps.fetch ?? fetch, now),
      }),
      delayAfter: () => WATCH_EVERY_MS,
      retryMs: WATCH_EVERY_MS,
    })) as PassOutcome<Stats>;
    const kept = outcome.stats?.kept ?? [];
    if (kept.length)
      spineEmit(ctx, {
        client: null,
        workflow: WATCH_FLOW,
        from: WATCH_FROM,
        events: kept.map(mailEvent),
      });
    const added = outcome.stats?.feeds?.added ?? [];
    if (added.length)
      spineEmit(ctx, {
        client: null,
        workflow: WATCH_FLOW,
        from: WATCH_FEEDS_FROM,
        events: added.map(itemEvent),
      });
    return outcome;
  });
}

export type Watch = ReturnType<typeof makeWatch>;

/**
 * `Watch/all`: every 15 minutes, read new mail in each inbox and send it along the `watch`
 * workflow, where triage settles it. Served on the Postgres box, like the books: the personal
 * inbox is read through the Mac's desk, and waiting there costs nothing. No notices: what needs
 * William shows in the Inbox app, and an inbox it couldn't read shows on the loop.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Mailbox } from "@wren/core/mailbox";
import { makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { type ReadStats, readMail } from "./read.js";
import { mailEvent } from "./triage.js";

export * from "./console.js";

export const WATCH_KEY = "all";
export const WATCH_EVERY_MS = 15 * 60_000;
/** The workflow, and the node the reader is in it. */
export const WATCH_FLOW = "watch";
export const WATCH_FROM = "read.mail";

export interface WatchDeps {
  db: Db;
  mailboxes: readonly Mailbox[];
}

export function makeWatch(deps: WatchDeps) {
  return makeLoopObject("Watch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<ReadStats>(ctx, deps.db, now, {
      name: "read",
      ledger: { command: "watch read", argv: { daemon: true } },
      body: () => readMail(deps.db, deps.mailboxes, now),
      delayAfter: () => WATCH_EVERY_MS,
      retryMs: WATCH_EVERY_MS,
    })) as PassOutcome<ReadStats>;
    const kept = outcome.stats?.kept ?? [];
    if (kept.length)
      spineEmit(ctx, {
        client: null,
        workflow: WATCH_FLOW,
        from: WATCH_FROM,
        events: kept.map(mailEvent),
      });
    return outcome;
  });
}

export type Watch = ReturnType<typeof makeWatch>;

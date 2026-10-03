/**
 * `Books/all`: the books' day (`booksDay`) once a day, unattended. A pass that
 * raised alerts sends one notice listing them; a failing pass is told once by
 * the loop itself. Served on the Postgres box: the reads wait on the model and
 * on the Mac's desk, and waiting there costs nothing.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { loopSettings, makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import { type BooksDay, type BooksDayDeps, booksDay } from "./daily.js";

export const BOOKS_KEY = "all";
export const BOOKS_COMMAND = "books day";
export const BOOKS_EVERY_MS = 24 * 3_600_000;
export const BOOKS_RETRY_MS = 3_600_000;

/** What `start` may change; none today, kept for the loop contract. */
export type BooksSettings = Record<string, never>;

export interface BooksDeps extends Omit<BooksDayDeps, "log"> {
  notifier?: Notifier;
}

export function makeBooks(deps: BooksDeps) {
  return makeLoopObject("Books", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const settings = await loopSettings<BooksSettings>(ctx);
    const outcome = (await runPass<BooksDay>(ctx, deps.db, now, {
      name: "day",
      ledger: { command: BOOKS_COMMAND, argv: { daemon: true, ...settings } },
      body: (runId) => booksDay(deps, now, runId),
      delayAfter: () => BOOKS_EVERY_MS,
      retryMs: BOOKS_RETRY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<BooksDay>;
    const raised = outcome.stats?.raised ?? [];
    const notifier = deps.notifier;
    if (notifier && raised.length)
      await ctx.run("notify alerts", () =>
        notifier.notify(
          `books: ${raised.length} new`,
          raised.map((m) => `- ${m}`).join("\n"),
          "info",
        ),
      );
    return outcome;
  });
}

export type Books = ReturnType<typeof makeBooks>;

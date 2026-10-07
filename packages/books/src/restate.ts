/**
 * `Books/all`: the books' day (`booksDay`) once a day, unattended. A pass that
 * raised alerts sends one notice listing them; a failing pass is told once by
 * the loop itself. Served on the Postgres box: the reads wait on the model and
 * on the Mac's desk, and waiting there costs nothing.
 *
 * A bill the Watch reads runs `sync` at once (designs/2026-10-06-mail-push.md): the same pass,
 * but AWS Cost Explorer bills per call, so its spend is taken in once a day at most.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { loopSettings, makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import { type BooksDay, type BooksDayDeps, booksDay } from "./daily.js";

export * from "./console.js";

export const BOOKS_KEY = "all";
export const BOOKS_COMMAND = "books day";
export const BOOKS_EVERY_MS = 24 * 3_600_000;
export const BOOKS_RETRY_MS = 3_600_000;
/** AWS spend is asked again only this long after the last ask. */
export const BOOKS_AWS_EVERY_MS = 20 * 3_600_000;
const AWS_AT = "aws at";

/** What `start` may change; none today, kept for the loop contract. */
export type BooksSettings = Record<string, never>;

export interface BooksDeps extends Omit<BooksDayDeps, "log"> {
  notifier?: Notifier;
}

export function makeBooks(deps: BooksDeps) {
  return makeLoopObject("Books", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const settings = await loopSettings<BooksSettings>(ctx);
    const awsDue = now.getTime() - ((await ctx.get<number>(AWS_AT)) ?? 0) >= BOOKS_AWS_EVERY_MS;
    const outcome = (await runPass<BooksDay>(ctx, deps.db, now, {
      name: "day",
      ledger: { command: BOOKS_COMMAND, argv: { daemon: true, ...settings } },
      body: (runId) => booksDay(awsDue ? deps : { ...deps, aws: null }, now, runId),
      delayAfter: () => BOOKS_EVERY_MS,
      retryMs: BOOKS_RETRY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<BooksDay>;
    if (awsDue && outcome.stats?.aws) ctx.set(AWS_AT, now.getTime());
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

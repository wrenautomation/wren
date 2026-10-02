/**
 * `PageArchive/all`: moves page HTML older than a day out of Postgres to the
 * pages bucket (`archivePages`). While a backlog remains it runs pass after
 * pass; caught up, it looks again hourly. Served on the Postgres box next to
 * the data, so no page crosses the network twice.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { loopSettings, makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { type ArchiveStats, archivePages, type PageStore } from "../pages.js";

export const PAGE_ARCHIVE_KEY = "all";
export const PAGE_ARCHIVE_COMMAND = "pages archive";
/** Pages stay inline this long: the scans read new pages first. */
export const ARCHIVE_AFTER_MS = 24 * 3_600_000;
export const CAUGHT_UP_EVERY_MS = 3_600_000;
const BACKLOG_EVERY_MS = 5_000;

export interface PageArchiveSettings {
  /** Pages per pass. */
  limit?: number;
}

export interface PageArchiveDeps {
  db: Db;
  /** null when WREN_PAGES_BUCKET is unset: every pass then fails, saying so. */
  pages: PageStore | null;
  notifier?: Notifier;
}

export function makePageArchive(deps: PageArchiveDeps) {
  return makeLoopObject("PageArchive", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const settings = await loopSettings<PageArchiveSettings>(ctx);
    return runPass<ArchiveStats>(ctx, deps.db, now, {
      name: "archive",
      ledger: { command: PAGE_ARCHIVE_COMMAND, argv: { daemon: true, ...settings } },
      body: async () => {
        if (!deps.pages) throw new Error("no page store: WREN_PAGES_BUCKET is unset");
        return archivePages(deps.db, deps.pages, {
          before: new Date(now.getTime() - ARCHIVE_AFTER_MS),
          ...(settings?.limit ? { limit: settings.limit } : {}),
        });
      },
      delayAfter: (s) => (s.more ? BACKLOG_EVERY_MS : CAUGHT_UP_EVERY_MS),
      retryMs: CAUGHT_UP_EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    }) as Promise<PassOutcome<ArchiveStats>>;
  });
}

export type PageArchive = ReturnType<typeof makePageArchive>;

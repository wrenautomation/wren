/**
 * `wren pages`: crawled page HTML, inline in Postgres or archived to the pages
 * bucket. `archive` drives `PageArchive/all` on the Postgres box.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { pageCounts } from "@wren/research/pages";
import { PAGE_ARCHIVE_KEY, type PageArchive } from "@wren/research/restate";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export function registerPages(program: Command, withDb: WithDb, settings: Settings): Command {
  const pages = program.command("pages").description("crawled page HTML: Postgres or the bucket");
  pages
    .command("count")
    .description("Pages still inline, and archived")
    .action(async () => console.log(JSON.stringify(await withDb(pageCounts), null, 2)));

  const loop = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<PageArchive>({ name: "PageArchive" }, PAGE_ARCHIVE_KEY);
  const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const archive = pages
    .command("archive")
    .description("PageArchive: moves HTML a day old to the pages bucket");
  archive.command("status").action(async () => print(await loop().status()));
  archive
    .command("start")
    .description("Loop: pass after pass while a backlog remains, then hourly")
    .option("--limit <n>", "pages per pass (default 500)")
    .action(async (opts: { limit?: string }) =>
      print(await loop().start(opts.limit ? { limit: Number(opts.limit) } : undefined)),
    );
  archive.command("stop").action(async () => print(await loop().stop()));
  archive
    .command("sync")
    .description("One pass now")
    .action(async () => print(await loop().sync()));
  return pages;
}

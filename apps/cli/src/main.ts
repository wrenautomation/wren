#!/usr/bin/env tsx
/**
 * `wren` ops CLI. Reads go straight to Postgres. Writes go through Restate so
 * they are journaled and single-writer per key.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ConsoleTransport, runWeeklyReport } from "@wren/channel-email";
import { ingressOf, loadEnvFile, loadSettings } from "@wren/config";
import { collectStatus, formatStatusLines, weekSlipped } from "@wren/content";
import { type Client, clientUrl, getClient } from "@wren/core/clients";
import { RENEWAL_KEY, type TokenRenewal } from "@wren/core/content/renewal";
import { createDb, type Db } from "@wren/db";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { registerAds } from "./ads.js";
import { registerBooks } from "./books.js";
import { registerClients } from "./clients.js";
import { registerContent } from "./content.js";
import { registerCrm } from "./crm.js";
import { registerEmail } from "./email.js";
import { registerFetch } from "./fetch.js";
import { registerReview } from "./review.js";
import { registerSms } from "./sms.js";

const rootDir = loadEnvFile(process.cwd(), process.env.WREN_ROOT);
const settings = loadSettings(process.env, { rootDir });

/** Open a one-connection pool for one command and always close it. */
async function open<T>(url: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const handle = createDb(url, { max: 1 });
  try {
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

const withMainDb = <T>(fn: (db: Db) => Promise<T>) => open(settings.databaseUrl, fn);

/** The command's database: the client's with `--client`, else main. */
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const id = program.opts<{ client?: string }>().client;
  if (!id) return withMainDb(fn);
  const client = await withMainDb((db) => getClient(db, id));
  return open(clientUrl(settings.databaseUrl, client), fn);
}

/** A client's database; refuses to fall back to main (a CRM never lands in Wren's own list). */
async function withClientDb<T>(fn: (db: Db, client: Client) => Promise<T>): Promise<T> {
  const id = program.opts<{ client?: string }>().client;
  if (!id) throw new Error("this command needs --client <id> (see `wren clients list`)");
  const client = await withMainDb((db) => getClient(db, id));
  return open(clientUrl(settings.databaseUrl, client), (db) => fn(db, client));
}

/**
 * Commands that honour `--client`. Everything else runs Wren's own loops or the
 * registry, so `--client` there is refused rather than silently ignored.
 */
const CLIENT_SCOPED = new Set(["db", "email", "crm"]);

const program = new Command("wren")
  .description("Wren automation ops")
  .option("--client <id>", "run against this client's database (see `wren clients list`)")
  .showHelpAfterError();

program.hook("preAction", (_root, action) => {
  if (!program.opts<{ client?: string }>().client) return;
  let top: Command = action;
  while (top.parent && top.parent !== program) top = top.parent;
  if (!CLIENT_SCOPED.has(top.name()))
    throw new Error(`\`wren ${top.name()}\` does not take --client`);
});

program
  .command("status")
  .description("Is the content week on track? Exit 1 if Thursday+ with nothing drafted this week.")
  .option("--today <iso>", "override today (YYYY-MM-DD)")
  .action(async (opts: { today?: string }) => {
    const now = opts.today ? new Date(`${opts.today}T00:00:00Z`) : new Date();
    const report = await withMainDb((db) => collectStatus(db, now));
    for (const line of formatStatusLines(report)) console.log(line);
    if (weekSlipped(now, report.draftedThisWeek)) process.exitCode = 1;
  });

const db = program.command("db").description("database");
db.command("check")
  .description("Print applied migration count")
  .action(async () => {
    const n = await withDb(async (d) => {
      const rows = await d.execute<{ n: number }>(
        sql`select count(*)::int n from drizzle.__drizzle_migrations`,
      );
      return rows[0]?.n ?? 0;
    });
    console.log(`migrations applied: ${n}`);
  });

registerClients(program, withMainDb, settings);
registerCrm(program, withClientDb, settings, rootDir);
registerReview(registerEmail(program, withDb, settings, rootDir), withDb);
registerFetch(program, settings);
registerContent(program, withMainDb, settings);
registerAds(program, withMainDb, settings);
registerSms(program, withMainDb, settings);
registerBooks(program, withMainDb, settings, rootDir);

const renewal = () =>
  clients
    .connect(ingressOf(settings))
    .objectClient<TokenRenewal>({ name: "TokenRenewal" }, RENEWAL_KEY);
const tokens = program
  .command("tokens")
  .description("TokenRenewal: autobrowse makes again what lapses within 14 days");
tokens
  .command("status")
  .action(async () => console.log(JSON.stringify(await renewal().status(), null, 2)));
tokens
  .command("start")
  .description("Loop: renew, then sleep until 14 days before the next lapse (1 to 7 days)")
  .action(async () => console.log(JSON.stringify(await renewal().start(), null, 2)));
tokens
  .command("stop")
  .action(async () => console.log(JSON.stringify(await renewal().stop(), null, 2)));
tokens
  .command("renew")
  .description("One pass now")
  .action(async () => console.log(JSON.stringify(await renewal().sync(), null, 2)));

const report = program.command("report").description("periodic reports");
report
  .command("weekly")
  .description("Collect this week's numbers, store the report, print it (no mail)")
  .option("--now <iso>", "period end (default: now)")
  .option("--days <n>", "period length", "7")
  .action(async (opts: { now?: string; days: string }) => {
    const now = opts.now ? new Date(opts.now) : new Date();
    const out = await withMainDb((d) =>
      runWeeklyReport({
        db: d,
        transport: new ConsoleTransport(),
        mail: null,
        now,
        days: Number(opts.days),
      }),
    );
    process.stdout.write(out.body);
    console.error(`stored report ${out.reportId}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  // A failed query's reason (Postgres's own words) rides on the cause.
  if (err instanceof Error && err.cause instanceof Error)
    console.error(`cause: ${err.cause.message}`);
  process.exitCode = 1;
});

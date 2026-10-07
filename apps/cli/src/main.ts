#!/usr/bin/env tsx
/**
 * `wren` ops CLI. Reads go straight to Postgres. Writes go through Restate so
 * they are journaled and single-writer per key.
 */
import { userInfo } from "node:os";
import * as clients from "@restatedev/restate-sdk-clients";
import { ConsoleTransport, runWeeklyReport } from "@wren/channel-email";
import { ingressOf, loadEnvFile, loadSettings } from "@wren/config";
import { collectStatus, formatStatusLines, weekSlipped } from "@wren/content";
import { type AuditSealer, SEALER_KEY } from "@wren/core/audit";
import { type Client, clientUrl, getClient } from "@wren/core/clients";
import { RENEWAL_KEY, type TokenRenewal } from "@wren/core/content/renewal";
import { linkPeople } from "@wren/core/leads";
import {
  type AuditCheck,
  clientDatabases,
  clientDatabaseUrl,
  createDb,
  type Db,
  formatAuditEvent,
  recentAuditEvents,
  sealAudit,
  verifyAudit,
} from "@wren/db";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { registerAds } from "./ads.js";
import { registerBooks } from "./books.js";
import { registerCalendar } from "./calendar.js";
import { registerClients } from "./clients.js";
import { registerContent } from "./content.js";
import { registerCrm } from "./crm.js";
import { registerDelivery } from "./delivery.js";
import { registerDossier } from "./dossier.js";
import { registerDrafts } from "./drafts.js";
import { registerEmail } from "./email.js";
import { registerEnrich } from "./enrich.js";
import { registerEvolve } from "./evolve.js";
import { registerFetch } from "./fetch.js";
import { registerHealth } from "./health.js";
import { registerHooks } from "./hooks.js";
import { registerLearn } from "./learn.js";
import { registerNotes } from "./notes.js";
import { registerPages } from "./pages.js";
import { registerReach } from "./reach.js";
import { registerReview } from "./review.js";
import { registerSearch } from "./search.js";
import { registerSitePages } from "./site-pages.js";
import { registerSms } from "./sms.js";
import { registerSocial } from "./social.js";
import { registerSop } from "./sop.js";
import { registerStudy } from "./study.js";
import { registerTemplates } from "./templates.js";
import { registerTouches } from "./touches.js";
import { registerTrain } from "./train.js";
import { registerVideo } from "./video.js";
import { registerWatch } from "./watch.js";
import { registerWorkflows } from "./workflows.js";

const rootDir = loadEnvFile(process.cwd(), process.env.WREN_ROOT);
const settings = loadSettings(process.env, { rootDir });

/** Who ran the command, kept on every audit event it causes. */
const actor = (() => {
  if (process.env.CLAUDECODE) return "claude-code";
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
})();
/** `wren-cli:<command>`, set before each action; kept on every audit event it causes. */
let app = "wren-cli";

/** Open a one-connection pool for one command and always close it. */
async function open<T>(url: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const handle = createDb(url, { max: 1, app, actor });
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
const CLIENT_SCOPED = new Set([
  "db",
  "email",
  "crm",
  "audit",
  "delivery",
  "sms",
  "hooks",
  "notes",
  "sites",
  "templates",
  "workflows",
]);
/** Under a client-scoped command, the parts that cover every database or only Wren's. */
const NOT_PER_CLIENT = new Set(["audit sealer", "sms numbers", "sms forms", "templates sync"]);

const program = new Command("wren")
  .description("Wren automation ops")
  .option("--client <id>", "run against this client's database (see `wren clients list`)")
  .showHelpAfterError();

program.hook("preAction", (_root, action) => {
  const path: string[] = [];
  for (let c: Command | null = action; c && c !== program; c = c.parent) path.unshift(c.name());
  app = `wren-cli:${path.join(" ")}`;
  if (!program.opts<{ client?: string }>().client) return;
  const top = path[0] ?? "";
  if (!CLIENT_SCOPED.has(top) || NOT_PER_CLIENT.has(path.slice(0, 2).join(" ")))
    throw new Error(`\`wren ${path.slice(0, 2).join(" ")}\` does not take --client`);
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
db.command("link-people")
  .description("Fill the person on text and DM contacts by email, name at the firm, or LinkedIn")
  .action(async () => {
    const [texts, dms] = await withDb(async (d) =>
      Promise.all([linkPeople(d, "sms_contacts"), linkPeople(d, "reach_contacts")]),
    );
    console.log(`linked: ${texts} text contacts, ${dms} DM contacts`);
  });

const audit = program
  .command("audit")
  .description("the audit log: every change to every table, sealed into a hash chain");
audit
  .command("show")
  .description("Newest changes, oldest of them first: table, row key, who, changed columns")
  .option("--table <name>", "only this table")
  .option("--limit <n>", "how many", "20")
  .option("--values", "print old and new values too (rows can hold personal data)")
  .action(async (opts: { table?: string; limit: string; values?: boolean }) => {
    const rows = await withDb((d) =>
      recentAuditEvents(d, {
        limit: Number(opts.limit),
        ...(opts.table ? { table: opts.table } : {}),
      }),
    );
    for (const e of rows.reverse()) console.log(formatAuditEvent(e, opts.values === true));
  });
audit
  .command("seal")
  .description("Seal what finished since the last seal (the sealer loop does this every 15 min)")
  .action(async () => {
    const seal = await withDb((d) => sealAudit(d));
    console.log(
      seal ? `sealed #${seal.id}: ${seal.events} events, hash ${seal.hash}` : "nothing new to seal",
    );
  });
audit
  .command("verify")
  .description("Recompute every seal from its events. Exit 1 if one no longer matches.")
  .option("--all", "main and every client database")
  .action(async (opts: { all?: boolean }) => {
    const checks: Record<string, AuditCheck> = {};
    if (opts.all) {
      if (program.opts<{ client?: string }>().client)
        throw new Error("--all or --client, not both");
      checks.main = await withMainDb(verifyAudit);
      for (const database of await withMainDb(clientDatabases))
        checks[database] = await open(
          clientDatabaseUrl(settings.databaseUrl, database),
          verifyAudit,
        );
    } else checks.this = await withDb(verifyAudit);
    console.log(JSON.stringify(opts.all ? checks : checks.this, null, 2));
    if (Object.values(checks).some((c) => c.broken)) process.exitCode = 1;
  });
const sealer = () =>
  clients
    .connect(ingressOf(settings))
    .objectClient<AuditSealer>({ name: "AuditSealer" }, SEALER_KEY);
const sealing = audit
  .command("sealer")
  .description("AuditSealer: seals main and every client database every 15 minutes");
sealing
  .command("status")
  .action(async () => console.log(JSON.stringify(await sealer().status(), null, 2)));
sealing
  .command("start")
  .description("Loop: seal every database, then again in 15 minutes")
  .action(async () => console.log(JSON.stringify(await sealer().start(), null, 2)));
sealing
  .command("stop")
  .action(async () => console.log(JSON.stringify(await sealer().stop(), null, 2)));
sealing
  .command("sync")
  .description("One pass now")
  .action(async () => console.log(JSON.stringify(await sealer().sync(), null, 2)));

registerClients(program, withMainDb, settings);
registerDelivery(program, withMainDb, settings);
registerHealth(program, withMainDb, settings);
registerCrm(program, withClientDb, settings, rootDir);
registerReview(registerEmail(program, withDb, settings, rootDir), withDb);
registerFetch(program, settings);
registerHooks(program, withMainDb);
registerWorkflows(program, withMainDb, withClientDb, settings);
registerEnrich(program, withMainDb, settings, rootDir);
registerEvolve(program, withMainDb, settings, rootDir);
registerPages(program, withMainDb, settings);
registerContent(program, withMainDb, settings);
registerDrafts(program, withMainDb);
registerTrain(program, withMainDb, (database, fn) =>
  open(clientDatabaseUrl(settings.databaseUrl, database), fn),
);
registerNotes(program, {
  withDb,
  withMainDb,
  client: () => program.opts<{ client?: string }>().client,
});
registerAds(program, withMainDb, settings);
registerSms(program, withDb, settings);
registerReach(program, withMainDb, settings);
registerBooks(program, withMainDb, settings, rootDir);
registerWatch(program, withMainDb, settings, rootDir);
registerLearn(program, withMainDb, settings, rootDir);
registerCalendar(program, withMainDb);
registerSocial(program, settings);
registerStudy(program, withMainDb, settings, rootDir);
registerSop(program, withMainDb, settings, rootDir);
registerDossier(program, withMainDb, rootDir);
registerTouches(program, withMainDb);
registerVideo(program, withMainDb, settings, rootDir);
registerSearch(program, withMainDb, settings, rootDir);
registerSitePages(
  program,
  withMainDb,
  settings,
  rootDir,
  () => program.opts<{ client?: string }>().client,
);
registerTemplates(program, {
  withDb,
  withMainDb,
  onDatabase: (database, fn) => open(clientDatabaseUrl(settings.databaseUrl, database), fn),
  client: () => program.opts<{ client?: string }>().client,
});

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

#!/usr/bin/env tsx
/**
 * `wren` ops CLI. Reads go straight to Postgres. Writes go through Restate so
 * they are journaled and single-writer per key.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { ingressOf, loadEnvFile, loadSettings } from "@wren/config";
import { WREN } from "@wren/core/access";
import { type AuditLogSeal, SEALER_KEY } from "@wren/core/audit";
import { RENEWAL_KEY, type SiteTokenRenew } from "@wren/core/autobrowse/renewal";
import { type Client, clientUrl, getClient, listClients } from "@wren/core/clients";
import { githubRepo } from "@wren/core/github";
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
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { mirrorShapes, WREN_WORKSPACE } from "@wren/pipeline/mirror";
import type { JourneysService } from "@wren/pipeline/restate";
import * as clients from "@wren/runtime/clients";
import { collectStatus, formatStatusLines, weekSlipped } from "@wren/starling-inbound";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { registerAccounts } from "./accounts.js";
import { registerAgent } from "./agent.js";
import { registerAppReviews } from "./app-reviews.js";
import { registerBooks } from "./books.js";
import { registerCalendar } from "./calendar.js";
import { registerCalls } from "./calls.js";
import { registerCampaigns } from "./campaigns.js";
import { registerCanon } from "./canon.js";
import { guardClient } from "./client-scope.js";
import { registerClients } from "./clients.js";
import { registerContent } from "./content.js";
import { registerCrm } from "./crm.js";
import { registerJudge } from "./decide.js";
import { registerDelivery } from "./delivery.js";
import { registerDlq } from "./dlq.js";
import { registerDossier } from "./dossier.js";
import { registerDrafts } from "./drafts.js";
import { registerEgress } from "./egress.js";
import { registerEmail } from "./email.js";
import { registerEnrich } from "./enrich.js";
import { registerFeatures } from "./features.js";
import { registerFetch } from "./fetch.js";
import { registerFolders } from "./folders.js";
import { registerGroups } from "./groups.js";
import { registerHealth } from "./health.js";
import { registerHooks } from "./hooks.js";
import { registerKeys } from "./keys.js";
import { registerLake } from "./lake.js";
import { registerLimits } from "./limits.js";
import { registerListmonk } from "./listmonk.js";
import { registerLoops } from "./loops.js";
import { registerNewsletter } from "./newsletter.js";
import { registerObjects } from "./objects.js";
import { registerPages } from "./pages.js";
import { registerPeople } from "./people.js";
import { type PipelineWrites, registerPipeline } from "./pipeline.js";
import { registerReach } from "./reach.js";
import { registerReview } from "./review.js";
import { registerShape } from "./shape.js";
import { registerSitePages } from "./site-pages.js";
import { registerSms } from "./sms.js";
import { registerSocial } from "./social.js";
import { registerTemplates } from "./templates.js";
import { registerTouches } from "./touches.js";
import { registerTrain } from "./train.js";
import { registerPlaybook, registerVariants } from "./variants.js";
import { registerVideo } from "./video.js";
import { registerWatch } from "./watch.js";
import { registerWebhooks } from "./webhooks.js";
import { registerWorkflows } from "./workflows.js";
import { registerWrite } from "./write.js";

const rootDir = loadEnvFile(process.cwd(), process.env.WREN_ROOT);
const settings = loadSettings(process.env, { rootDir });

/**
 * The agent chat and turn the relay is on (designs/2026-11-11-agent-panel.md, D1): kept on every
 * audit event, so the chat's Changes list finds them. The relay rewrites the file as turns start.
 */
const agentTurn = ((): { chat?: string; turn?: string; by?: string } => {
  const file = process.env.WREN_AGENT_TURN_FILE;
  if (!file) return {};
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const out: { chat?: string; turn?: string; by?: string } = {};
    for (const k of ["chat", "turn", "by"] as const) {
      const v = j[k];
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
})();
/** Who ran the command, kept on every audit event it causes. An agent chat's: `claude-code:<person>`. */
const actor = (() => {
  if (process.env.CLAUDECODE) return agentTurn.by ? `claude-code:${agentTurn.by}` : "claude-code";
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
  const handle = createDb(url, { max: 1, app, actor, chat: agentTurn.chat, turn: agentTurn.turn });
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

const program = new Command("wren")
  .description("Wren automation ops")
  .option("--client <id>", "run against this client's database (see `wren clients list`)")
  .showHelpAfterError();

guardClient(program, (path) => {
  app = `wren-cli:${path.join(" ")}`;
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
    .objectClient<AuditLogSeal>({ name: "AuditLogSeal" }, SEALER_KEY);
const sealing = audit
  .command("sealer")
  .description("AuditLogSeal: seals main and every client database every 15 minutes");
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
registerDlq(program, withMainDb, settings);
registerLoops(program, withMainDb, settings);
registerFeatures(program, withMainDb, settings);
registerLake(program, withMainDb, settings);
registerNewsletter(program, withMainDb, settings);
registerListmonk(program, withMainDb, settings);
registerWebhooks(program, withMainDb, settings);
registerKeys(program, withMainDb);
registerLimits(program, withMainDb);
registerWorkflows(program, withMainDb, withClientDb, settings);
registerEnrich(program, withMainDb, settings, rootDir);
registerPages(program, withMainDb, settings);
const content = registerContent(program, withMainDb, settings);
content
  .command("status")
  .description("Is the content week on track? Exit 1 if Thursday+ with nothing drafted this week.")
  .option("--today <iso>", "override today (YYYY-MM-DD)")
  .action(async (opts: { today?: string }) => {
    const now = opts.today ? new Date(`${opts.today}T00:00:00Z`) : new Date();
    const report = await withMainDb((db) => collectStatus(db, now));
    for (const line of formatStatusLines(report)) console.log(line);
    if (weekSlipped(now, report.draftedThisWeek)) process.exitCode = 1;
  });

registerWrite(content, withDb, settings);
registerDrafts(content, withMainDb);
registerJudge(content, withMainDb, {
  llmEnvPath: settings.llmEnvPath,
  rootDir,
  ingress: ingressOf(settings),
});
registerTrain(content, withMainDb);
registerSms(program, withDb, settings);
registerReach(program, withMainDb, settings);
registerAccounts(program, withMainDb, settings);
registerBooks(program, withMainDb, settings, rootDir);
registerWatch(program, withMainDb, settings, rootDir);
registerVariants(program, withDb, settings, actor, rootDir);
registerPlaybook(program, withDb, settings, rootDir);
registerFolders(program, withDb, actor);
registerCalendar(program, withMainDb);
registerCalls(program, withMainDb, settings, rootDir);
registerAppReviews(program, withMainDb, rootDir);
registerSocial(program, settings);
registerCanon(program, withMainDb, settings, rootDir);
registerDossier(program, withMainDb, rootDir);
registerTouches(program, withMainDb);
registerObjects(program, { withDb, by: actor });
const journeyWrites: PipelineWrites = {
  journeys: () =>
    clients
      .connect(ingressOf(settings))
      .serviceClient<JourneysService>({ name: "JourneyMove" }) as ReturnType<
      PipelineWrites["journeys"]
    >,
  client: () => {
    const id = program.opts<{ client?: string }>().client;
    return !id || id === WREN ? null : id;
  },
};
registerPipeline(program, withDb, withMainDb, journeyWrites);
// The shape's git mirror: a private repo, off without its token (designs/2026-10-19-business-map.md).
const shapeMirror = (db: Db, workspace: string) =>
  mirrorShapes(db, {
    files: settings.shapesGithubToken
      ? githubRepo({
          token: settings.shapesGithubToken,
          repo: settings.shapesGithubRepo,
          api: settings.shapesGithubApi,
        })
      : null,
    repo: settings.shapesGithubRepo,
    workspace,
  });
registerShape(program, {
  withDb,
  withViews: (fn) =>
    withMainDb(async (main) => {
      const id = program.opts<{ client?: string }>().client;
      return fn(main, id ? (await getClient(main, id)).id : WREN);
    }),
  writes: journeyWrites,
  mirror: (db) => {
    const id = program.opts<{ client?: string }>().client;
    return shapeMirror(db, !id || id === WREN ? WREN_WORKSPACE : id);
  },
  mirrorAll: () =>
    withMainDb(async (main) => {
      const runs = [{ workspace: WREN_WORKSPACE, result: await shapeMirror(main, WREN_WORKSPACE) }];
      for (const client of await listClients(main))
        runs.push({
          workspace: client.id,
          result: await open(clientUrl(settings.databaseUrl, client), (db) =>
            shapeMirror(db, client.id),
          ),
        });
      return runs;
    }),
});
registerGroups(program, { withDb });
registerCampaigns(program, withDb);
registerPeople(program, {
  withDb,
  withMainDb,
  settings,
  client: () => program.opts<{ client?: string }>().client,
  llm: (name) => {
    // Provider keys load from the model keys file (or the host's env); never logged.
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return makeLlm(name, process.env);
  },
});
registerVideo(program, withMainDb, settings, rootDir);
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
    .objectClient<SiteTokenRenew>({ name: "SiteTokenRenew" }, RENEWAL_KEY);
const tokens = program
  .command("tokens")
  .description("SiteTokenRenew: autobrowse makes again what lapses within 14 days");
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

registerAgent(program);
registerEgress(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  // A failed query's reason (Postgres's own words) rides on the cause.
  if (err instanceof Error && err.cause instanceof Error)
    console.error(`cause: ${err.cause.message}`);
  process.exitCode = 1;
});

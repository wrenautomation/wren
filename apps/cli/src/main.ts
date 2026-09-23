#!/usr/bin/env tsx
/**
 * `wren` ops CLI. Reads go straight to Postgres. Writes go through Restate so
 * they are journaled and single-writer per key.
 */
import { readFile } from "node:fs/promises";
import * as clients from "@restatedev/restate-sdk-clients";
import { ConsoleTransport, runWeeklyReport } from "@wren/channel-email";
import {
  collectStatus,
  draftCount,
  draftsOverdue,
  formatStatusLines,
  listNotes,
} from "@wren/channel-linkedin";
import type { LinkedinInbox } from "@wren/channel-linkedin/restate";
import { INBOX_KEY } from "@wren/channel-linkedin/restate";
import { ingressOf, loadEnvFile, loadSettings } from "@wren/config";
import { RENEWAL_KEY, type TokenRenewal } from "@wren/core/content/renewal";
import { createDb } from "@wren/db";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { registerAds } from "./ads.js";
import { registerContent } from "./content.js";
import { registerEmail } from "./email.js";
import { registerFetch } from "./fetch.js";
import { registerReview } from "./review.js";

const BODY_PREVIEW_CHARS = 60;
const rootDir = loadEnvFile();
const settings = loadSettings(process.env, { rootDir });

/** Open the pool for one command and always close it. */
async function withDb<T>(fn: (db: ReturnType<typeof createDb>["db"]) => Promise<T>): Promise<T> {
  const handle = createDb(settings.databaseUrl, { max: 1 });
  try {
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

function inboxClient() {
  const ingress = clients.connect(ingressOf(settings));
  return ingress.objectClient<LinkedinInbox>({ name: "LinkedinInbox" }, INBOX_KEY);
}

const program = new Command("wren").description("Wren automation ops").showHelpAfterError();

program
  .command("status")
  .description("Is the week on track? Exit 1 if Thursday+ with no draft.")
  .option("--today <iso>", "override today (YYYY-MM-DD)")
  .action(async (opts: { today?: string }) => {
    const today = opts.today ? new Date(`${opts.today}T00:00:00Z`) : startOfTodayUtc();
    const report = await withDb((db) => collectStatus(db, today));
    for (const line of formatStatusLines(report)) console.log(line);
    if (draftsOverdue(today, draftCount(report))) process.exitCode = 1;
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

const notes = program.command("notes").description("raw notes");
notes
  .command("add [file]")
  .description("Add a note from a file, or stdin when omitted or '-'")
  .action(async (file?: string) => {
    const body = !file || file === "-" ? await readStdin() : await readFile(file, "utf8");
    if (body.trim() === "") {
      console.error("empty note");
      process.exitCode = 1;
      return;
    }
    const { id } = await inboxClient().add(body);
    console.log(`added ${id}`);
  });
notes
  .command("ingest")
  .description("Ingest every note in the inbox dir")
  .action(async () => {
    const { ingested } = await inboxClient().ingest();
    console.log(`ingested ${ingested}`);
  });
notes
  .command("ls")
  .option("--status <status>", "new | used | archived", "new")
  .action(async (opts: { status: string }) => {
    const rows = await withDb((d) => listNotes(d, opts.status));
    for (const r of rows) {
      const preview = r.body.replace(/\s+/g, " ").slice(0, BODY_PREVIEW_CHARS);
      console.log(
        `${r.id}  ${r.createdAt.toISOString().slice(0, 10)}  ${r.source.padEnd(5)}  ${preview}`,
      );
    }
  });

registerReview(registerEmail(program, withDb, settings, rootDir), withDb);
registerFetch(program, settings);
registerContent(program, withDb, settings);
registerAds(program, withDb, settings);

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
    const out = await withDb((d) =>
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

export function startOfTodayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

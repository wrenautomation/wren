/**
 * `wren --client <id> crm …`: a client's CRM export in, the health report out,
 * and the CRM's own addresses checked. Always a client's database.
 */
import { resolve } from "node:path";
import { defaultLocalChecker, makeVerifier } from "@wren/channel-email";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import {
  CRM_FORMATS,
  CrmCsvSource,
  checkCrmEmails,
  crmHealth,
  formatCrmHealth,
  runCrmImport,
} from "@wren/reactivation";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const positive = (flag: string) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number above 0`);
  return n;
};

export function registerCrm(program: Command, withClientDb: WithDb, settings: Settings): void {
  const crm = program.command("crm").description("a client's CRM export: import, health, verify");

  crm
    .command("formats")
    .description("List the CRM export formats")
    .action(() => {
      for (const f of CRM_FORMATS.values()) console.log(`${f.name.padEnd(12)}  ${f.help}`);
    });

  crm
    .command("import <path>")
    .description("Import a CRM export (CSV with a header row)")
    .option("--format <name>", `one of ${[...CRM_FORMATS.keys()].join(", ")}`, "crm-generic")
    .option("--niche <name>", "stamp new companies with this niche")
    .action(async (path: string, opts: { format: string; niche?: string }) => {
      const format = CRM_FORMATS.get(opts.format);
      if (!format) throw new Error(`unknown format ${opts.format}; see \`wren crm formats\``);
      // Built before the database opens: an unreadable header fails with nothing written.
      const source = new CrmCsvSource(format, resolve(path));
      console.log(
        `headers: ${Object.entries(source.headers)
          .map(([field, h]) => `${field}=${h}`)
          .join("  ")}`,
      );
      const { batch, stats } = await withClientDb((db) =>
        runCrmImport(db, source, { niche: opts.niche ?? null }),
      );
      console.log(`import ${batch.id}: ${JSON.stringify(stats)}`);
      console.log("next: `wren crm verify`, then `wren crm health`");
    });

  crm
    .command("health")
    .description("The health report: duplicates, dead emails, staleness, owners, the send gate")
    .option("--json", "print the report as JSON")
    .action(async (opts: { json?: boolean }) => {
      const report = await withClientDb((db) => crmHealth(db));
      if (opts.json) console.log(JSON.stringify(report, null, 2));
      else for (const line of formatCrmHealth(report)) console.log(line);
      if (!report.gate.ok) process.exitCode = 1;
    });

  crm
    .command("verify")
    .description("Check each CRM address once: local check, then the verifier")
    .option("--verifier <name>", "smtp, smtp-direct or fake", settings.verifier)
    .option("--limit <n>", "check at most n addresses", positive("--limit"))
    .option("--concurrency <n>", "mail servers talked to at once", positive("--concurrency"), 8)
    .action(async (opts: { verifier: string; limit?: number; concurrency: number }) => {
      const verifier = await makeVerifier(opts.verifier, {
        smtpProbeUrl: settings.smtpProbeUrl ?? null,
        smtpProbeToken: settings.smtpProbeToken ?? null,
        smtpHelo: settings.smtpHelo ?? null,
      });
      const stats = await withClientDb((db) =>
        checkCrmEmails(db, verifier, defaultLocalChecker(), {
          concurrency: opts.concurrency,
          ...(opts.limit ? { limit: opts.limit } : {}),
        }),
      );
      console.log(JSON.stringify(stats));
      if (stats.aborted) process.exitCode = 1;
    });
}

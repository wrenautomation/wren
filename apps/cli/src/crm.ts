/**
 * `wren --client <id> crm …`: a client's CRM export in, then `crm run` does
 * every stage that is due and `crm status` says where things stand. The
 * single-stage commands (verify, lookup) are for debugging one stage. Always a
 * client's database.
 */
import { resolve } from "node:path";
import { defaultLocalChecker, makeVerifier } from "@wren/channel-email";
import type { Settings } from "@wren/config";
import { recordedRun } from "@wren/core";
import type { Client } from "@wren/core/clients";
import type { Db } from "@wren/db";
import {
  CRM_FORMATS,
  CrmCsvSource,
  checkCrmEmails,
  crmHealth,
  crmStatus,
  formatCrmHealth,
  formatCrmStatus,
  lookUpCrmPeople,
  runCrm,
  runCrmImport,
} from "@wren/reactivation";
import type { Command } from "commander";
import { ingressSites } from "./sites.js";

type WithDb = <T>(fn: (db: Db, client: Client) => Promise<T>) => Promise<T>;

const positive = (flag: string) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number above 0`);
  return n;
};

export function registerCrm(program: Command, withClientDb: WithDb, settings: Settings): void {
  const crm = program
    .command("crm")
    .description("a client's CRM: import, then `crm run` and `crm status`");

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
      console.log("next: `wren --client <id> crm run`");
    });

  crm
    .command("status")
    .description("Where this client stands and what `crm run` does next")
    .option("--json", "print the status as JSON")
    .action(async (opts: { json?: boolean }) => {
      const status = await withClientDb(async (db, client) => ({
        ...(await crmStatus(db)),
        client: client.id,
      }));
      if (opts.json) console.log(JSON.stringify(status, null, 2));
      else
        for (const line of formatCrmStatus(status))
          console.log(line.replaceAll("<id>", status.client));
    });

  crm
    .command("run")
    .description("Do every stage that is due, in order; Ctrl-C pauses, running again resumes")
    .option("--limit <n>", "at most n units per stage", positive("--limit"))
    .option("--no-linkedin", "search only, even when the client has a LinkedIn account")
    .option("--verifier <name>", "smtp, smtp-direct or fake", settings.verifier)
    .action(async (opts: { limit?: number; linkedin: boolean; verifier: string }) => {
      const verifier = await makeVerifier(opts.verifier, {
        smtpProbeUrl: settings.smtpProbeUrl ?? null,
        smtpProbeToken: settings.smtpProbeToken ?? null,
        smtpHelo: settings.smtpHelo ?? null,
      });
      const deps = { verifier, checker: defaultLocalChecker(), sites: ingressSites(settings) };
      const { client, run, stages, status } = await withClientDb(async (db, client) => {
        const linkedin = opts.linkedin ? (client.accounts?.linkedin ?? null) : null;
        const argv = { ...opts, linkedin };
        const { run, stats } = await recordedRun(db, { command: "crm run", argv }, async (r) => ({
          stages: await runCrm(
            db,
            deps,
            { linkedin, runId: r.id, ...(opts.limit ? { limit: opts.limit } : {}) },
            (s) => console.log(`${s.stage}: ${JSON.stringify(s.stats)}`),
          ),
        }));
        return { client, run, stages: stats.stages, status: await crmStatus(db) };
      });
      console.log(
        `run ${run.id}: ${stages.length ? stages.map((s) => s.stage).join(", ") : "nothing was due"}`,
      );
      for (const line of formatCrmStatus(status)) console.log(line.replaceAll("<id>", client.id));
      if (stages.some((s) => s.stats.aborted)) process.exitCode = 1;
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

  crm
    .command("lookup")
    .description("Where is each CRM contact now: search, then LinkedIn when the client allows it")
    .option("--limit <n>", "look up at most n people", positive("--limit"))
    .option("--concurrency <n>", "people looked up at once", positive("--concurrency"), 2)
    .option("--no-linkedin", "search only, even when the client has a LinkedIn account")
    .option("--again", "look up people already looked up, too")
    .action(
      async (opts: { limit?: number; concurrency: number; linkedin: boolean; again?: boolean }) => {
        const sites = ingressSites(settings);
        const { run, stats } = await withClientDb(async (db, client) => {
          const linkedin = opts.linkedin ? (client.accounts?.linkedin ?? null) : null;
          const argv = { ...opts, linkedin };
          return recordedRun(db, { command: "crm lookup", argv }, (r) =>
            lookUpCrmPeople(db, sites, {
              linkedin,
              concurrency: opts.concurrency,
              again: opts.again ?? false,
              runId: r.id,
              ...(opts.limit ? { limit: opts.limit } : {}),
            }),
          );
        });
        console.log(`run ${run.id}: ${JSON.stringify(stats)}`);
        if (stats.aborted) process.exitCode = 1;
      },
    );
}

/**
 * `wren --client <id> crm …`: a client's CRM export in, then `crm run` does
 * every stage that is due, `crm status` says where things stand and `crm top`
 * shows who to call first. The single-stage commands (verify, lookup) are for
 * debugging one stage. `crm emails`, `approve`, `skip` and `book` are the
 * operator's side of the portal's writes. `crm loop` runs it all on the
 * worker instead. Always a client's database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as restate from "@restatedev/restate-sdk-clients";
import { defaultLocalChecker, makeVerifier } from "@wren/channel-email";
import type { InboxScheduler, SendScheduler } from "@wren/channel-email/restate";
import { ingressOf, type Settings } from "@wren/config";
import { recordedRun, runFeed } from "@wren/core";
import type { Client } from "@wren/core/clients";
import type { Db } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import {
  approveDrafts,
  CRM_FORMATS,
  CRM_STAGES,
  CrmCsvSource,
  type CrmStage,
  checkCrmEmails,
  crmHealth,
  crmStatus,
  EMAIL_FILTERS,
  type EmailFilter,
  formatCrmHealth,
  formatCrmStatus,
  formatRanked,
  lookUpCrmPeople,
  markMeetingBooked,
  portalEmails,
  rankedContacts,
  reactivationSettingsOf,
  readClientProfile,
  redraftAwaiting,
  runCrm,
  runCrmImport,
  seedDemo,
  setClientProfile,
  skipDrafts,
} from "@wren/reactivation";
import type { Reactivation } from "@wren/reactivation/restate";
import { PoliteFetcher, userAgent } from "@wren/research/fetch";
import type { Command } from "commander";
import { ingressSites } from "./sites.js";

type WithDb = <T>(fn: (db: Db, client: Client) => Promise<T>) => Promise<T>;

/** What compose needs from the registry and the client's database. */
const composeInputs = async (db: Db, client: Client) => ({
  settings: reactivationSettingsOf(client.products),
  profile: await readClientProfile(db),
  demo: client.demo,
});

const ids = (args: string[]): number[] =>
  args.map((a) => {
    const n = Number(a);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`not an id: ${a}`);
    return n;
  });

const positive = (flag: string) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number above 0`);
  return n;
};

export function registerCrm(
  program: Command,
  withClientDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
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

  const profile = crm
    .command("profile")
    .description("The firm's profile: what the emails say and who gets the replies")
    .action(async () => {
      const row = await withClientDb((db) => readClientProfile(db));
      console.log(
        row ? JSON.stringify(row, null, 2) : "no profile yet: `crm profile set <file.json>`",
      );
    });
  profile
    .command("set <file>")
    .description(
      "Replace it from a JSON file: firm, sells, feeAvg, voice, recruiters, defaultRecruiter, signature",
    )
    .action(async (file: string) => {
      const input = JSON.parse(readFileSync(resolve(file), "utf8")) as unknown;
      const row = await withClientDb((db) => setClientProfile(db, input));
      console.log(`profile set: ${row.firm}, ${row.recruiters.length} recruiter(s)`);
    });

  crm
    .command("status")
    .description("Where this client stands and what `crm run` does next")
    .option("--json", "print the status as JSON")
    .action(async (opts: { json?: boolean }) => {
      const status = await withClientDb(async (db, client) => ({
        ...(await crmStatus(db, { compose: await composeInputs(db, client) })),
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
    .option("--only <stages>", `only these, comma separated: ${CRM_STAGES.join(", ")}`)
    .action(
      async (opts: { limit?: number; linkedin: boolean; verifier: string; only?: string }) => {
        const only = opts.only?.split(",").map((x) => x.trim()) as CrmStage[] | undefined;
        const bad = only?.filter((x) => !CRM_STAGES.includes(x));
        if (bad?.length) throw new Error(`--only: no stage ${bad.join(", ")}`);
        const verifier = await makeVerifier(opts.verifier, {
          smtpProbeUrl: settings.smtpProbeUrl ?? null,
          smtpProbeToken: settings.smtpProbeToken ?? null,
          smtpHelo: settings.smtpHelo ?? null,
        });
        // Key fleets and provider keys live in llm.env (or the host's env); never logged.
        loadLlmEnv(settings.llmEnvPath, rootDir);
        const deps = {
          verifier,
          checker: defaultLocalChecker(),
          sites: ingressSites(settings, "wren:crm-run"),
          // Company sites and job boards: identified, short timeouts, one retry.
          fetcher: settings.fetchContact
            ? new PoliteFetcher(userAgent(settings.fetchContact), { timeout: 10, retries: 1 })
            : null,
          llm:
            settings.llm === "fake"
              ? null
              : makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel }),
        };
        if (!deps.fetcher)
          console.log("WREN_FETCH_CONTACT unset: job boards skipped, LinkedIn only");
        const { client, run, stages, status } = await withClientDb(async (db, client) => {
          const linkedin = opts.linkedin ? (client.accounts?.linkedin ?? null) : null;
          const argv = { ...opts, linkedin };
          const compose = await composeInputs(db, client);
          const { run, stats } = await recordedRun(db, { command: "crm run", argv }, async (r) => ({
            stages: await runCrm(
              db,
              deps,
              {
                linkedin,
                compose,
                runId: r.id,
                feed: runFeed(db, r.id),
                ...(opts.limit ? { limit: opts.limit } : {}),
                ...(only ? { only } : {}),
              },
              (s) => console.log(`${s.stage}: ${JSON.stringify(s.stats)}`),
            ),
          }));
          return { client, run, stages: stats.stages, status: await crmStatus(db, { compose }) };
        });
        console.log(
          `run ${run.id}: ${stages.length ? stages.map((s) => s.stage).join(", ") : "nothing was due"}`,
        );
        for (const line of formatCrmStatus(status)) console.log(line.replaceAll("<id>", client.id));
        if (stages.some((s) => s.stats.aborted)) process.exitCode = 1;
      },
    );

  const loop = crm
    .command("loop")
    .description(
      "The client's loop on the worker: works what is due every 10 min and runs its mailboxes",
    );
  const ingress = () => restate.connect(ingressOf(settings));
  const loopOf = async () => {
    const id = await withClientDb(async (_db, client) => client.id);
    return { id, object: ingress().objectClient<Reactivation>({ name: "Reactivation" }, id) };
  };
  loop
    .command("start")
    .description("Start it (once per client); `reactivation.on` then turns the work on and off")
    .action(async () => {
      const { id, object } = await loopOf();
      await object.start();
      console.log(`reactivation loop ${id} started`);
      console.log(`on/off: \`wren clients set ${id} --set reactivation.on=true\``);
    });
  loop
    .command("stop")
    .description("Stop it and every mailbox loop it started, after the pass in flight")
    .action(async () => {
      const { id, object } = await loopOf();
      // Its stop stops the mailbox loops it started.
      await object.stop();
      console.log(`reactivation loop ${id} stopped, and its mailboxes`);
    });
  loop
    .command("status")
    .description("The last pass, and each mailbox loop")
    .option("--json", "print as JSON")
    .action(async (opts: { json?: boolean }) => {
      const { id, object } = await loopOf();
      const status = await object.status();
      const loops = status.last?.stats?.loops ?? { send: [], inbox: [] };
      const mailboxes = {
        send: await Promise.all(
          loops.send.map((k) =>
            ingress().objectClient<SendScheduler>({ name: "SendScheduler" }, k).status(),
          ),
        ),
        inbox: await Promise.all(
          loops.inbox.map((k) =>
            ingress().objectClient<InboxScheduler>({ name: "InboxScheduler" }, k).status(),
          ),
        ),
      };
      if (opts.json) {
        console.log(JSON.stringify({ ...status, mailboxes }, null, 2));
        return;
      }
      const last = status.last;
      console.log(
        `reactivation ${id}: ${status.running ? "running" : "stopped"}` +
          (last ? `, last pass ${last.now}` : ", no pass yet"),
      );
      if (last?.error) console.log(`  failed: ${last.error}`);
      if (last?.stats?.off) console.log(`  idle: ${last.stats.off}`);
      for (const s of last?.stats?.stages ?? [])
        console.log(`  ${s.stage}: ${JSON.stringify(s.stats)}`);
      const handoff = last?.stats?.handoff;
      if (handoff) {
        const { sent: _, errors, ...counts } = handoff;
        console.log(`  handoff: ${JSON.stringify(counts)}`);
        for (const e of errors) console.log(`    ${e}`);
      }
      for (const m of mailboxes.send)
        console.log(`  send  ${m.sender}: ${m.running ? "running" : "stopped"}`);
      for (const m of mailboxes.inbox)
        console.log(`  inbox ${m.key}: ${m.running ? "running" : "stopped"}`);
    });

  crm
    .command("top")
    .description("Who to call first: best score first, with why and the brief")
    .option("--limit <n>", "how many", positive("--limit"), 20)
    .option("--json", "print as JSON")
    .action(async (opts: { limit: number; json?: boolean }) => {
      const list = await withClientDb((db) => rankedContacts(db, { limit: opts.limit }));
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else if (!list.length) console.log("no scores yet: `wren --client <id> crm run`");
      else for (const line of formatRanked(list)) console.log(line);
    });

  crm
    .command("emails")
    .description("What the composer wrote and where each stands; the ids are for approve and skip")
    .option("--filter <f>", EMAIL_FILTERS.join(", "), "awaiting")
    .option("--json", "print as JSON")
    .action(async (opts: { filter: string; json?: boolean }) => {
      if (!EMAIL_FILTERS.includes(opts.filter as EmailFilter))
        throw new Error(`--filter is one of ${EMAIL_FILTERS.join(", ")}`);
      const page = await withClientDb((db, client) =>
        portalEmails(db, {
          filter: opts.filter as EmailFilter,
          approval: reactivationSettingsOf(client.products).approval,
        }),
      );
      if (opts.json) return console.log(JSON.stringify(page, null, 2));
      console.log(
        `${page.total} ${opts.filter} (${Object.entries(page.counts)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")})`,
      );
      for (const r of page.rows)
        console.log(
          `\n#${r.enrollmentId} ${r.status}: ${r.name}, ${r.firm} <${r.to}> from ${r.from}\n  ${r.subject ?? ""}\n  ${r.opener.replaceAll("\n", "\n  ")}`,
        );
    });

  crm
    .command("approve [ids...]")
    .description("Send these emails (ids from `crm emails`), as the operator")
    .option("--all", "every email waiting")
    .action(async (args: string[], opts: { all?: boolean }) => {
      if (!opts.all && !args.length) throw new Error("give ids, or --all");
      const out = await withClientDb((db) =>
        db.transaction((tx) =>
          approveDrafts(tx, opts.all ? { all: true } : { enrollmentIds: ids(args) }, "operator"),
        ),
      );
      console.log(
        `approved ${out.done.length}${out.skipped.length ? `; not waiting: ${out.skipped.join(", ")}` : ""}`,
      );
    });

  crm
    .command("redraft [ids...]")
    .description("Write drafts still waiting for approval again, with today's composer and brief")
    .option("--all", "every draft still waiting that nobody edited")
    .action(async (args: string[], opts: { all?: boolean }) => {
      if (!opts.all && !args.length) throw new Error("give ids, or --all");
      if (settings.llm === "fake") throw new Error("redraft needs a real model, not the fake");
      loadLlmEnv(settings.llmEnvPath, rootDir);
      const llm = makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
      const stats = await withClientDb(async (db, client) => {
        const { settings: rx, profile } = await composeInputs(db, client);
        const { stats } = await recordedRun(
          db,
          { command: "crm redraft", argv: { ...opts, ids: args } },
          async (r) =>
            redraftAwaiting(db, llm, {
              profile,
              senders: rx.senders,
              ...(opts.all ? {} : { enrollmentIds: ids(args) }),
              runId: r.id,
            }),
        );
        return stats;
      });
      console.log(JSON.stringify(stats));
      if (stats.aborted) process.exitCode = 1;
    });

  crm
    .command("skip <ids...>")
    .description("Don't send these emails; the composer won't write to them again")
    .action(async (args: string[]) => {
      const out = await withClientDb((db) =>
        skipDrafts(db, { enrollmentIds: ids(args) }, "operator"),
      );
      console.log(
        `skipped ${out.done.length}${out.skipped.length ? `; not waiting: ${out.skipped.join(", ")}` : ""}`,
      );
    });

  crm
    .command("book <replyId>")
    .description("Mark a reply as a meeting booked (the billing unit); --undo takes it back")
    .option("--undo", "take the mark back")
    .action(async (arg: string, opts: { undo?: boolean }) => {
      const [threadEventId] = ids([arg]);
      const out = await withClientDb(async (db) =>
        markMeetingBooked(
          db,
          { threadEventId: threadEventId as number, booked: !opts.undo, by: "operator" },
          await readClientProfile(db),
        ),
      );
      console.log(
        out.bookedAt ? `booked ${out.bookedAt.toISOString()} by ${out.by}` : "not booked",
      );
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
        const sites = ingressSites(settings, "wren:crm-lookup");
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

  crm
    .command("seed-demo")
    .description(
      "Demo only: replace the list with one built from an agency's site (its customers, people who hire there)",
    )
    .requiredOption("--agency <url>", "the agency's site")
    .option("--name <name>", "the agency's name (default: its home page title)")
    .option("--companies <n>", "customers to use at most", positive("--companies"), 40)
    .option("--per-company <n>", "people per customer at most", positive("--per-company"), 2)
    .option("--csv <path>", "also save the export here (keep it out of the repo)")
    .action(
      async (opts: {
        agency: string;
        name?: string;
        companies: number;
        perCompany: number;
        csv?: string;
      }) => {
        if (!settings.fetchContact)
          throw new Error("seed-demo reads sites: set WREN_FETCH_CONTACT");
        if (settings.llm === "fake")
          throw new Error("seed-demo reads the agency's site with an LLM: set WREN_LLM");
        loadLlmEnv(settings.llmEnvPath, rootDir);
        const deps = {
          fetcher: new PoliteFetcher(userAgent(settings.fetchContact), { timeout: 10, retries: 1 }),
          sites: ingressSites(settings, "wren:crm-seed-demo"),
          llm: makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel }),
        };
        const { client, run, stats } = await withClientDb(async (db, client) => {
          if (!client.demo)
            throw new Error(`${client.id} is not a demo client: seed-demo replaces its whole list`);
          const { run, stats } = await recordedRun(
            db,
            { command: "crm seed-demo", argv: { ...opts } },
            async (r) => {
              const { csv, stats } = await seedDemo(db, deps, {
                agency: opts.agency,
                agencyName: opts.name ?? null,
                companies: opts.companies,
                perCompany: opts.perCompany,
                runId: r.id,
                onProgress: (line) => console.log(line),
              });
              if (opts.csv) writeFileSync(resolve(opts.csv), csv);
              return stats;
            },
          );
          return { client, run, stats };
        });
        console.log(
          `run ${run.id}: ${JSON.stringify({ ...stats, dropped: stats.dropped.length })}`,
        );
        if (opts.csv) console.log(`saved ${resolve(opts.csv)}`);
        console.log(`next: wren --client ${client.id} crm run`);
      },
    );
}

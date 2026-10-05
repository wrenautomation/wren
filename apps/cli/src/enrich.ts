/**
 * `wren enrich`: research stages run from the operator's machine, wide. The pool loop
 * crawls 10 firms a pass; a fresh niche of 20k sites wants a few dozen at once.
 * Crawl-once holds: a firm with any document is skipped, so a re-run resumes.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { recheckLeads, recheckNiche } from "@wren/channel-email";
import { nextToEnroll } from "@wren/channel-email/outreach";
import type { Settings } from "@wren/config";
import { recordedRun } from "@wren/core";
import { atomic, type Db } from "@wren/db";
import { crawlHintsFor, NICHE_NAMES, requireNiche } from "@wren/niches";
import {
  addCrawlStats,
  crawlCompany,
  DEFAULT_EXTRACTION_SPEC,
  emptyCrawlStats,
  exportReadings,
  loadReadings,
  PROFILES_COMMAND,
  type ReadingFirm,
  ReadingResult,
  runProfiles,
  selectCrawlTargets,
} from "@wren/research/enrichment";
import { PoliteFetcher, userAgent } from "@wren/research/fetch";
import type { Command } from "commander";
import { ingressSites } from "./sites.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export function registerEnrich(program: Command, withDb: WithDb, settings: Settings): Command {
  const enrich = program.command("enrich").description("research stages, run wide from here");

  enrich
    .command("crawl")
    .description("Crawl a niche's uncrawled firm sites into documents, many at once")
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .option("--limit <n>", "firms this run", "1000")
    .option("--concurrency <n>", "firms at once (each host still paced)", "60")
    .option("--pages <n>", "pages per site", "5")
    .option("--timeout <s>", "seconds per request; dead sites are most of the wait", "8")
    .action(
      async (opts: {
        niche: string;
        limit: string;
        concurrency: string;
        pages: string;
        timeout: string;
      }) => {
        const niche = requireNiche(opts.niche);
        if (niche === null) throw new Error(`unknown niche ${opts.niche}`);
        if (!settings.fetchContact) throw new Error("WREN_FETCH_CONTACT is not set");
        const fetcher = new PoliteFetcher(userAgent(settings.fetchContact), {
          timeout: Number(opts.timeout),
          retries: 0,
        });
        const hints = [...crawlHintsFor(niche)];
        await withDb(async (db) => {
          const targets = await selectCrawlTargets(db, { niche, limit: Number(opts.limit) });
          let stats = emptyCrawlStats();
          let done = 0;
          let failed = 0;
          const queue = [...targets];
          const worker = async () => {
            for (let c = queue.shift(); c; c = queue.shift()) {
              try {
                // A watchdog: one hung socket must not park a worker for the rest of the run.
                const unit = await Promise.race([
                  crawlCompany(db, fetcher, c, {
                    pagesPerSite: Number(opts.pages),
                    extraHints: hints,
                  }),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("gave up after 120s")), 120_000).unref(),
                  ),
                ]);
                stats = addCrawlStats(stats, unit);
              } catch (err) {
                failed += 1;
                console.error(`company ${c.id}: ${(err as Error).message}`);
              }
              done += 1;
              if (done % 25 === 0) console.log(`${done}/${targets.length}`);
            }
          };
          await Promise.all(Array.from({ length: Number(opts.concurrency) }, worker));
          console.log(`crawl: ${JSON.stringify({ firms: targets.length, failed, ...stats })}`);
        });
      },
    );

  enrich
    .command("read-export")
    .description(
      "Write a niche's unnamed firms' leadership excerpts as JSONL batches for an outside reader",
    )
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .requiredOption("--out <dir>", "where batch-NNN.jsonl files go (keep lead data out of git)")
    .option("--reader <name>", "who reads; firms it already read are skipped", READER)
    .option("--batch <n>", "firms per file", "100")
    .option("--limit <n>", "firms in all")
    .action(
      async (opts: {
        niche: string;
        out: string;
        reader: string;
        batch: string;
        limit?: string;
      }) => {
        const niche = requireNiche(opts.niche);
        if (niche === null) throw new Error(`unknown niche ${opts.niche}`);
        const firms = await withDb((db) =>
          exportReadings(db, {
            niche,
            reader: opts.reader,
            ...(opts.limit ? { limit: Number(opts.limit) } : {}),
          }),
        );
        const size = Number(opts.batch);
        let files = 0;
        for (let i = 0; i < firms.length; i += size, files += 1) {
          const lines = firms.slice(i, i + size).map((f) => JSON.stringify(f));
          writeFileSync(
            `${opts.out}/batch-${String(files).padStart(3, "0")}.jsonl`,
            `${lines.join("\n")}\n`,
          );
        }
        console.log(`read-export: ${firms.length} firms in ${files} files`);
      },
    );

  enrich
    .command("read-load")
    .description(
      "Ground and load an outside reader's results (batch-NNN.json beside each batch-NNN.jsonl)",
    )
    .requiredOption("--dir <dir>", "the read-export directory")
    .option("--reader <name>", "who read", READER)
    .action(async (opts: { dir: string; reader: string }) => {
      const exported: ReadingFirm[] = [];
      const results: ReadingResult[] = [];
      let bad = 0;
      for (const f of readdirSync(opts.dir).filter((n) => /^batch-\d+\.jsonl$/.test(n))) {
        const answer = `${opts.dir}/${f.replace(/\.jsonl$/, ".json")}`;
        if (!existsSync(answer)) continue;
        for (const line of readFileSync(`${opts.dir}/${f}`, "utf8").split("\n"))
          if (line.trim()) exported.push(JSON.parse(line) as ReadingFirm);
        for (const r of JSON.parse(readFileSync(answer, "utf8")) as unknown[]) {
          const parsed = ReadingResult.safeParse(r);
          if (parsed.success) results.push(parsed.data);
          else bad += 1;
        }
      }
      const stats = await withDb((db) =>
        atomic(db, (tx) =>
          loadReadings(tx, {
            reader: opts.reader,
            promptVersion: DEFAULT_EXTRACTION_SPEC.promptVersion,
            exported,
            results,
          }),
        ),
      );
      console.log(`read-load: ${JSON.stringify({ ...stats, unparsed_results: bad })}`);
    });

  enrich
    .command("profiles")
    .description(
      "Read LinkedIn pages (Exa's cache, Google, the WREN_POOL_LINKEDIN alt) for the people compose reaches next, in its order",
    )
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .option("--limit <n>", "people this run", "25")
    .option("--again", "look up people already done (a cap still holds)")
    .action(async (opts: { niche: string; limit: string; again?: boolean }) => {
      const niche = requireNiche(opts.niche);
      if (niche === null) throw new Error(`unknown niche ${opts.niche}`);
      const sites = ingressSites(settings, "wren:profiles");
      await withDb(async (db) => {
        const personIds = await nextToEnroll(db, {
          niche,
          verificationHorizonDays: settings.verificationHorizonDays,
        });
        const argv = { niche, limit: Number(opts.limit), again: opts.again ?? false };
        // Each person is written as it finishes: Ctrl-C is a pause, a rerun resumes.
        const { stats } = await recordedRun(db, { command: PROFILES_COMMAND, argv, niche }, (run) =>
          runProfiles(db, sites, {
            personIds,
            limit: argv.limit,
            again: argv.again,
            timezone: settings.sendTimezone,
            linkedin: settings.poolLinkedin ?? null,
            runId: run.id,
            recheck: (companyIds) => recheckLeads(db, companyIds),
            onUnit: (u) =>
              console.log(
                `person ${u.personId}: ${u.person} company ${u.company}${u.error ? ` (${u.error})` : ""}`,
              ),
          }),
        );
        console.log(`profiles: ${JSON.stringify({ queued: personIds.length, ...stats })}`);
      });
    });

  enrich
    .command("checks")
    .description(
      "Recompute every lead's cross-checks for a niche (right person, right address); free, no calls",
    )
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .action(async (opts: { niche: string }) => {
      const niche = requireNiche(opts.niche);
      if (niche === null) throw new Error(`unknown niche ${opts.niche}`);
      // Pure recompute from held rows: a rerun redoes it whole, nothing to resume.
      const stats = await withDb((db) =>
        recheckNiche(db, niche, {
          onChunk: (s) => console.log(`chunk: ${JSON.stringify(s)}`),
        }),
      );
      console.log(`checks: ${JSON.stringify(stats)}`);
    });

  return enrich;
}

/** The default outside reader: Haiku agents in an operator's Claude session. */
const READER = "claude-haiku-4-5:agent";

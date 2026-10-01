/**
 * `wren study …`: research a question from the open web into a report where
 * every line cites a quote on a page we read. `study new` saves the question,
 * `study run` does whatever is left (Ctrl-C and run again to resume),
 * `study report` prints it. Always the main database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Settings } from "@wren/config";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { STUDY_STEPS, type StudyStep, studies } from "@wren/research/schema";
import {
  openStudy,
  questionStudy,
  runStudy,
  studyReport,
  studyView,
  verticalStudy,
} from "@wren/research/studies";
import type { Command } from "commander";
import { desc } from "drizzle-orm";
import { ingressSites } from "./sites.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const collect = (v: string, prev: string[] = []) => [...prev, v];

export function registerStudy(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const study = program
    .command("study")
    .description("research a question into a cited report: `study new`, then `study run`");

  study
    .command("new <slug>")
    .description("save a study: a plain question, or a vertical to sell into (offers + emails)")
    .option("--question <text>", "the question to answer")
    .option("--angle <text>", "one angle of it, repeatable (default: the question)", collect)
    .option("--vertical <who>", 'who we would sell to: "recruiting firms of 10 to 50 people"')
    .option("--sells <what>", "with --vertical: what we sell, in a phrase")
    .option("--rules <file>", "with --vertical: cold email rules for the emails draft")
    .option("--niche <niche>", "the niche it serves, if any")
    .action(
      async (
        slug: string,
        opts: {
          question?: string;
          angle?: string[];
          vertical?: string;
          sells?: string;
          rules?: string;
          niche?: string;
        },
      ) => {
        if (!opts.vertical === !opts.question)
          throw new Error("give --question or --vertical, not both");
        if (opts.vertical && !opts.sells) throw new Error("--vertical needs --sells");
        const input = opts.vertical
          ? verticalStudy({
              vertical: opts.vertical,
              sells: opts.sells ?? "",
              emailRules: opts.rules ? readFileSync(resolve(opts.rules), "utf8") : null,
            })
          : questionStudy(opts.question ?? "", opts.angle ?? []);
        const made = await withDb((db) => openStudy(db, slug, input, opts.niche ?? null));
        console.log(
          `study ${made.slug}: ${made.angles.length} angles, ${made.drafts.length} drafts`,
        );
        for (const a of made.angles) console.log(`  - ${a}`);
        console.log(`next: wren study run ${made.slug}`);
      },
    );

  study
    .command("run <slug>")
    .description("do what is left: plan, search, read, claims, drafts (resumable)")
    .option("--ask", "also ask perplexity each angle and read its sources (100 a day)")
    .option("--redo <step>", `throw away this step and later ones first: ${STUDY_STEPS.join(", ")}`)
    .option(
      "--llm <spec>",
      'this run\'s model, e.g. "claude-code:opus" (no key, the Claude Code login pays; default WREN_LLM); pair with --redo claims to rewrite from the same pages',
    )
    .action(async (slug: string, opts: { ask?: boolean; redo?: string; llm?: string }) => {
      if (opts.redo && !(STUDY_STEPS as readonly string[]).includes(opts.redo))
        throw new Error(`--redo takes one of: ${STUDY_STEPS.join(", ")}`);
      const spec = opts.llm ?? settings.llm;
      if (spec === "fake") throw new Error("a study needs a real model, not the fake");
      loadLlmEnv(settings.llmEnvPath, rootDir);
      const deps = {
        sites: ingressSites(settings),
        llm: makeLlm(spec, process.env, { anthropicModel: settings.llmModel }),
      };
      const { run, stats } = await withDb((db) =>
        recordedRun(
          db,
          { command: "study run", argv: { slug, ...opts }, model: deps.llm.name },
          (r) =>
            runStudy(db, deps, slug, {
              runId: r.id,
              ask: opts.ask ?? false,
              redo: (opts.redo as StudyStep | undefined) ?? null,
              onProgress: (line) => console.log(line),
            }),
        ),
      );
      console.log(`run ${run.id}: ${JSON.stringify(stats)}`);
      if (stats.aborted) {
        console.log(`stopped: ${stats.aborted}`);
        process.exitCode = 1;
      } else if (stats.capped)
        console.log(`capped by ${stats.capped.site}; run again after ${stats.capped.retryAt}`);
      else if (stats.failed || stats.waiting) console.log(`not done: wren study run ${slug}`);
      else console.log(`done: wren study report ${slug}`);
    });

  study
    .command("report <slug>")
    .description("the study as markdown, every claim cited")
    .option("--out <file>", "write it here instead of printing")
    .action(async (slug: string, opts: { out?: string }) => {
      const text = studyReport(await withDb((db) => studyView(db, slug)));
      if (!opts.out) return void process.stdout.write(text);
      writeFileSync(resolve(opts.out), text);
      console.log(`wrote ${opts.out}`);
    });

  study
    .command("list")
    .description("every study, newest first")
    .action(async () => {
      const rows = await withDb((db) => db.select().from(studies).orderBy(desc(studies.id)));
      for (const s of rows)
        console.log(`${s.slug}  ${s.createdAt.toISOString().slice(0, 10)}  ${s.question}`);
      if (!rows.length) console.log("no studies yet: wren study new <slug> --question …");
    });
}

/**
 * `wren evolve …`: copy experiments (designs/2026-10-04-copy-evolution.md). A
 * running experiment renders its template's live genome and shifts sends toward
 * what works; the `Evolution` loop ticks it daily. Start, watch, tune, stop.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import {
  approveCandidate,
  experimentStatus,
  type LlmFor,
  listCandidates,
  liveEmails,
  moveExperiment,
  proposeCandidates,
  rejectCandidate,
  seedExperiment,
  startExperiment,
  switchSetting,
  tickExperiment,
  writeDue,
} from "@wren/channel-email";
import type { QueueRefresh } from "@wren/channel-email/restate";
import { ingressOf, type Settings } from "@wren/config";
import type { Db } from "@wren/db";
import {
  parseSettings,
  SELECTION_NAMES,
  type SelectionName,
  simulate,
  withSetting,
} from "@wren/experiments";
import { type LlmClient, loadLlmEnv, makeLlm } from "@wren/llm";
import { nicheFor } from "@wren/niches";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const pct = (v: number | null) => (v === null ? "–" : `${(100 * v).toFixed(1)}%`);

/** `key=value`, the value as JSON when it parses (numbers, booleans, null), else text. */
function pair(text: string): [string, unknown] {
  const at = text.indexOf("=");
  if (at <= 0) throw new Error(`expected key=value, got '${text}'`);
  const raw = text.slice(at + 1);
  try {
    return [text.slice(0, at), JSON.parse(raw)];
  } catch {
    return [text.slice(0, at), raw];
  }
}

const id = (v: string) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not an experiment id: '${v}'`);
  return n;
};

/** Who decided, on the rows a CLI approve or reject writes. */
const BY = "cli";

export function registerEvolve(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  let llms: Map<string, LlmClient> | null = null;
  const llmFor: LlmFor = (spec) => {
    if (!llms) {
      loadLlmEnv(settings.llmEnvPath, rootDir);
      llms = new Map();
    }
    let client = llms.get(spec);
    if (!client) {
      client = makeLlm(spec, process.env);
      llms.set(spec, client);
    }
    return client;
  };
  /** Re-render the queue on the new genome; the hint when Restate can't be reached. */
  const refresh = async () => {
    try {
      await clients
        .connect(ingressOf(settings))
        .serviceClient<QueueRefresh>({ name: "QueueRefresh" })
        .all();
      console.log("queue refreshed");
    } catch (err) {
      console.log(
        `queue not refreshed (${err instanceof Error ? err.message : err}): run \`wren email refresh\``,
      );
    }
  };
  const evolve = program
    .command("evolve")
    .description("copy experiments: each [[variant]] point's sends shift toward what works");

  evolve
    .command("start <niche> <template>")
    .description(
      "evolve one template (e.g. book-first/opener): its points become loci, its options the first alleles",
    )
    .option("--selection <name>", "even, thompson, epsilon or ucb1")
    .option("--fitness <name>", "what counts as a success")
    .option(
      "--seeding <name>",
      "from_template, llm_seed (candidates for your approval) or from_winners",
    )
    .option("--from <id>", "from_winners: the experiment whose winners to take")
    .option(
      "--set <key=value>",
      "any other setting, repeatable (guards.negativeRatio=3, floor=0.1)",
      (v: string, all: string[]) => [...all, v],
      [] as string[],
    )
    .action(
      (
        niche: string,
        template: string,
        opts: {
          selection?: string;
          fitness?: string;
          seeding?: string;
          from?: string;
          set: string[];
        },
      ) =>
        withDb(async (db) => {
          const file = (await liveEmails(db, nicheFor(niche).name, [template])).get(template);
          if (!file) throw new Error(`niche ${niche} has no template '${template}'`);
          const named = (["selection", "fitness", "seeding"] as const).flatMap((k) =>
            opts[k] ? [[k, opts[k]] as [string, unknown]] : [],
          );
          const settings = [...named, ...opts.set.map(pair)].reduce(
            (s, [k, v]) => withSetting(s, k, v),
            parseSettings({}),
          );
          if (settings.seeding === "from_winners" && !opts.from)
            throw new Error("from_winners needs --from <experiment>");
          const exp = await startExperiment(db, { niche, file, settings });
          console.log(
            `experiment ${exp.id}: ${exp.niche}/${exp.template} running on genome ${exp.liveVersion}` +
              ` (${settings.selection}, ${settings.fitness}). The Evolution loop ticks it daily.`,
          );
          if (settings.seeding !== "from_template") {
            const seeded = await seedExperiment(db, exp.id, {
              llmFor,
              ...(opts.from ? { from: id(opts.from) } : {}),
            });
            console.log(
              `${settings.seeding}: ${seeded.queued} candidates queued, ${seeded.imported} imported, ${seeded.skipped} skipped`,
            );
            if (seeded.imported > 0) await refresh();
          }
        }),
    );

  evolve
    .command("status [id]")
    .description("each experiment's loci: every allele's state, share, P(best) and counts")
    .option("--all", "stopped experiments too")
    .option("--json", "print JSON")
    .action((which: string | undefined, opts: { all?: boolean; json?: boolean }) =>
      withDb(async (db) => {
        const list = await experimentStatus(db, {
          ...(which ? { id: id(which) } : {}),
          all: opts.all ?? false,
        });
        if (opts.json) {
          console.log(JSON.stringify(list, null, 2));
          return;
        }
        if (list.length === 0) console.log("no experiment");
        for (const s of list) {
          const e = s.experiment;
          const settings = parseSettings(e.settings);
          console.log(
            `#${e.id} ${e.niche}/${e.template} ${e.state}${e.stopReason ? ` (${e.stopReason})` : ""}` +
              ` · genome ${e.liveVersion} · generation ${s.generation}` +
              ` · ${settings.selection}, ${settings.fitness}`,
          );
          for (const l of s.loci) {
            const flags = [l.settled && "settled", l.stagnant && "stagnant"].filter(Boolean);
            console.log(`  ${l.locus}${flags.length ? ` (${flags.join(", ")})` : ""}`);
            for (const a of l.alleles) {
              const c = a.counts;
              console.log(
                `    ${a.allele} ${a.state.padEnd(9)} share ${pct(a.share).padStart(6)}` +
                  ` · P(best) ${pct(a.pBest).padStart(6)} · sent ${c.exposures} · replied ${c.replies}` +
                  ` · interested ${c.interested} · booked ${c.booked}` +
                  `${a.allele === l.best ? " · best" : ""}  ${JSON.stringify(a.text)}`,
              );
            }
          }
        }
      }),
    );

  evolve
    .command("tick [id]")
    .description(
      "one tick now (every running experiment, or one): import a file edit, count, retire, snapshot, settle; the LLM tiers when due",
    )
    .option("--write", "run the strategist, writer, checker and judge now, due or not")
    .option("--no-llm", "never run the tiers")
    .action((which: string | undefined, opts: { write?: boolean; llm: boolean }) =>
      withDb(async (db) => {
        const list = await experimentStatus(db, which ? { id: id(which) } : {});
        let changed = false;
        for (const { experiment: e } of list) {
          if (e.state !== "running") {
            if (which) console.log(`experiment ${e.id} is ${e.state}: not ticked`);
            continue;
          }
          const file = (await liveEmails(db, e.niche, [e.template])).get(e.template);
          const r = await tickExperiment(db, e.id, file);
          if (!r) continue;
          changed ||= r.genomeChanged;
          console.log(
            `#${r.experiment} generation ${r.generation}: ${r.retired.length} retired` +
              `${r.imported ? ", file imported" : ""}, settled [${r.settled.join(", ")}]` +
              `${r.stopped ? `, done (${r.stopped})` : ""}`,
          );
          if (!opts.llm || !(opts.write || writeDue(parseSettings(e.settings), r))) continue;
          const p = await proposeCandidates(db, e.id, llmFor);
          changed ||= p.approved > 0;
          const plan = p.plan;
          console.log(
            plan
              ? `  strategist: ${plan.mode}, ${plan.mutation} on ${plan.loci.join(", ")} (${plan.reason})`
              : "  no locus can take a candidate",
          );
          for (const l of p.loci)
            console.log(
              `  #${l.locus}: wrote ${l.written}, ${l.checked} passed the checker, ${l.queued} queued` +
                `${l.error ? ` (${l.error})` : ""}`,
            );
          const tokens = p.calls.reduce(
            (t, c) => ({
              input: t.input + (c.usage?.input ?? 0),
              output: t.output + (c.usage?.output ?? 0),
            }),
            { input: 0, output: 0 },
          );
          console.log(
            `  ${p.calls.length} model calls, ${tokens.input} tokens in, ${tokens.output} out` +
              `${p.approved ? `, ${p.approved} auto-approved` : ""}`,
          );
        }
        if (changed) await refresh();
      }),
    );

  evolve
    .command("switch <id> <setting>")
    .description("change one setting, as key=value (selection=epsilon, floor=0.1)")
    .action((which: string, setting: string) =>
      withDb(async (db) => {
        const [key, value] = pair(setting);
        await switchSetting(db, id(which), key, value);
        console.log(`experiment ${which}: ${key} = ${JSON.stringify(value)}`);
      }),
    );

  evolve
    .command("candidates [id]")
    .description(
      "copy waiting on your approval: each candidate beside the live winners at its point",
    )
    .option("--json", "print JSON")
    .action((which: string | undefined, opts: { json?: boolean }) =>
      withDb(async (db) => {
        const list = await listCandidates(db, which ? { experiment: id(which) } : {});
        if (opts.json) {
          console.log(JSON.stringify(list, null, 2));
          return;
        }
        if (list.length === 0) console.log("no candidate waiting");
        for (const c of list) {
          console.log(
            `${c.id}  #${c.experiment} ${c.niche}/${c.template} #${c.locus} · ${c.origin}` +
              `${c.judgeScore !== null ? ` · judge ${c.judgeScore}` : ""}${c.angle ? ` · ${c.angle}` : ""}` +
              `${c.reason ? ` · ${c.reason}` : ""}`,
          );
          console.log(`    new   ${JSON.stringify(c.text)}`);
          for (const w of c.winners.slice(0, 3))
            console.log(`    live  ${JSON.stringify(w.text)} · P(best) ${pct(w.pBest)}`);
        }
      }),
    );

  evolve
    .command("approve <candidate>")
    .description("put a candidate live in a new genome version, then re-render the queue")
    .option("--text <words>", "your edit of its words; the copy rules still hold")
    .action((which: string, opts: { text?: string }) =>
      withDb(async (db) => {
        const d = await approveCandidate(db, id(which), {
          by: BY,
          ...(opts.text !== undefined ? { text: opts.text } : {}),
        });
        console.log(
          `candidate ${which} live at #${d.locus} of experiment ${d.experiment} · genome ${d.version}`,
        );
        await refresh();
      }),
    );

  evolve
    .command("reject <candidate>")
    .description("turn a candidate down; the writer sees it next time")
    .action((which: string) =>
      withDb(async (db) => {
        const d = await rejectCandidate(db, id(which), { by: BY });
        console.log(`candidate ${which} rejected at #${d.locus} of experiment ${d.experiment}`);
      }),
    );

  for (const [move, help] of [
    ["pause", "no ticks; the genome and last shares keep rendering"],
    ["resume", "ticking again, from paused or settled"],
    ["stop", "final: the template file renders again"],
  ] as const) {
    evolve
      .command(`${move} <id>`)
      .description(help)
      .action((which: string) =>
        withDb(async (db) => {
          const e = await moveExperiment(db, id(which), move);
          console.log(`experiment ${e.id}: ${e.state}`);
        }),
      );
  }

  const list = (v: string) =>
    v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const num = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`not a number: '${v}'`);
    return n;
  };
  evolve
    .command("simulate")
    .description("compare selection strategies on synthetic truth: no database, no LLM")
    .option("--selection <names>", "comma list", SELECTION_NAMES.join(","))
    .option("--loci <n>", "variant points", num, 3)
    .option("--alleles <n>", "options per point", num, 4)
    .option("--rates <list>", "true rates, dealt to each point's options", "0.01,0.015,0.02,0.03")
    .option("--per-day <n>", "recipients a day", num, 10)
    .option("--days <n>", "days to run", num, 365)
    .option("--runs <n>", "runs per strategy", num, 200)
    .option("--seed <text>", "same seed, same result", "sim")
    .option(
      "--set <key=value>",
      "any other setting, repeatable (minSends=150, mutation=retire_only)",
      (v: string, all: string[]) => [...all, v],
      [] as string[],
    )
    .action(
      (opts: {
        selection: string;
        loci: number;
        alleles: number;
        rates: string;
        perDay: number;
        days: number;
        runs: number;
        seed: string;
        set: string[];
      }) => {
        const selections = list(opts.selection).map((name) => {
          if (!(SELECTION_NAMES as readonly string[]).includes(name)) {
            throw new Error(`no selection '${name}' (${SELECTION_NAMES.join(", ")})`);
          }
          return name as SelectionName;
        });
        const settings = opts.set
          .map(pair)
          .reduce((s, [k, v]) => withSetting(s, k, v), parseSettings({}));
        const results = simulate({
          selections,
          loci: opts.loci,
          alleles: opts.alleles,
          rates: list(opts.rates).map(num),
          perDay: opts.perDay,
          days: opts.days,
          runs: opts.runs,
          seed: opts.seed,
          settings,
        });
        console.log(
          `${opts.runs} runs · ${opts.loci} loci × ${opts.alleles} alleles · ${opts.perDay}/day × ${opts.days} days`,
        );
        console.log("selection  regret  to best  settled runs  days to settle  wrong settles");
        for (const r of results) {
          console.log(
            `${r.selection.padEnd(9)} ${r.regret.toFixed(1).padStart(7)} ${pct(r.bestShare).padStart(8)}` +
              ` ${`${r.settledRuns}/${opts.runs}`.padStart(13)} ${String(r.daysToSettle ?? "–").padStart(15)}` +
              ` ${`${r.wrongSettles}/${r.settledLoci}`.padStart(14)}`,
          );
        }
        console.log("regret: successes lost per run against always sending each point's best.");
      },
    );
}

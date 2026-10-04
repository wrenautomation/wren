/**
 * `wren evolve …`: copy experiments (designs/2026-10-04-copy-evolution.md). A
 * running experiment renders its template's live genome and shifts sends toward
 * what works; the `Evolution` loop ticks it daily. Start, watch, tune, stop.
 */
import {
  experimentStatus,
  moveExperiment,
  startExperiment,
  switchSetting,
  tickExperiment,
} from "@wren/channel-email";
import type { Db } from "@wren/db";
import {
  parseSettings,
  SELECTION_NAMES,
  type SelectionName,
  simulate,
  withSetting,
} from "@wren/experiments";
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

export function registerEvolve(program: Command, withDb: WithDb): void {
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
    .option("--seeding <name>", "from_template (the LLM seedings come with E3)")
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
        opts: { selection?: string; fitness?: string; seeding?: string; set: string[] },
      ) =>
        withDb(async (db) => {
          const file = nicheFor(niche).templates.get(template);
          if (!file) throw new Error(`niche ${niche} has no template '${template}'`);
          const named = (["selection", "fitness", "seeding"] as const).flatMap((k) =>
            opts[k] ? [[k, opts[k]] as [string, unknown]] : [],
          );
          const settings = [...named, ...opts.set.map(pair)].reduce(
            (s, [k, v]) => withSetting(s, k, v),
            parseSettings({}),
          );
          const exp = await startExperiment(db, { niche, file, settings });
          console.log(
            `experiment ${exp.id}: ${exp.niche}/${exp.template} running on genome ${exp.liveVersion}` +
              ` (${settings.selection}, ${settings.fitness}). The Evolution loop ticks it daily.`,
          );
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
      "one tick now (every running experiment, or one): import a file edit, count, retire, snapshot, settle",
    )
    .action((which: string | undefined) =>
      withDb(async (db) => {
        const list = await experimentStatus(db, which ? { id: id(which) } : {});
        let changed = false;
        for (const { experiment: e } of list) {
          if (e.state !== "running") {
            if (which) console.log(`experiment ${e.id} is ${e.state}: not ticked`);
            continue;
          }
          const r = await tickExperiment(db, e.id, nicheFor(e.niche).templates.get(e.template));
          if (!r) continue;
          changed ||= r.genomeChanged;
          console.log(
            `#${r.experiment} generation ${r.generation}: ${r.retired.length} retired` +
              `${r.imported ? ", file imported" : ""}, settled [${r.settled.join(", ")}]` +
              `${r.stopped ? `, done (${r.stopped})` : ""}`,
          );
        }
        if (changed) console.log("genome changed: `wren email refresh` re-renders the queue now");
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

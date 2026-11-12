/**
 * `wren content judge …` (designs/2026-10-16-decide.md, 2026-11-04-loops.md): the machine's calls beside
 * William's. `stats` shows agreement and spend per kind, `mode` sets a kind's mode, `export` writes
 * the distill set (`wren.decision/1` JSONL), `backfill` labels history from the draft record and can
 * ask the judge about a capped sample of it, `pass` runs one pass here.
 */
import { writeFileSync } from "node:fs";
import {
  backendsFromEnv,
  backfillCommentCalls,
  DECIDE_MODES,
  DECISION_KINDS,
  type DecideSource,
  type DecideSubject,
  type DecisionKind,
  decidePass,
  decideStats,
  decisionRecords,
  deskJudge,
  isDecideMode,
  isDecisionKind,
  type KindStats,
  leadFitSource,
  setDecideMode,
} from "@wren/core/decide";
import { jsonl } from "@wren/core/train";
import { atomic, type Db, type Queryable } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { leadOffers } from "@wren/offers";
import { commentSource, commentsCalled } from "@wren/starling-outbound/decide";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const pct = (r: number | null) => (r === null ? "-" : `${Math.round(r * 1000) / 10}%`);
const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`;

function statsTable(rows: readonly KindStats[]): string {
  const head = [
    "kind",
    "mode",
    "calls",
    "judged",
    "agree",
    "overrides",
    "decisions",
    "tokens in",
    "spent",
    "today",
  ];
  const body = rows.map((r) => [
    r.kind,
    r.mode,
    String(r.calls),
    String(r.judged),
    pct(r.rate),
    String(r.overrides),
    `${r.decisions}${r.failed ? ` (${r.failed} failed)` : ""}`,
    r.inputTokens.toLocaleString("en-US"),
    usd(r.usd),
    usd(r.usdToday),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? "").length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(w[i] ?? 0)).join("  ");
  return [line(head), ...body.map(line)].join("\n");
}

class DryRun extends Error {
  constructor(readonly result: unknown) {
    super("dry run");
  }
}

const kindArg = (v: string): DecisionKind => {
  if (!isDecisionKind(v)) throw new InvalidArgumentError(`kind is ${DECISION_KINDS.join(", ")}`);
  return v;
};
const positive = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("a positive number");
  return n;
};

export function registerJudge(
  content: Command,
  withDb: WithDb,
  env: {
    llmEnvPath: string;
    rootDir: string;
    /** Restate's ingress: the judge agent is the desk's `claude/ask` behind it. */
    ingress: { url: string; headers?: Record<string, string> };
  },
): Command {
  const decide = content
    .command("judge")
    .description("The judge's calls beside William's: agreement, spend, modes, the distill set");
  const backends = () => {
    loadLlmEnv(env.llmEnvPath, env.rootDir);
    return backendsFromEnv(process.env, (spec) => makeLlm(spec, process.env), {
      agent: deskJudge(env.ingress),
    });
  };

  decide
    .command("stats")
    .description("Per kind: mode, his calls, agreement, overrides, decisions, tokens, $")
    .option("--json", "as JSON")
    .action(async (o: { json?: boolean }) => {
      const rows = await withDb((db) => decideStats(db));
      if (o.json) return json(rows);
      console.log(statsTable(rows));
      for (const r of rows)
        if (r.gateReady) console.log(`${r.kind}: agreement is high enough to offer a gate`);
    });

  decide
    .command("mode")
    .description(`Set a kind's mode: ${DECIDE_MODES.join(", ")}`)
    .argument("<kind>", DECISION_KINDS.join(", "))
    .argument("<mode>", DECIDE_MODES.join(", "))
    .action(async (kind: string, mode: string) => {
      if (!isDecisionKind(kind))
        throw new InvalidArgumentError(`kind is ${DECISION_KINDS.join(", ")}`);
      if (!isDecideMode(mode)) throw new InvalidArgumentError(`mode is ${DECIDE_MODES.join(", ")}`);
      json(await withDb((db) => setDecideMode(db, kind, mode, "cli")));
    });

  decide
    .command("export")
    .description("The distill set as wren.decision/1 JSONL: state, questions, answers, his call")
    .option("--kind <kind>", DECISION_KINDS.join(", "))
    .option("--called", "only decisions he also called")
    .option("--since <date>", "decisions on or after")
    .option("--out <file>", "write here, not stdout")
    .action(async (o: { kind?: string; called?: boolean; since?: string; out?: string }) => {
      if (o.kind && !isDecisionKind(o.kind))
        throw new InvalidArgumentError(`kind is ${DECISION_KINDS.join(", ")}`);
      const since = o.since ? new Date(o.since) : undefined;
      if (since && Number.isNaN(since.getTime()))
        throw new InvalidArgumentError("--since: not a date");
      const rows = await withDb((db) =>
        decisionRecords(db, {
          ...(o.kind && isDecisionKind(o.kind) ? { kind: o.kind } : {}),
          ...(o.called ? { called: true } : {}),
          ...(since ? { since } : {}),
        }),
      );
      const body = jsonl(rows);
      if (o.out) writeFileSync(o.out, body);
      else process.stdout.write(body);
      process.stderr.write(`${rows.length} decisions${o.out ? ` → ${o.out}` : ""}\n`);
    });

  decide
    .command("backfill")
    .description(
      "Label history as his calls (drafted comments sent or dropped). --sample asks the judge about some of them",
    )
    .option("--dry-run", "count, write nothing")
    .option("--sample <n>", "then ask about up to n called subjects with no decision", positive)
    .option("--max-usd <usd>", "stop the sample at this spend", positive, 2)
    .action(async (o: { dryRun?: boolean; sample?: number; maxUsd: number }) => {
      const label = async (db: Queryable) => ({
        comments: await backfillCommentCalls(db),
      });
      const labelled = await withDb(async (db) => {
        if (!o.dryRun) return label(db);
        try {
          await atomic(db, async (tx) => {
            throw new DryRun(await label(tx));
          });
        } catch (err) {
          if (err instanceof DryRun) return err.result;
          throw err;
        }
      });
      json({ dryRun: !!o.dryRun, calls: labelled });
      if (!o.sample || o.dryRun) return;
      // The called subjects, as the model first wrote or read them: blind to his call.
      const sample = (
        kind: DecideSource["kind"],
        pick: (db: Db, n: number) => Promise<DecideSubject[]>,
      ) => ({
        kind,
        due: (db: Db, _now: Date, n: number) => pick(db, n),
      });
      const n = Math.floor(o.sample);
      const stats = await withDb((db) =>
        decidePass(db, {
          sources: [sample("comment_quality", commentsCalled)],
          backends: backends(),
          max: n,
          budgetMs: 30 * 60_000,
          maxUsd: o.maxUsd,
          mode: "shadow",
        }),
      );
      json({ sample: stats });
    });

  decide
    .command("pass")
    .description(
      "One pass here: open comment drafts and people who wrote back, as NextStepDecide/wren runs it",
    )
    .option("--max <n>", "subjects at most", positive, 40)
    .option("--kind <kind>", `only this kind: ${DECISION_KINDS.join(", ")}`, kindArg)
    .action(async (o: { max: number; kind?: DecisionKind }) =>
      json(
        await withDb((db) =>
          decidePass(db, {
            sources: [commentSource, leadFitSource(leadOffers())].filter(
              (s) => !o.kind || s.kind === o.kind,
            ),
            backends: backends(),
            max: o.max,
          }),
        ),
      ),
    );
  return decide;
}

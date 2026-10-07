/**
 * `wren train …`: the training record out as JSONL (designs/2026-10-07-training-record.md).
 * `export` writes one `wren.draft/1` line per draft, `pairs` one `wren.pair/1` line per
 * preference pair, `backfill` folds the drafts made before the record into it. Names and emails
 * read [person] and [email] unless `--include-people`.
 */
import { writeFileSync } from "node:fs";
import { backfillTraining } from "@wren/content";
import { DRAFT_RECORD_KINDS, type DraftRecordKind, isDraftKind } from "@wren/core/draft-record";
import { jsonl, type TrainAsk, trainPairs, trainRecords } from "@wren/core/train";
import type { Db } from "@wren/db";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

interface ExportOpts {
  kind?: DraftRecordKind[];
  since?: string;
  format?: string;
  includePeople?: boolean;
  out?: string;
}

const kindsOf = (v: string): DraftRecordKind[] =>
  v.split(",").map((k) => {
    const t = k.trim();
    if (!isDraftKind(t))
      throw new InvalidArgumentError(`kind must be one of ${DRAFT_RECORD_KINDS.join(", ")}`);
    return t;
  });
const dayOf = (v: string): string => {
  if (Number.isNaN(new Date(v).getTime())) throw new InvalidArgumentError("not a date");
  return v;
};

function askOf(o: ExportOpts): TrainAsk {
  if (o.format && o.format !== "jsonl") throw new Error("the only format is jsonl");
  return {
    ...(o.kind ? { kinds: o.kind } : {}),
    ...(o.since ? { since: new Date(o.since) } : {}),
    people: !!o.includePeople,
  };
}

/** To the file, saying how many; else to stdout, the count on stderr. */
function emit(rows: readonly unknown[], what: string, out?: string) {
  const body = jsonl(rows);
  if (out) writeFileSync(out, body);
  else process.stdout.write(body);
  process.stderr.write(`${rows.length} ${what}${out ? ` → ${out}` : ""}\n`);
}

export function registerTrain(program: Command, withDb: WithDb): void {
  const train = program
    .command("train")
    .description("The training record as JSONL: every draft, its versions, decisions, outcomes");
  const filters = (c: Command) =>
    c
      .option("--kind <list>", `comma-separated: ${DRAFT_RECORD_KINDS.join(", ")}`, kindsOf)
      .option("--since <date>", "drafts started on or after (YYYY-MM-DD)", dayOf)
      .option("--format <format>", "jsonl", "jsonl")
      .option("--include-people", "keep names and emails (off: [person], [email])")
      .option("--out <file>", "write here instead of stdout");

  filters(train.command("export"))
    .description("One wren.draft/1 line per draft (an item's round)")
    .action(async (o: ExportOpts) => {
      const ask = askOf(o);
      emit(await withDb((db) => trainRecords(db, ask)), "drafts", o.out);
    });

  filters(train.command("pairs"))
    .description("wren.pair/1 lines: edit, decision and engagement pairs")
    .action(async (o: ExportOpts) => {
      const ask = askOf(o);
      const pairs = trainPairs(await withDb((db) => trainRecords(db, ask)));
      emit(pairs, "pairs", o.out);
      const n = (t: string) => pairs.filter((p) => p.type === t).length;
      process.stderr.write(
        `edit ${n("edit")}, decision ${n("decision")}, engagement ${n("engagement")}\n`,
      );
    });

  train
    .command("backfill")
    .description("Fold the drafts made before the record into it; safe to run again")
    .option("--dry-run", "count what it would write; write nothing")
    .action(async (o: { dryRun?: boolean }) => {
      const r = await withDb((db) => backfillTraining(db, { dryRun: !!o.dryRun }));
      console.log(
        `${o.dryRun ? "would write" : "wrote"} ${r.written} of ${r.steps} steps over ${r.items} drafts; ${r.live} already in the live record, left alone`,
      );
    });
}

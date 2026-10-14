/**
 * `wren people …` (designs/2026-10-14-customerio-audit.md, B1): one profile per person.
 * `backfill` runs every address source's existing rows through `resolveProfile`; twice changes
 * nothing. `--client <id>` for a client's own database, and its rows kept on Wren's main one (its
 * form entries, sent and paid pay links) as timeline lines there (B7).
 */
import {
  type BackfillCount,
  backfillClientRows,
  backfillProfiles,
  PROFILE_SOURCES,
} from "@wren/core/profiles-backfill";
import { bulkBackfillProfiles } from "@wren/core/profiles-bulk";
import type { Db } from "@wren/db";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const sourcesOf = (v: string): string[] => {
  const got = v.split(",").map((s) => s.trim());
  const bad = got.filter((s) => !(PROFILE_SOURCES as readonly string[]).includes(s));
  if (bad.length)
    throw new InvalidArgumentError(
      `not a source: ${bad.join(", ")} (${PROFILE_SOURCES.join(", ")})`,
    );
  return got;
};

const rowsOf = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    throw new InvalidArgumentError("rows: a whole number, 1 or more");
  return n;
};

type Args = { dryRun?: boolean; only?: string[]; batch: number; bulk?: boolean | number };

export function registerPeople(
  program: Command,
  o: { withDb: WithDb; withMainDb: WithDb; client: () => string | undefined },
): void {
  const people = program
    .command("people")
    .description("profiles: one per person, by every address they use");
  people
    .command("backfill")
    .description("make or join a profile for every existing address row")
    .option("--dry-run", "count rows only")
    .option("--only <sources>", "comma list of sources", sourcesOf)
    .option("--batch <n>", "rows per read", (v) => Number(v), 500)
    .option("--bulk [rows]", "set-based, same result, far faster (rows per read, 5000)", rowsOf)
    .action(async (a: Args) => {
      await o.withDb(async (db) => {
        const opts = {
          ...(a.dryRun ? { dryRun: true } : {}),
          ...(a.only ? { only: a.only } : {}),
          progress: (c: { source: string; rows: number }) =>
            process.stderr.write(`\r${`${c.source} ${c.rows} rows`.padEnd(40)}`),
        };
        const counts: (BackfillCount & { chunks?: number; perRow?: number })[] = a.bulk
          ? await bulkBackfillProfiles(db, {
              ...opts,
              ...(a.bulk === true ? {} : { batch: a.bulk }),
            })
          : await backfillProfiles(db, { ...opts, batch: a.batch });
        process.stderr.write("\n");
        for (const c of counts)
          console.log(
            `${c.source.padEnd(14)} ${String(c.rows).padStart(7)} rows  ${c.created} made  ${c.merged} merged  ${c.skipped} skipped${c.chunks === undefined ? "" : `  (${c.chunks} chunks, ${c.perRow} one by one)`}`,
          );
        const client = o.client();
        if (!client || a.only) return;
        const kept = await o.withMainDb((main) =>
          backfillClientRows(main, client, db, {
            ...(a.dryRun ? { dryRun: true } : {}),
            batch: a.batch,
          }),
        );
        for (const c of kept)
          console.log(
            `${`${c.source} (main)`.padEnd(14)} ${String(c.rows).padStart(7)} rows  ${c.noted} lines`,
          );
      });
    });
}

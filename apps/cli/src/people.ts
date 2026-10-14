/**
 * `wren people …` (designs/2026-10-14-customerio-audit.md, B1): one profile per person.
 * `backfill` runs every address source's existing rows through `resolveProfile`; twice changes
 * nothing. `--client <id>` for a client's own database.
 */
import { backfillProfiles, PROFILE_SOURCES } from "@wren/core/profiles-backfill";
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

export function registerPeople(program: Command, withDb: WithDb): void {
  const people = program
    .command("people")
    .description("profiles: one per person, by every address they use");
  people
    .command("backfill")
    .description("make or join a profile for every existing address row")
    .option("--dry-run", "count rows only")
    .option("--only <sources>", "comma list of sources", sourcesOf)
    .option("--batch <n>", "rows per read", (v) => Number(v), 500)
    .action(async (o: { dryRun?: boolean; only?: string[]; batch: number }) => {
      await withDb(async (db) => {
        const counts = await backfillProfiles(db, {
          ...(o.dryRun ? { dryRun: true } : {}),
          ...(o.only ? { only: o.only } : {}),
          batch: o.batch,
          progress: (c) => process.stderr.write(`\r${`${c.source} ${c.rows} rows`.padEnd(40)}`),
        });
        process.stderr.write("\n");
        for (const c of counts)
          console.log(
            `${c.source.padEnd(14)} ${String(c.rows).padStart(7)} rows  ${c.created} made  ${c.merged} merged  ${c.skipped} skipped`,
          );
      });
    });
}

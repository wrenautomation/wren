/**
 * `wren pipeline fold-deals [--client <id>] [--offer <id>] [--dry]` (designs/2026-10-18-journeys.md,
 * "Folding `@wren/deals`"): turn the old Opportunities deals into journeys. Run again, it
 * changes nothing. With `--client` it folds that owner only (`wren` for Wren's own); without, every
 * owner that still has old rows. Run `--dry` first. The drop migration refuses to run until this
 * has run clean on every workspace.
 */
import { userInfo } from "node:os";
import { WREN } from "@wren/core/access";
import { LOGIC } from "@wren/core/logic";
import type { Db } from "@wren/db";
import { OFFER_IDS } from "@wren/offers";
import { foldDeals, foldLines } from "@wren/pipeline/fold";
import { Refused } from "@wren/pipeline/store";
import type { Command } from "commander";
import { pipelineCommand } from "./pipeline-seed.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
/** A client's own database, by client id. */
export type OnClient = <T>(id: string, fn: (db: Db) => Promise<T>) => Promise<T>;

export function registerPipelineFold(
  program: Command,
  withMainDb: WithDb,
  onClient: OnClient,
): void {
  pipelineCommand(program)
    .command("fold-deals")
    .description(
      "Turn the old Opportunities deals into journeys. Again changes nothing. Use --dry first",
    )
    .option(
      "--offer <id>",
      "the offer a new funnel sells (needed when a pipeline becomes a funnel)",
    )
    .option("--dry", "print the plan; write nothing")
    .action(async (o: { offer?: string; dry?: boolean }) => {
      try {
        if (o.offer && !OFFER_IDS.has(o.offer))
          throw new Refused([`"${o.offer}" is not in the offer registry.`]);
        const named = program.opts<{ client?: string }>().client;
        const owners = named ? [named === WREN ? null : named] : undefined;
        const report = await withMainDb((main) =>
          foldDeals(
            { main, workspace: (owner, fn) => (owner === null ? fn(main) : onClient(owner, fn)) },
            {
              ...(owners ? { owners } : {}),
              ...(o.dry ? { dry: true } : {}),
              ...(o.offer ? { offer: o.offer } : {}),
              by: userInfo().username,
              triggers: new Set(LOGIC.filter((l) => l.group === "trigger").map((l) => l.id)),
            },
          ),
        );
        for (const line of foldLines(report)) console.log(line);
        if (report.owners.some((x) => x.conflicts.length)) process.exitCode = 1;
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        for (const m of e.errors) console.error(m);
        process.exitCode = 1;
      }
    });
}

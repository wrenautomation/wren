/**
 * `wren pipeline seed --file <json> [--dry]` (designs/2026-10-18-journeys.md, "Client zero"): load
 * Wren's funnels, terms, partner journeys and deal signs from one private file. The whole file is
 * checked and the plan printed before any write. Run again, it changes nothing. Follows `--client`.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { LOGIC } from "@wren/core/logic";
import type { Db } from "@wren/db";
import { engagements } from "@wren/delivery/schema";
import { applySeed, parseSeed, planSeed } from "@wren/pipeline/seed";
import { Refused } from "@wren/pipeline/store";
import type { Command } from "commander";
import { and, eq } from "drizzle-orm";
import type { PipelineWrites } from "./pipeline.js";

/** The `pipeline` command, made once however many files add to it. */
export const pipelineCommand = (program: Command): Command =>
  program.commands.find((c) => c.name() === "pipeline") ??
  program.command("pipeline").description("pipeline set-up: seed and fold");

function readFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Refused([`Cannot read ${path} as JSON: ${(e as Error).message}`]);
  }
}

export function registerPipelineSeed(
  program: Command,
  withDb: <T>(fn: (db: Db) => Promise<T>) => Promise<T>,
  writes?: PipelineWrites,
): void {
  pipelineCommand(program)
    .command("seed")
    .description(
      "Load funnels, terms, journeys and deal signs from one file. Again changes nothing",
    )
    .requiredOption("--file <json>", "the seed file (private; sops/pipeline/client-zero.json)")
    .option("--dry", "check the file and print the plan; write nothing")
    .action(async (o: { file: string; dry?: boolean }) => {
      try {
        const seed = parseSeed(readFile(o.file));
        await withDb(async (db) => {
          const plan = await planSeed(
            {
              db,
              by: userInfo().username,
              triggers: new Set(LOGIC.filter((l) => l.group === "trigger").map((l) => l.id)),
              async open(req) {
                if (!writes)
                  throw new Refused(["No worker to call. Moves go through the Journeys service."]);
                try {
                  return await writes.journeys().open({ client: writes.client(), ...req });
                } catch (e) {
                  throw new Refused([(e as Error).message]);
                }
              },
              async engagements(q) {
                const rows = await db
                  .select({ id: engagements.id })
                  .from(engagements)
                  .where(and(eq(engagements.clientId, q.client), eq(engagements.offerId, q.offer)));
                return rows.map((r) => r.id);
              },
            },
            seed,
          );
          for (const i of plan)
            console.log(
              `${i.do.padEnd(6)} ${i.area.padEnd(10)} ${i.key}${i.note ? `  (${i.note})` : ""}`,
            );
          const todo = plan.filter((i) => i.run).length;
          if (o.dry) {
            console.log(`dry: ${todo} to write, ${plan.length - todo} already in place`);
            return;
          }
          await applySeed(plan);
          console.log(`done: ${todo} written, ${plan.length - todo} already in place`);
        });
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        for (const m of e.errors) console.error(m);
        process.exitCode = 1;
      }
    });
}

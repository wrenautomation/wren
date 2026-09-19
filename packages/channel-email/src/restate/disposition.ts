/**
 * Reply disposition as a Virtual Object with one key: `classify` runs one
 * pass of `runDisposition` over every pending human reply. One key = one
 * pass at a time, so two inbox syncs finding replies in the same minute queue
 * rather than paying for the same event twice.
 */
import * as restate from "@restatedev/restate-sdk";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import type { LlmClient, Tracer } from "@wren/llm";
import { type DispositionStats, runDisposition } from "../inbox/disposition.js";
import { errorText } from "./loop.js";

export const DISPOSITION_KEY = "fleet";
export const DISPOSITION_COMMAND = "outreach inbox classify";

export interface DispositionDeps {
  db: Db;
  llm: LlmClient;
  tracer?: Tracer | null;
  /** Named on the ledger row's argv, never the key. */
  tracing?: string;
}

export interface ClassifyOutcome {
  stats: DispositionStats | null;
  error: string | null;
  now: string;
}

const LAST = "last";

export function makeDisposition(deps: DispositionDeps) {
  return restate.object({
    name: "Disposition",
    handlers: {
      classify: async (ctx: restate.ObjectContext): Promise<ClassifyOutcome> => {
        const now = new Date(await ctx.date.now());
        const result = await ctx.run("reply disposition", async () => {
          try {
            const { stats } = await recordedRun(
              deps.db,
              {
                command: DISPOSITION_COMMAND,
                argv: { daemon: true, llm: deps.llm.name, tracing: deps.tracing ?? "none" },
                model: deps.llm.name,
              },
              (run) =>
                runDisposition(deps.db, deps.llm, {
                  runId: run.id,
                  tracer: deps.tracer ?? null,
                  now,
                }),
            );
            return { stats, error: null };
          } catch (err) {
            return { stats: null, error: errorText(err) };
          }
        });
        const outcome: ClassifyOutcome = { ...result, now: now.toISOString() };
        ctx.set(LAST, outcome);
        return outcome;
      },

      status: restate.handlers.object.shared(
        async (ctx: restate.ObjectSharedContext): Promise<ClassifyOutcome | null> =>
          (await ctx.get<ClassifyOutcome>(LAST)) ?? null,
      ),
    },
  });
}

export type Disposition = ReturnType<typeof makeDisposition>;

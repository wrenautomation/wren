/**
 * `CrmRun`: `crm run` on the worker, one object per client (designs/2026-10-07-vendor-keys.md,
 * "Left"). The CLI holds only the key store's public key, so it can't open a client's own keys;
 * the worker can. Here each model call runs on the client's model key or Wren's, metered on its
 * share, and each sites leg (lookup, signals, events) reads Exa, X and YouTube on the client's
 * own key when it brought one. The CLI calls `run` through the ingress and loops while work is
 * due, so one call stays a bounded slice: at most `MAX_LIMIT` units per stage.
 *
 * Exclusive per client: two `crm run`s for one client queue, never overlap.
 */
import * as restate from "@restatedev/restate-sdk";
import { recordedRun, runFeed } from "@wren/core";
import { type Client, findClient } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import { errorText, exclusiveHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { z } from "zod";
import { readClientProfile } from "./profile.js";
import { type CrmRunDeps, type CrmStageResult, runCrm } from "./run.js";
import { reactivationSettingsOf } from "./settings.js";
import { CRM_STAGES, type CrmStage } from "./status.js";

export const CRM_RUN_COMMAND = "crm run";
/** Units per stage in one call when none is asked. */
export const DEFAULT_LIMIT = 10;
/** The most units per stage one call takes: a call is one invocation and must end in time. */
export const MAX_LIMIT = 25;

export interface CrmRunWorkerDeps {
  main: Db;
  open(client: Pick<Client, "database">): Db;
  /** Wren's verifier, checker, fetcher and model; `sites` and `llm` are made per client below. */
  crm: Omit<CrmRunDeps, "sites">;
  /** The client's model: its own key or Wren's, metered on its share. Absent, `crm.llm` as is. */
  clientLlm?: ((client: string, llm: LlmClient) => LlmClient) | null;
  /** The client's sites: Exa, X and YouTube on its own key when it brought one. Null: no sites. */
  clientSites?: ((client: string) => SiteClient) | null;
  /** The zone Google's day and hours are kept in. */
  timezone?: string;
}

export interface CrmRunRequest {
  /** Only these stages; all that are due when left out. */
  only?: CrmStage[] | null;
  /** Units per stage, at most `MAX_LIMIT`. */
  limit?: number | null;
  /** Read LinkedIn through the client's account when it has one (default true). */
  linkedin?: boolean | null;
}

export interface CrmRunResult {
  client: string;
  run: string;
  stages: CrmStageResult[];
}

const input = z.looseObject({
  only: z
    .array(z.enum(CRM_STAGES))
    .nullish()
    .describe("Only these stages, in order; all that are due when left out"),
  limit: z.number().int().min(1).max(MAX_LIMIT).nullish().describe("Units per stage"),
  linkedin: z.boolean().nullish().describe("Read LinkedIn through the client's account"),
});

/** What a run needs of the client's row: plain JSON, as a step returns it. */
interface Work {
  database: string;
  linkedin: string | null;
  products: Record<string, unknown>;
  demo: boolean;
}
type Plan = { kind: "gone"; why: string } | { kind: "work"; client: Work };

export function makeCrmRun(deps: CrmRunWorkerDeps) {
  return restate.object({
    name: "CrmRun",
    handlers: {
      run: exclusiveHandler(
        { input },
        async (ctx: restate.ObjectContext, req: CrmRunRequest): Promise<CrmRunResult> => {
          const id = ctx.key;
          const plan = await ctx.run("client", async (): Promise<Plan> => {
            const client = await findClient(deps.main, id);
            if (!client) return { kind: "gone", why: "no such client" };
            return {
              kind: "work",
              client: {
                database: client.database,
                linkedin: client.accounts?.linkedin ?? null,
                products: client.products as Record<string, unknown>,
                demo: client.demo,
              },
            };
          });
          if (plan.kind === "gone") throw new restate.TerminalError(`${id}: ${plan.why}`);
          const limit = Math.min(req.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
          const linkedin = req.linkedin === false ? null : plan.client.linkedin;
          // One step: the run and its stages. A key is read and spent inside it, never returned.
          return ctx.run("crm run", async () => {
            const db = deps.open(plan.client);
            const llm =
              deps.crm.llm && deps.clientLlm ? deps.clientLlm(id, deps.crm.llm) : deps.crm.llm;
            const sites = deps.clientSites ? deps.clientSites(id) : null;
            const compose = {
              settings: reactivationSettingsOf(plan.client.products),
              profile: await readClientProfile(db),
              demo: plan.client.demo,
            };
            const argv = { only: req.only ?? null, limit, linkedin, worker: true };
            try {
              const { run, stats } = await recordedRun(
                db,
                { command: CRM_RUN_COMMAND, argv },
                async (r) => ({
                  stages: await runCrm(
                    db,
                    { ...deps.crm, llm, sites },
                    {
                      linkedin,
                      limit,
                      compose,
                      runId: r.id,
                      feed: runFeed(db, r.id),
                      ...(deps.timezone ? { timezone: deps.timezone } : {}),
                      ...(req.only?.length ? { only: req.only } : {}),
                    },
                  ),
                }),
              );
              return { client: id, run: run.id, stages: stats.stages };
            } catch (err) {
              // The ledger holds the failure; the step ends instead of retrying a half-done run.
              throw new restate.TerminalError(errorText(err));
            }
          });
        },
      ),
    },
  });
}

export type CrmRunObject = ReturnType<typeof makeCrmRun>;

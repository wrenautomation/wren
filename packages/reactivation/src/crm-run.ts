/**
 * `CrmRun`: the CLI's `crm run`, `lookup`, `redraft` and `settle` on the worker, one object per
 * client (designs/2026-10-07-vendor-keys.md). The CLI holds only the key store's public key, so
 * it can't open a client's own keys; the worker can. Here each model call runs on the client's
 * model key or Wren's, metered on its share, and each sites leg (lookup, signals, events) reads
 * Exa, X and YouTube on the client's own key when it brought one, gated and metered on its share.
 * The CLI calls a handler through the ingress and loops while work is left, so one call stays a
 * bounded slice: at most `MAX_LIMIT` units (per stage, for `run`).
 *
 * Exclusive per client: two calls for one client queue, never overlap.
 */
import * as restate from "@restatedev/restate-sdk";
import { recordedRun, runFeed } from "@wren/core";
import { type Client, findClient } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import { errorText, exclusiveHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { keepingAnswers } from "@wren/research";
import { z } from "zod";
import { type RedraftStats, redraftAwaiting } from "./compose.js";
import { familyJudge, type SettleStats, settleMoves } from "./family.js";
import { type CrmLookupStats, lookUpCrmPeople } from "./lookup.js";
import { readClientProfile } from "./profile.js";
import { type CrmRunDeps, type CrmStageResult, runCrm } from "./run.js";
import { reactivationSettingsOf } from "./settings.js";
import { CRM_STAGES, type CrmStage } from "./status.js";

export const CRM_RUN_COMMAND = "crm run";
/** Units per stage in one call when none is asked. */
export const DEFAULT_LIMIT = 10;
/** The most units per stage one call takes: a call is one invocation and must end in time. */
export const MAX_LIMIT = 25;
/** Moves one `settle` call asks the model about at most: a short answer each. */
export const SETTLE_LIMIT = 100;

/** What a client's model and sites are for, on their usage rows. */
export interface CrmRunScope {
  /** `reactivation.run`, `.lookup`, `.redraft`, `.settle`. */
  part: string;
  runId: string | null;
}

export interface CrmRunWorkerDeps {
  main: Db;
  open(client: Pick<Client, "database">): Db;
  /** Wren's verifier, checker, fetcher and model; `sites` and `llm` are made per client below. */
  crm: Omit<CrmRunDeps, "sites">;
  /** The client's model: its own key or Wren's, metered on its share. Absent, `crm.llm` as is. */
  clientLlm?: ((client: string, llm: LlmClient, scope: CrmRunScope) => LlmClient) | null;
  /**
   * The client's sites: Exa, X and YouTube on its own key when it brought one, gated and metered
   * on its share. Null: no sites.
   */
  clientSites?: ((client: string, scope: CrmRunScope) => SiteClient) | null;
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

export interface CrmLookupRequest {
  /** People at most, up to `MAX_LIMIT`. */
  limit?: number | null;
  /** People looked up at once. */
  concurrency?: number | null;
  /** Read LinkedIn through the client's account when it has one (default true). */
  linkedin?: boolean | null;
  /** People already looked up, too; with `after`, the slice past the last one. */
  again?: boolean | null;
  after?: number | null;
}

export interface CrmRedraftRequest {
  /** These enrollments, up to `MAX_LIMIT`; else every untouched draft, a slice past `after`. */
  ids?: number[] | null;
  limit?: number | null;
  after?: number | null;
}

export interface CrmSettleRequest {
  limit?: number | null;
  after?: number | null;
}

export interface CrmSliceResult<S> {
  client: string;
  run: string;
  stats: S;
}

const limitField = z.number().int().min(1).max(MAX_LIMIT).nullish();
const after = z.number().int().nullish().describe("Only ids past this one: the last slice's end");

const runInput = z.looseObject({
  only: z
    .array(z.enum(CRM_STAGES))
    .nullish()
    .describe("Only these stages, in order; all that are due when left out"),
  limit: limitField.describe("Units per stage"),
  linkedin: z.boolean().nullish().describe("Read LinkedIn through the client's account"),
});
const lookupInput = z.looseObject({
  limit: limitField.describe("People at most"),
  concurrency: z.number().int().min(1).max(4).nullish().describe("People looked up at once"),
  linkedin: z.boolean().nullish().describe("Read LinkedIn through the client's account"),
  again: z.boolean().nullish().describe("People already looked up, too"),
  after,
});
const redraftInput = z.looseObject({
  ids: z.array(z.number().int()).max(MAX_LIMIT).nullish().describe("These enrollments"),
  limit: limitField.describe("Drafts at most"),
  after,
});
const settleInput = z.looseObject({
  limit: z.number().int().min(1).max(SETTLE_LIMIT).nullish().describe("Moves at most"),
  after,
});

/** What a call needs of the client's row: plain JSON, as a step returns it. */
interface Work {
  database: string;
  linkedin: string | null;
  products: Record<string, unknown>;
  demo: boolean;
}
type Plan = { kind: "gone"; why: string } | { kind: "work"; client: Work };

/** One call's work in the client's database, with its model and sites made for it. */
interface Slice {
  id: string;
  client: Work;
  db: Db;
  llm: LlmClient | null;
  sites: SiteClient | null;
  runId: string;
}

export function makeCrmRun(deps: CrmRunWorkerDeps) {
  /** The client's row, journaled; gone is terminal. */
  const work = async (ctx: restate.ObjectContext): Promise<Work> => {
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
    return plan.client;
  };

  /**
   * One step: a recorded run in the client's database, its model and sites made for the run. A
   * key is read and spent inside it, never returned. A failure is in the ledger and ends the call
   * instead of retrying a half-done slice.
   */
  const slice = <S extends object>(
    ctx: restate.ObjectContext,
    client: Work,
    command: string,
    part: string,
    argv: Record<string, unknown>,
    fn: (s: Slice) => Promise<S>,
    reads: { sites: boolean } = { sites: true },
  ): Promise<CrmSliceResult<S>> =>
    ctx.run(command, async (): Promise<CrmSliceResult<S>> => {
      const id = ctx.key;
      const db = deps.open(client);
      try {
        const { run, stats } = await recordedRun(
          db,
          { command, argv: { ...argv, worker: true } },
          async (r) => {
            const scope = { part, runId: r.id };
            const llm =
              deps.crm.llm && deps.clientLlm
                ? deps.clientLlm(id, deps.crm.llm, scope)
                : deps.crm.llm;
            const sites = reads.sites && deps.clientSites ? deps.clientSites(id, scope) : null;
            return fn({ id, client, db, llm, sites, runId: r.id });
          },
        );
        return { client: id, run: run.id, stats };
      } catch (err) {
        throw new restate.TerminalError(errorText(err));
      }
    });

  return restate.object({
    name: "CrmRun",
    handlers: {
      /** `crm run`: one round of every due stage, at most `limit` units each. */
      run: exclusiveHandler(
        { input: runInput },
        async (ctx: restate.ObjectContext, req: CrmRunRequest): Promise<CrmRunResult> => {
          const client = await work(ctx);
          const limit = Math.min(req.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
          const linkedin = req.linkedin === false ? null : client.linkedin;
          const argv = { only: req.only ?? null, limit, linkedin };
          const r = await slice(ctx, client, CRM_RUN_COMMAND, "reactivation.run", argv, async (s) =>
            runCrm(
              s.db,
              { ...deps.crm, llm: s.llm, sites: s.sites },
              {
                linkedin,
                limit,
                compose: {
                  settings: reactivationSettingsOf(client.products),
                  profile: await readClientProfile(s.db),
                  demo: client.demo,
                },
                runId: s.runId,
                feed: runFeed(s.db, s.runId),
                ...(deps.timezone ? { timezone: deps.timezone } : {}),
                ...(req.only?.length ? { only: req.only } : {}),
              },
            ),
          );
          return { client: r.client, run: r.run, stages: r.stats };
        },
      ),

      /** `crm lookup`: where each person is now, one slice; the judge on the client's model. */
      lookup: exclusiveHandler(
        { input: lookupInput },
        async (
          ctx: restate.ObjectContext,
          req: CrmLookupRequest,
        ): Promise<CrmSliceResult<CrmLookupStats>> => {
          const client = await work(ctx);
          const limit = Math.min(req.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
          const linkedin = req.linkedin === false ? null : client.linkedin;
          const again = req.again ?? false;
          const argv = { limit, linkedin, again, after: req.after ?? null };
          return slice(ctx, client, "crm lookup", "reactivation.lookup", argv, async (s) => {
            if (!s.sites) return { ...NO_LOOKUPS, aborted: "lookup needs the sites service" };
            return lookUpCrmPeople(s.db, keepingAnswers(s.sites, s.db), {
              linkedin,
              limit,
              again,
              after: req.after ?? null,
              concurrency: req.concurrency ?? 2,
              runId: s.runId,
              feed: runFeed(s.db, s.runId),
              judge: s.llm ? familyJudge(s.llm, s.runId) : null,
            });
          });
        },
      ),

      /** `crm redraft`: drafts still waiting, written again with today's composer, one slice. */
      redraft: exclusiveHandler(
        { input: redraftInput },
        async (
          ctx: restate.ObjectContext,
          req: CrmRedraftRequest,
        ): Promise<CrmSliceResult<RedraftStats>> => {
          const client = await work(ctx);
          const limit = Math.min(req.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
          const ids = req.ids ?? null;
          const argv = { ids, limit, after: req.after ?? null };
          return slice(
            ctx,
            client,
            "crm redraft",
            "reactivation.redraft",
            argv,
            async (s) => {
              if (!s.llm)
                return { ...NO_REDRAFTS, aborted: "redraft needs a real model, not the fake" };
              return redraftAwaiting(s.db, s.llm, {
                profile: await readClientProfile(s.db),
                senders: reactivationSettingsOf(client.products).senders,
                ...(ids ? { enrollmentIds: ids } : { after: req.after ?? null, limit }),
                runId: s.runId,
              });
            },
            NO_SITES,
          );
        },
      ),

      /** `crm settle`: kept moves to the same employer under another name become stays. */
      settle: exclusiveHandler(
        { input: settleInput },
        async (
          ctx: restate.ObjectContext,
          req: CrmSettleRequest,
        ): Promise<CrmSliceResult<SettleStats & { byName: boolean }>> => {
          const client = await work(ctx);
          const limit = Math.min(req.limit ?? SETTLE_LIMIT, SETTLE_LIMIT);
          const argv = { limit, after: req.after ?? null };
          return slice(
            ctx,
            client,
            "crm settle",
            "reactivation.settle",
            argv,
            async (s) => {
              // No model: by name only.
              const judge = s.llm ? familyJudge(s.llm, s.runId) : null;
              const stats = await settleMoves(s.db, judge, { after: req.after ?? null, limit });
              return { ...stats, byName: !judge };
            },
            NO_SITES,
          );
        },
      ),
    },
  });
}

export type CrmRunObject = ReturnType<typeof makeCrmRun>;

/** A slice that reads no sites: none are made for it. */
const NO_SITES = { sites: false };

const NO_LOOKUPS: CrmLookupStats = {
  selected: 0,
  matched: 0,
  unresolved: 0,
  capped: 0,
  errors: 0,
  findings: {},
  moved: 0,
  left: 0,
  aborted: null,
  last: null,
};

const NO_REDRAFTS: RedraftStats = {
  selected: 0,
  redrafted: 0,
  failed: 0,
  skipped: 0,
  aborted: null,
  last: null,
};

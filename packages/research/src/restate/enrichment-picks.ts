/** Enrichment handlers that pick who to contact and what to open with. */
import * as restate from "@restatedev/restate-sdk";
import { companies } from "@wren/core";
import { exclusiveHandler } from "@wren/core/restate";
import { atomic } from "@wren/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { backfillCallRecords } from "../enrichment/audit-backfill.js";
import { PICK_VERSION, RULES_PICKER } from "../enrichment/email-pick/graph.js";
import {
  applyPicks,
  type EmailPickStats,
  pickCompany,
  selectPickTargets,
} from "../enrichment/email-pick/run.js";
import {
  countOpener,
  emptyOpenerStats,
  OPENER_VERSION,
  type OpenerStats,
  selectOpenerTargets,
  writeOpener,
} from "../enrichment/opener.js";
import { tagTestimonials } from "../enrichment/testimonials.js";
import {
  type EnrichmentContext,
  HELD,
  keyShard,
  LIMIT,
  LIMIT_FIELD,
  type LimitInput,
  parseShard,
  SHARD,
  UNIT_RETRY,
} from "./enrichment-context.js";
import { notHeld, stageHolds, UNITS_PER_RUN, unitBatches } from "./units.js";

export interface PickInput {
  limit?: number;
  shard?: string;
}

export interface EmailPickInput extends PickInput {
  /** Pick without the model (byRules), under model "deterministic": free. */
  rules?: boolean;
}

export interface TagInput {
  limit?: number;
  dryRun?: boolean;
}

const SHARDED = z.looseObject({ limit: LIMIT_FIELD, shard: SHARD }).nullish();

const PICK = z
  .looseObject({
    limit: LIMIT_FIELD,
    shard: SHARD,
    rules: z.boolean().nullish().describe("Pick without the model: free"),
  })
  .nullish();

const TAG = z.looseObject({ limit: LIMIT_FIELD, dryRun: z.boolean().nullish() }).nullish();

export function picksHandlers(enrich: EnrichmentContext) {
  const { deps, llmOf, tracer, scope, open, close, unit } = enrich;
  return {
    pick: exclusiveHandler(
      { input: PICK },
      async (ctx: restate.ObjectContext, input: EmailPickInput = {}): Promise<EmailPickStats> => {
        const { db, niche } = scope(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(
          ctx,
          "enrich pick",
          { ...input, niche, version: PICK_VERSION },
          input.rules ? RULES_PICKER : deps.llm.name,
        );
        const llm = input.rules ? null : llmOf(ctx, HELD.pick, runId);
        const ids = await ctx.run("select", async () =>
          (await selectPickTargets(db, llm, { limit: input.limit, niche, shard })).map((c) => c.id),
        );
        const stats: EmailPickStats = {
          selected: ids.length,
          picked: 0,
          auto_accepted: 0,
          no_signals: 0,
          no_content: 0,
          classified: 0,
          parse_errors: 0,
          provider_rejected: 0,
          ungrounded_emails: 0,
          ungrounded_names: 0,
          aborted: null,
        };
        const holds = await stageHolds(ctx, db, HELD.pick);
        const units = unitBatches(
          ctx,
          "pick company",
          notHeld(holds, ids),
          async (id) => {
            const [company] = await db.select().from(companies).where(eq(companies.id, id));
            if (!company) return null;
            return atomic(db, (tx) => pickCompany(tx, llm, company, { runId, tracer }));
          },
          // A model pick is bought once: one unit per step. Rules picks are free and batch.
          { retry: UNIT_RETRY, perRun: llm ? 1 : UNITS_PER_RUN, holds },
        );
        for await (const r of units) {
          if (!r.ok) {
            stats.aborted = r.reason;
            break;
          }
          if (!r.value) continue;
          const method = r.value.pick.method;
          if (method === "auto_accept") stats.auto_accepted += 1;
          else if (method === "no_signals") stats.no_signals += 1;
          else if (method === "no_scannable_content") stats.no_content += 1;
          else stats.classified += 1;
          if (r.value.parse_error) stats.parse_errors += 1;
          if (r.value.provider_rejected) stats.provider_rejected += 1;
          stats.ungrounded_emails += r.value.pick.ungrounded?.length ?? 0;
          stats.ungrounded_names += r.value.pick.ungrounded_names?.length ?? 0;
          stats.picked += 1;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    opener: exclusiveHandler(
      { input: SHARDED },
      async (ctx: restate.ObjectContext, input: PickInput = {}): Promise<OpenerStats> => {
        const { db, niche } = scope(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(
          ctx,
          "enrich opener",
          { ...input, niche, version: OPENER_VERSION },
          deps.llm.name,
        );
        const llm = llmOf(ctx, HELD.opener, runId);
        const ids = await ctx.run("select", () =>
          selectOpenerTargets(db, llm, { limit: input.limit, niche, shard }),
        );
        const stats = emptyOpenerStats(ids.length);
        const holds = await stageHolds(ctx, db, HELD.opener);
        for (const id of notHeld(holds, ids)) {
          const r = await unit(
            ctx,
            `opener company ${id}`,
            () => atomic(db, (tx) => writeOpener(tx, llm, id, { runId, tracer })),
            { holds, id },
          );
          if (!r.ok) {
            stats.aborted = r.reason;
            break;
          }
          countOpener(stats, r.value);
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    applyPicks: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
        const { db } = scope(ctx);
        const runId = await open(ctx, "enrich apply-picks", { ...input });
        const stats = await ctx.run("apply", () => atomic(db, (tx) => applyPicks(tx, input)));
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    tagTestimonials: exclusiveHandler(
      { input: TAG },
      async (ctx: restate.ObjectContext, input: TagInput = {}) => {
        const { db, niche } = scope(ctx);
        if (niche === null) throw new restate.TerminalError("tagTestimonials needs a niche key");
        const runId = await open(ctx, "enrich tag-testimonials", { ...input, niche });
        const stats = await ctx.run("tag", () =>
          atomic(db, (tx) =>
            tagTestimonials(tx, {
              niche,
              runId,
              dryRun: input.dryRun ?? false,
              ...(input.limit !== undefined ? { limit: input.limit } : {}),
            }),
          ),
        );
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    backfillCallRecords: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
        const { db } = scope(ctx);
        const runId = await open(ctx, "audit backfill", { ...input });
        const stats = await ctx.run("backfill", () =>
          atomic(db, (tx) => backfillCallRecords(tx, input)),
        );
        await close(ctx, runId, stats);
        return stats;
      },
    ),
  };
}

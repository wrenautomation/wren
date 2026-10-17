/**
 * `ProfileResearch/<profile id>/run`: one "Research this person" run, durable. The portal (and
 * `wren people research`) queues a `profile_lookups` row and sends it here. A key is one profile,
 * so two runs for one person never overlap; the portal also refuses a second while one is open.
 *
 * Each metered read is journaled once: `researchProfile` returns site errors as data and the step
 * has one attempt, so a replay never buys the same read twice. Google and the LinkedIn account
 * spend from the same day budgets as `enrich profiles` (`profile_lookups` count in both).
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { exclusiveHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import { keepingAnswers } from "../findings.js";
import { readLedger } from "../linkedin-reads.js";
import { failProfileResearch, researchPlan, researchProfile } from "../people/profile-research.js";

export const PROFILE_RESEARCH_COMMAND = "people research";

const RUN = z.looseObject({
  lookupId: z.number().int().describe("The queued run (profile_lookups id) to carry out"),
});
export interface ProfileResearchInput {
  lookupId: number;
}

export interface ProfileResearchStats {
  state: "matched" | "unresolved" | "capped" | "failed" | "skipped";
  findings: number;
  google: number;
  error?: string;
}

export interface ProfileResearchDeps {
  db: Db;
  /** autobrowse's sites (`web` for search, `linkedin` for the account); null = a run fails, saying so. */
  sites?: SiteClient | null;
  /** The LinkedIn account for logged-in reads; null = search only. */
  linkedin?: string | null;
  /** The zone Google's day and hours are kept in. */
  timezone: string;
}

export function makeProfileResearch(deps: ProfileResearchDeps) {
  const { db } = deps;
  return restate.object({
    name: "ProfileResearch",
    handlers: {
      run: exclusiveHandler(
        { input: RUN },
        async (
          ctx: restate.ObjectContext,
          input: ProfileResearchInput,
        ): Promise<ProfileResearchStats> => {
          const lookupId = input.lookupId;
          const stopped = async (error: string): Promise<ProfileResearchStats> => {
            await ctx.run("fail", () => failProfileResearch(db, lookupId, error));
            return { state: "failed", findings: 0, google: 0, error };
          };
          if (!deps.sites)
            return stopped("No site client is set up here, so nothing was searched.");
          const sites = keepingAnswers(deps.sites, db);
          const runId = await ctx.run("open run", async () => {
            const run = await openRun(db, {
              command: PROFILE_RESEARCH_COMMAND,
              argv: { profile: ctx.key, lookupId },
              niche: null,
              model: null,
            });
            return run.id;
          });
          const now = new Date(await ctx.date.now());
          const plan = await ctx.run("plan", () =>
            researchPlan(db, { now, timezone: deps.timezone }),
          );
          // The step never throws on a site error and is never retried: a metered read is bought once.
          const r = await ctx.run(
            "research",
            () =>
              researchProfile(db, sites, lookupId, {
                googleLeft: plan.google,
                linkedin: deps.linkedin ?? null,
                linkedinCappedUntil: plan.linkedinUntil ? new Date(plan.linkedinUntil) : null,
                ledger: readLedger(db, { client: null, part: "profiles", runId }),
              }),
            { maxRetryAttempts: 1 },
          );
          const stats: ProfileResearchStats = r.ok
            ? { state: r.state ?? "skipped", findings: r.findings, google: r.google }
            : { state: "failed", findings: 0, google: 0, error: r.error };
          if (!r.ok) await ctx.run("fail", () => failProfileResearch(db, lookupId, r.error));
          await ctx.run("finish run", () => finishRun(db, runId, stats));
          return stats;
        },
      ),
    },
  });
}

export type ProfileResearch = ReturnType<typeof makeProfileResearch>;

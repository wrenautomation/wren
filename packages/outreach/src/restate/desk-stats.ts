/** `ReachDesk`'s numbers: the draft models' scorecard and the reach stats. */
import * as restate from "@restatedev/restate-sdk";
import type { Scorecard } from "@wren/core/draft-models";
import { serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import { platformOf } from "../accounts.js";
import { draftScorecard, parseSince } from "../draft-models.js";
import { type ReachStats, reachStats } from "../threads.js";
import { type DeskContext, PLATFORM } from "./desk-context.js";

const STATS = z.looseObject({ platform: PLATFORM.nullish(), days: z.number().nullish() }).nullish();

const DRAFT_MODELS = z.looseObject({ since: z.string().max(40).nullish() });

export function statsHandlers(desk: DeskContext) {
  const { deps, nowOf } = desk;
  return {
    /** Each draft model's record on reach drafts, and the verdict (designs/2026-10-14-draft-models.md). */
    draftModels: serviceHandler(
      { input: DRAFT_MODELS },
      async (ctx: restate.Context, req: { since?: string | null } = {}): Promise<Scorecard> => {
        const now = await nowOf(ctx);
        const since = parseSince(req?.since ?? "30d", now);
        if (!since) throw new restate.TerminalError("since is a day count like 30d, or a date");
        return ctx.run("draft models", () => draftScorecard(deps.db, since));
      },
    ),
    stats: serviceHandler(
      { input: STATS },
      async (
        ctx: restate.Context,
        req: { platform?: string | null; days?: number } = {},
      ): Promise<ReachStats> => {
        const now = await nowOf(ctx);
        return ctx.run("stats", () =>
          reachStats(deps.db, {
            platform: req.platform ? platformOf(req.platform) : null,
            days: req.days ?? 7,
            now,
          }),
        );
      },
    ),
  };
}

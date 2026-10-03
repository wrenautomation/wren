/**
 * The queue follows the templates. Compose saves a whole sequence's text at enroll, so a
 * template edit reaches mail already queued only when that queue is re-rendered. Deploy
 * calls `QueueRefresh/all` right after it registers a new worker version: every niche's
 * untouched, unstarted queue takes the new words within minutes, not at the next
 * midnight top-up. Refresh only: nothing is composed, approved or sent here.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { Db } from "@wren/db";
import type { RefreshStats } from "../outreach/refresh.js";
import { type Campaign, refreshCampaign } from "./compose-scheduler.js";

export interface QueueRefreshDeps {
  db: Db;
  campaigns: ReadonlyMap<string, Campaign>;
  trackOpens?: boolean;
}

export const REFRESH_COMMAND = "outreach refresh";

export function makeQueueRefresh(deps: QueueRefreshDeps) {
  const trackOpens = deps.trackOpens ?? false;
  return restate.service({
    name: "QueueRefresh",
    handlers: {
      /** Every niche with an active sender; one journaled step and one runs row each. */
      all: async (ctx: restate.Context): Promise<Record<string, RefreshStats>> => {
        const out: Record<string, RefreshStats> = {};
        for (const [niche, campaign] of [...deps.campaigns].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (campaign.senders.length === 0) continue;
          out[niche] = await ctx.run(`refresh ${niche}`, async () => {
            const run = await openRun(deps.db, { command: REFRESH_COMMAND, argv: { niche }, niche });
            const stats = await refreshCampaign(deps.db, campaign, trackOpens);
            await finishRun(deps.db, run.id, stats);
            return stats;
          });
        }
        return out;
      },
    },
  });
}

export type QueueRefresh = ReturnType<typeof makeQueueRefresh>;

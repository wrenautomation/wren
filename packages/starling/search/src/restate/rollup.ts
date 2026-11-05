/**
 * `SiteRollup/default`: once a day, the lander's export into Wren's site numbers. Visits per day
 * and first touch (`site_days`), per `/go/` link (`link_days`), flag exposures (`flag_days`),
 * survey answers, heatmaps (`heat_days`, `scroll_days`) and `/go/` clicks. Then the bandit moves
 * running experiments' shares and the edge gets the flags again.
 *
 * Split from SearchWatch 11-04 (WA-1067): the SEO half went. Left stopped until the experiments
 * phase; start it with `node scripts/ingress.mjs SiteRollup/default/start`.
 */

import { writeFlagDays } from "@wren/core/experiment-store";
import { type EdgePush, pushEdge } from "@wren/core/flag-store";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, runPass, stoppedPass } from "@wren/core/restate";
import { surveyKinds, writeSurveyDays } from "@wren/core/survey-store";
import type { Db } from "@wren/db";
import { importLanderClicks } from "@wren/sites/store";
import { siteExport } from "@wren/starling-email";
import type { FetchLike } from "@wrenautomation/autobrowse/google";
import { decideExperiments } from "../experiments.js";
import { rollupFlags } from "../flag-days.js";
import { rollupHeat, writeHeatDays } from "../heat.js";
import { rollupLinks, upsertLinkDays, wonClients } from "../link-days.js";
import { callsAndPaid, rollupSite, upsertSiteDays } from "../site-days.js";
import { rollupAnswers } from "../survey-days.js";

export const ROLLUP_KEY = "default";
const ROLLUP_COMMAND = "site rollup";
/** The lander event id heatmaps read after (`../heat.ts`). */
const HEAT_FROM = "heat from";
/** The lander click id `/go/` clicks are read after (`importLanderClicks`). */
const CLICKS_FROM = "clicks from";
const DAY_MS = 86_400_000;

interface RollupDeps {
  db: Db;
  fetch: FetchLike;
  /** The lander's `/api/export`; unset = the loop stops. */
  siteExport?: { baseUrl: string; exportToken: string } | undefined;
  /** The lander's edge: site flags resent each pass, the net under the push on every change. */
  edge?: EdgePush | undefined;
  notifier?: Notifier | undefined;
}

type Step<T> = T | { error: string };
type RollupStats = {
  days: number;
  links: number;
  flags: number;
  surveys: number;
  heat?: Step<{ rows: number }>;
  clicks?: Step<{ rows: number }>;
  experiments?: Step<{ moved: number; settled: number }>;
};

const failed = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });

export function makeSiteRollup(deps: RollupDeps) {
  return makeLoopObject<RollupStats>("SiteRollup", async (ctx) => {
    const now = new Date(await ctx.date.now());
    const site = deps.siteExport;
    if (!site) return stoppedPass<RollupStats>(ctx, now, "WREN_SITE_EXPORT_TOKEN unset");
    const o = { ...site, fetch: deps.fetch };
    const outcome = await runPass<RollupStats>(ctx, deps.db, {
      now,
      name: ROLLUP_COMMAND,
      ledger: { command: ROLLUP_COMMAND, argv: { daemon: true } },
      body: async () => {
        const [hits, apps, ours, seen, answers] = await Promise.all([
          siteExport("hits", o),
          siteExport("applications", o),
          callsAndPaid(deps.db),
          // An older lander has no exposures or answers table: no such days, the rest as before.
          siteExport("exposures", o).catch(() => []),
          siteExport("answers", o).catch(() => []),
        ]);
        return {
          days: await upsertSiteDays(deps.db, rollupSite(hits, apps, ours.calls, ours.paid)),
          // Per `/go/` link, so a post keeps its clicks, forms, calls and won clients.
          links: await upsertLinkDays(
            deps.db,
            rollupLinks(hits, apps, ours.calls, await wonClients(deps.db)),
          ),
          flags: await writeFlagDays(deps.db, rollupFlags(seen, hits, apps, ours.calls)),
          surveys: await writeSurveyDays(
            deps.db,
            rollupAnswers(answers, hits, await surveyKinds(deps.db)),
          ),
        };
      },
      delayAfter: () => DAY_MS,
      retryMs: DAY_MS / 4,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    // Heatmaps: the events after the cursor, so a pass reads a day or two, not all time.
    const since = (await ctx.get<number>(HEAT_FROM)) ?? 0;
    const heat = await ctx.run("heat days", async () => {
      try {
        const rolled = rollupHeat(await siteExport("events", { ...o, since }));
        return { rows: await writeHeatDays(deps.db, rolled), from: rolled.from };
      } catch (err) {
        return { ...failed(err), from: null };
      }
    });
    if (heat.from !== null) ctx.set(HEAT_FROM, heat.from);
    const clicksFrom = (await ctx.get<number>(CLICKS_FROM)) ?? 0;
    const clicks = await ctx.run("link clicks", async () => {
      try {
        const rows = await siteExport("clicks", { ...o, since: clicksFrom });
        return { rows: await importLanderClicks(deps.db, rows), from: rows.at(-1)?.id ?? null };
      } catch (err) {
        return { ...failed(err), from: null };
      }
    });
    if (clicks.from !== null) ctx.set(CLICKS_FROM, clicks.from);
    // The bandit moves running experiments' shares on the days just written; the push carries them.
    const experiments = await ctx.run("experiments", async () => {
      try {
        return await decideExperiments(deps.db);
      } catch (err) {
        return failed(err);
      }
    });
    const edge = deps.edge;
    if (edge) await ctx.run("edge flags", () => pushEdge(deps.db, edge));
    if (outcome.stats) {
      outcome.stats.heat = "error" in heat ? { error: heat.error } : { rows: heat.rows };
      outcome.stats.clicks = "error" in clicks ? { error: clicks.error } : { rows: clicks.rows };
      outcome.stats.experiments = experiments;
    }
    return outcome;
  });
}

export type SiteRollup = ReturnType<typeof makeSiteRollup>;

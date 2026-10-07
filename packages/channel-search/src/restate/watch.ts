/**
 * `SearchWatch/<client>/daily`: the same daily read for a client with Search watch installed and
 * its `search_console` account set, into its own database. Search Console only: no site days,
 * heatmaps, experiments or week. Gone, the demo, uninstalled or unconnected stops the loop.
 *
 * `SearchWatch/default`: once a day, Search Console into `search_days` and
 * each sitemap page's index state into `search_pages`; a page that leaves or
 * enters the index is one notice. One more step rolls the lander's export
 * into `site_days`. On the first pass of a Monday it sends
 * `SearchWeek.run` once: that one waits on the Mac's desk (Google and
 * Perplexity refuse the box), so the daily read never waits on it.
 *
 * `SearchWeek.run`: fan out and discover keywords, ask the engines, notify
 * counts and that the brief is ready. Edits are a person's step: the
 * `/search-week` skill reads the brief and opens a lander PR. Every step is
 * journaled; a retry re-asks nothing. With the Mac asleep the week waits for
 * its desk, then carries on.
 */

import * as restate from "@restatedev/restate-sdk";
import { type FetchLike, siteExport } from "@wren/channel-email";
import { recordedRun } from "@wren/core";
import { findClient } from "@wren/core/clients";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { writeFlagDays } from "@wren/core/experiment-store";
import { type EdgePush, pushEdge } from "@wren/core/flag-store";
import type { Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  errorText,
  makeLoopObject,
  pausedPass,
  runPass,
  serviceHandler,
  stoppedPass,
} from "@wren/core/restate";
import { partPaused, pausedText } from "@wren/core/setup-alerts";
import { surveyKinds, writeSurveyDays } from "@wren/core/survey-store";
import type { Db, Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { z } from "zod";
import { ask, dueKeywords, recordAnswer } from "../answers.js";
import { SEARCH_COMPONENT, SEARCH_COMPONENTS, searchSettingsSchema } from "../components.js";
import { type SearchConsoleClient, sitemapUrls } from "../console.js";
import { decideExperiments } from "../experiments.js";
import { rollupFlags } from "../flag-days.js";
import { rollupHeat, writeHeatDays } from "../heat.js";
import { discoverKeywords, fanOut } from "../keywords.js";
import { ENGINES, type Engine } from "../schema.js";
import { siteText } from "../site.js";
import { callsAndPaid, rollupSite, upsertSiteDays } from "../site-days.js";
import { rollupAnswers } from "../survey-days.js";
import { formatChanges, type SyncStats, syncSearch } from "../sync.js";

export const SEARCH_KEY = "default";
export const SEARCH_SYNC_COMMAND = "search sync";
export const SEARCH_WEEK_COMMAND = "search week";
const WEEK = "week";
/** The lander event id heatmaps read after (`../heat.ts`). */
const HEAT_FROM = "heat from";
const MONDAY = 1;
const DAY_MS = 86_400_000;
/** Keywords asked per engine per week: far under Google's pace and the free Perplexity plan. */
const ASKS_PER_ENGINE = 20;
/** An engine that fails this many in a row is off for the week (the Mac asleep, a sign-in gone). */
const ENGINE_MISSES = 3;
/** A client's key is `<client>/daily`. */
export const CLIENT_SEARCH_UNIT = "daily";
/** Sitemap pages inspected per client pass: under Search Console's per-property daily quota. */
const CLIENT_INSPECTS = 200;

export interface SearchDeps {
  db: Db;
  console: SearchConsoleClient;
  /** The Search Console property (`sc-domain:example.com`). */
  site: string;
  /** The site's origin (`https://example.com`): its sitemap, pages and `/llms.txt`. */
  origin: string;
  fetch: FetchLike;
  notifier?: Notifier;
  /** The lander's `/api/export`, rolled into `site_days` each pass; unset = no site days. */
  siteExport?: { baseUrl: string; exportToken: string };
  /** The lander's edge: site flags resent each pass, the net under the push on every change. */
  edge?: EdgePush;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
}

export interface SearchWeekDeps extends SearchDeps {
  llm: LlmClient;
  /** autobrowse on the Mac, for this invocation (`restateSites(ctx, { caller, service: DESK })`). */
  desk: (ctx: restate.Context) => SiteClient;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const weekOf = (d: Date) =>
  dayOf(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS));

type SearchWeekApi = { run: (ctx: restate.Context, req: { today: string }) => Promise<unknown> };

type Step<T> = T | { error: string };
type WatchStats = SyncStats & {
  week: string | null;
  site?: Step<{ days: number; flags: number; surveys: number }>;
  heat?: Step<{ rows: number }>;
  experiments?: Step<{ moved: number; settled: number }>;
};

/** The site a property names: `sc-domain:example.com` is https://example.com; a URL is its own. */
export function originOf(property: string): string | null {
  const domain = /^sc-domain:([a-z0-9.-]+)$/i.exec(property.trim())?.[1];
  if (domain) return `https://${domain.toLowerCase()}`;
  try {
    const u = new URL(property.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

type ClientSearch = { kind: "gone"; why: string } | { kind: "work"; site: string; origin: string };

/** What a client's pass reads, or why it stops. */
export async function clientSearch(main: Queryable, id: string): Promise<ClientSearch> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo is never worked" };
  const products = client.products as Record<string, unknown>;
  if (!(SEARCH_COMPONENT in products))
    return { kind: "gone", why: "search watch is not installed" };
  const settings = searchSettingsSchema.safeParse(products[SEARCH_COMPONENT]);
  if (!settings.success) return { kind: "gone", why: "the search watch settings do not parse" };
  const site = client.accounts.search_console;
  if (!site) return { kind: "gone", why: "no Search Console property connected" };
  const origin = settings.data.origin ?? originOf(site);
  if (!origin) return { kind: "gone", why: "the property names no site: set its address" };
  return { kind: "work", site, origin };
}

export function makeSearchWatch(deps: SearchDeps) {
  /** A client's pass: Search Console and its sitemap's pages into its database, nothing else. */
  const clientPass = async (ctx: restate.ObjectContext, client: string, now: Date) => {
    if (!deps.clientDb) return stoppedPass<WatchStats>(ctx, now, "no client databases here");
    const plan = await ctx.run("client", () => clientSearch(deps.db, client));
    if (plan.kind === "gone") return stoppedPass<WatchStats>(ctx, now, plan.why);
    // Wren's service account lost the property: hold the read, look again tomorrow.
    const part = SEARCH_COMPONENTS.find((c) => c.id === SEARCH_COMPONENT);
    const lost = part ? await ctx.run("paused", () => partPaused(deps.db, client, part)) : null;
    if (lost) return pausedPass<WatchStats>(ctx, now, pausedText(lost), DAY_MS);
    const db = deps.clientDb(client);
    return runPass<WatchStats>(ctx, db, now, {
      name: SEARCH_SYNC_COMMAND,
      ledger: { command: SEARCH_SYNC_COMMAND, argv: { daemon: true, site: plan.site } },
      body: async (runId) => {
        // A site with no sitemap still gets its search numbers.
        const urls = await sitemapUrls(deps.fetch, new URL("/sitemap.xml", plan.origin).href).catch(
          () => [],
        );
        const stats = await syncSearch(db, {
          console: deps.console,
          site: plan.site,
          urls: urls.slice(0, CLIENT_INSPECTS),
          today: dayOf(now),
          runId,
        });
        return { ...stats, week: null };
      },
      delayAfter: () => DAY_MS,
      retryMs: DAY_MS / 4,
    });
  };
  return makeLoopObject<WatchStats>("SearchWatch", async (ctx) => {
    const now = new Date(await ctx.date.now());
    const owner = clientOfKey(ctx.key);
    if (owner) return clientPass(ctx, owner.client, now);
    const today = dayOf(now);
    const outcome = await runPass(ctx, deps.db, now, {
      name: SEARCH_SYNC_COMMAND,
      ledger: { command: SEARCH_SYNC_COMMAND, argv: { daemon: true, site: deps.site } },
      body: async (runId) => {
        const urls = await sitemapUrls(deps.fetch, new URL("/sitemap.xml", deps.origin).href);
        const stats = await syncSearch(deps.db, {
          console: deps.console,
          site: deps.site,
          urls,
          today,
          runId,
        });
        return { ...stats, week: null } as WatchStats;
      },
      delayAfter: () => DAY_MS,
      retryMs: DAY_MS / 4,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    const site = deps.siteExport;
    if (site) {
      // The lander's visits, per day and first touch: one step, never failing the pass.
      const got = await ctx.run("site days", async () => {
        try {
          const o = { ...site, fetch: deps.fetch };
          const [hits, apps, ours, seen, answers] = await Promise.all([
            siteExport("hits", o),
            siteExport("applications", o),
            callsAndPaid(deps.db),
            // An older lander has no exposures or answers table: no such days, the rest as before.
            siteExport("exposures", o).catch(() => []),
            siteExport("answers", o).catch(() => []),
          ]);
          const rows = rollupSite(hits, apps, ours.calls, ours.paid);
          const days = await upsertSiteDays(deps.db, rows);
          return {
            days,
            flags: await writeFlagDays(deps.db, rollupFlags(seen, hits, apps, ours.calls)),
            surveys: await writeSurveyDays(
              deps.db,
              rollupAnswers(answers, hits, await surveyKinds(deps.db)),
            ),
          };
        } catch (err) {
          // Any error, not just the export's: a throw here retried the pass into a pause (10-06).
          return { error: err instanceof Error ? err.message : String(err) };
        }
      });
      if (outcome.stats) outcome.stats.site = got;
      // Heatmaps: the events after the cursor, so a pass reads a day or two, not all time.
      const since = (await ctx.get<number>(HEAT_FROM)) ?? 0;
      const heat = await ctx.run("heat days", async () => {
        try {
          const events = await siteExport("events", { ...site, fetch: deps.fetch, since });
          const rolled = rollupHeat(events);
          return { rows: await writeHeatDays(deps.db, rolled), from: rolled.from };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err), from: null };
        }
      });
      if (heat.from !== null) ctx.set(HEAT_FROM, heat.from);
      if (outcome.stats)
        outcome.stats.heat = "error" in heat ? { error: heat.error } : { rows: heat.rows };
    }
    // The bandit moves running experiments' shares on the days just written; the push carries them.
    const moved = await ctx.run("experiments", async () => {
      try {
        return await decideExperiments(deps.db);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });
    if (outcome.stats) outcome.stats.experiments = moved;
    const edge = deps.edge;
    if (edge) await ctx.run("edge flags", () => pushEdge(deps.db, edge));
    const changes = outcome.stats?.changes ?? [];
    if (deps.notifier && changes.length) {
      const notifier = deps.notifier;
      await ctx.run("notify index", () =>
        notifier.notify(
          `search: ${changes.length} page(s) changed in Google's index`,
          formatChanges(changes).join("\n"),
          "info",
        ),
      );
    }
    const week = weekOf(now);
    if (now.getUTCDay() === MONDAY && (await ctx.get<string>(WEEK)) !== week) {
      ctx.serviceSendClient<SearchWeekApi>({ name: "SearchWeek" }).run({ today });
      ctx.set(WEEK, week);
      if (outcome.stats) outcome.stats.week = week;
    }
    return outcome;
  });
}

export interface WeekStats {
  fanout: { seeds: number; added: number; failed: number };
  discovered: number;
  asked: Record<string, { asked: number; cited: number; failed: string | null }>;
  questions: number;
}

export function makeSearchWeek(deps: SearchWeekDeps) {
  const host = new URL(deps.origin).hostname.replace(/^www\./, "");
  return restate.service({
    name: "SearchWeek",
    handlers: {
      run: serviceHandler(
        { input: z.looseObject({ today: z.iso.date().describe("The week's day, YYYY-MM-DD") }) },
        async (ctx: restate.Context, req: { today: string }): Promise<WeekStats> => {
          const today = req.today;
          const grow = await ctx.run(
            "fan out",
            async () =>
              (
                await recordedRun(
                  deps.db,
                  { command: `${SEARCH_WEEK_COMMAND} fanout`, argv: { today } },
                  async (run) => {
                    const about = await siteText(deps.fetch, deps.origin, []);
                    const discovered = await discoverKeywords(deps.db, { today, runId: run.id });
                    const f = await fanOut(deps.db, deps.llm, { about, runId: run.id });
                    return {
                      discovered,
                      fanout: { seeds: f.seeds, added: f.added, failed: f.failed.length },
                    };
                  },
                )
              ).stats,
          );

          const desk = deps.desk(ctx);
          const asked: WeekStats["asked"] = {};
          let questions = 0;
          for (const engine of ENGINES as readonly Engine[]) {
            const due = await ctx.run(`due ${engine}`, () =>
              dueKeywords(deps.db, engine, today, ASKS_PER_ENGINE),
            );
            const e = { asked: 0, cited: 0, failed: null as string | null };
            asked[engine] = e;
            let misses = 0;
            for (const k of due) {
              try {
                const a = await ask(desk, engine, k.phrase, host);
                questions += await ctx.run(`record ${engine} ${k.id}`, () =>
                  recordAnswer(deps.db, k, engine, a, { today, runId: null }),
                );
                e.asked++;
                if (a.cited) e.cited++;
                misses = 0;
              } catch (err) {
                // A site's refusal, or a page shape the reader didn't know: this keyword is skipped.
                // Anything else (the desk not up yet) is Restate's to retry, and the week waits.
                if (!(err instanceof SiteCallError || err instanceof TypeError)) throw err;
                e.failed = errorText(err);
                if (++misses >= ENGINE_MISSES) break;
              }
            }
          }

          const stats: WeekStats = { ...grow, asked, questions };
          const notifier = deps.notifier;
          if (notifier) {
            const lines = [
              `keywords: ${grow.discovered} found in Search Console, ${grow.fanout.added} fan-out questions, ${questions} from Google's "People also ask"`,
              ...Object.entries(asked).map(
                ([e, a]) =>
                  `${e}: cited on ${a.cited} of ${a.asked} asked${a.failed ? ` (stopped: ${a.failed.slice(0, 120)})` : ""}`,
              ),
              "brief ready, run `/search-week`",
            ];
            await ctx.run("notify", () =>
              notifier.notify(
                `search: week of ${weekOf(new Date(`${today}T00:00:00Z`))}`,
                lines.join("\n"),
                "info",
              ),
            );
          }
          return stats;
        },
      ),
    },
  });
}

export type SearchWatch = ReturnType<typeof makeSearchWatch>;
export type SearchWeek = ReturnType<typeof makeSearchWeek>;

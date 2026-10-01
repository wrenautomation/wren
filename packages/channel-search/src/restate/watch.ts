/**
 * `SearchWatch/default`: once a day, Search Console into `search_days` and
 * each sitemap page's index state into `search_pages`; a page that leaves or
 * enters the index is one notice. On the first pass of a Monday it sends
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
import type { FetchLike } from "@wren/channel-email";
import { recordedRun } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import { errorText, makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { ask, dueKeywords, recordAnswer } from "../answers.js";
import { type SearchConsoleClient, sitemapUrls } from "../console.js";
import { discoverKeywords, fanOut } from "../keywords.js";
import { ENGINES, type Engine } from "../schema.js";
import { siteText } from "../site.js";
import { formatChanges, type SyncStats, syncSearch } from "../sync.js";

export const SEARCH_KEY = "default";
export const SEARCH_SYNC_COMMAND = "search sync";
export const SEARCH_WEEK_COMMAND = "search week";
const WEEK = "week";
const MONDAY = 1;
const DAY_MS = 86_400_000;
/** Keywords asked per engine per week: far under Google's pace and the free Perplexity plan. */
const ASKS_PER_ENGINE = 20;
/** An engine that fails this many in a row is off for the week (the Mac asleep, a sign-in gone). */
const ENGINE_MISSES = 3;

export interface SearchDeps {
  db: Db;
  console: SearchConsoleClient;
  /** The Search Console property (`sc-domain:example.com`). */
  site: string;
  /** The site's origin (`https://example.com`): its sitemap, pages and `/llms.txt`. */
  origin: string;
  fetch: FetchLike;
  notifier?: Notifier;
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

export function makeSearchWatch(deps: SearchDeps) {
  return makeLoopObject<SyncStats & { week: string | null }>("SearchWatch", async (ctx) => {
    const now = new Date(await ctx.date.now());
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
        return { ...stats, week: null as string | null };
      },
      delayAfter: () => DAY_MS,
      retryMs: DAY_MS / 4,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    const changes = outcome.stats?.changes ?? [];
    if (deps.notifier && changes.length) {
      const notifier = deps.notifier;
      await ctx.run("notify index", () =>
        notifier.notify(
          `search: ${changes.length} page(s) changed in Google's index`,
          formatChanges(changes).join("\n"),
          "warning",
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
      run: async (ctx: restate.Context, req: { today: string }): Promise<WeekStats> => {
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
    },
  });
}

export type SearchWatch = ReturnType<typeof makeSearchWatch>;
export type SearchWeek = ReturnType<typeof makeSearchWeek>;

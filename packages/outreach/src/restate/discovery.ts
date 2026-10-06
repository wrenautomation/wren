/**
 * Reddit discovery on Restate (designs/2026-10-06-reddit-discovery.md): `RedditReads/wren` reads
 * signed out (autobrowse `reddit-public`, paced and capped by the desk). One pass: find places
 * monthly, judge the unread ones, read each watched place's new posts every 2 hours (filter,
 * rank, queue), draft the queue with research (thread, OP, our SOPs), read back our comments'
 * scores. Reddit reads are journaled calls in the handler; the model and the table in `ctx.run`.
 * A 429 (the desk's daily cap) ends the pass's reads until the next one.
 */
import * as restate from "@restatedev/restate-sdk";
import { SiteCallError } from "@wren/core/content";
import {
  errorText,
  lastPass,
  makeLoopObject,
  type PassOutcome,
  serviceHandler,
  setLastPass,
} from "@wren/core/restate";
import type { LlmClient } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { peopleToRead, readPerson } from "../discovery/people.js";
import {
  type Audience,
  addPlaces,
  failPlace,
  judgePlace,
  keepPlace,
  movePlace,
  PLACE_FRESH_MS,
  placesDue,
  placesOfPeople,
  placesToRead,
  skipPlace,
  threadsRead,
  topicsOf,
  watchPlace,
} from "../discovery/places.js";
import { reader } from "../discovery/reads.js";
import {
  draftThread,
  keepScores,
  keepThreads,
  markCommented,
  planThreadComment,
  queueThreads,
  RANK_BATCH,
  rankThreads,
  skipThread,
  threadsToDraft,
  threadsToScore,
} from "../discovery/threads.js";
import { ReachRefusal } from "../refusal.js";
import { reachAccounts } from "../schema.js";
import { channelsFor, type ReachDeps, wakeWatch } from "./index.js";

export const READS_KEY = "wren";
const HOUR = 3_600_000;
export const THREADS_EVERY_MS = 2 * HOUR;
/** Per pass, so one pass stays a few minutes of reads at the desk's pace. */
const PLACES_PER_PASS = 3;
const DRAFTS_PER_PASS = 5;
/** Commenters on our posts and DM contacts read a pass: 3 reads each. */
const PEOPLE_PER_PASS = 5;
/** More waiting: come back soon; else every half hour. */
const BUSY_MS = 2 * 60_000;
const IDLE_MS = 30 * 60_000;
const FOUND_AT = "foundAt";

export interface DiscoveryDeps {
  llm: LlmClient | null;
  /** William's voice for drafts (content's voice file or its default). */
  voice: string;
  /** Our own facts: each pushed SOP's newest text. */
  facts: () => Promise<{ label: string; text: string }[]>;
  /** Who we talk to: the `reddit.discovery` setting. */
  audience: () => Promise<Audience>;
}

export interface DiscoveryStats {
  found: number;
  judged: number;
  kept: number;
  ranked: number;
  queued: number;
  drafted: number;
  people: number;
  scored: number;
  capped: boolean;
  errors: string[];
}

const capped = (err: unknown) => err instanceof SiteCallError && err.status === 429;

export function makeRedditReads(deps: ReachDeps & { discovery: DiscoveryDeps }) {
  const { db, discovery: d } = deps;
  return makeLoopObject<DiscoveryStats>("RedditReads", async (ctx) => {
    const now = deps.clock ? deps.clock() : new Date(await ctx.date.now());
    const r = reader(deps.sitesFor(ctx));
    const step = <T>(name: string, fn: () => Promise<T>) => ctx.run(name, fn);
    const audience = await step("audience", () => d.audience());
    const ours = await step("ours", async () =>
      (
        await db
          .select({ handle: reachAccounts.handle })
          .from(reachAccounts)
          .where(eq(reachAccounts.platform, "reddit"))
      ).flatMap((a) => (a.handle ? [a.handle] : [])),
    );
    const s: DiscoveryStats = {
      found: 0,
      judged: 0,
      kept: 0,
      ranked: 0,
      queued: 0,
      drafted: 0,
      people: 0,
      scored: 0,
      capped: false,
      errors: [],
    };
    /** One unit of reads; a cap stops the rest of the pass, anything else is noted and passed. */
    const reading = async (what: string, fn: () => Promise<void>) => {
      if (s.capped) return;
      try {
        await fn();
      } catch (err) {
        if (capped(err)) s.capped = true;
        s.errors.push(`${what}: ${errorText(err)}`);
      }
    };

    // Places: found once a month, each judged when unread or a month old.
    const foundAt = (await ctx.get<number>(FOUND_AT)) ?? 0;
    if (now.getTime() - foundAt >= PLACE_FRESH_MS) {
      const topics = await step("topics", () => topicsOf(d.llm, audience));
      const found: { name: string; foundBy: string; subscribers?: number }[] =
        audience.subreddits.map((n) => ({ name: n, foundBy: "named" }));
      for (const t of topics)
        await reading(`search ${t}`, async () => {
          for (const p of await r.searchPlaces(t))
            found.push({ name: p.name, foundBy: `topic: ${t}`, subscribers: p.subscribers });
        });
      // Exa: a few searches a pass from the shared credit; a miss (spent, capped) ends them.
      for (const t of topics.slice(0, audience.exaSearches))
        try {
          for (const n of await r.exaPlaces(t)) found.push({ name: n, foundBy: `exa: ${t}` });
        } catch (err) {
          s.errors.push(`exa ${t}: ${errorText(err)}`);
          break;
        }
      for (const n of await step("people places", () => placesOfPeople(db)))
        found.push({ name: n, foundBy: "people" });
      s.found = await step("add places", () => addPlaces(db, found));
      if (!s.capped) ctx.set(FOUND_AT, now.getTime());
    }
    const toRead = await step("places to read", () => placesToRead(db, now, PLACES_PER_PASS));
    for (const p of toRead)
      await reading(`r/${p.subreddit}`, async () => {
        try {
          const read = await r.place(p.subreddit);
          await step(`judge r/${p.subreddit}`, async () =>
            keepPlace(
              db,
              p.subreddit,
              read,
              d.llm ? await judgePlace(d.llm, p.subreddit, read, audience) : null,
              now,
            ),
          );
          s.judged++;
        } catch (err) {
          if (capped(err)) throw err;
          await step(`fail r/${p.subreddit}`, () =>
            failPlace(db, p.subreddit, errorText(err), now),
          );
          throw err;
        }
      });

    // Threads: each watched place's new posts every 2 hours.
    const due = await step("places due", () =>
      placesDue(db, now, THREADS_EVERY_MS, PLACES_PER_PASS),
    );
    for (const p of due)
      await reading(`r/${p.subreddit} new`, async () => {
        const posts = await r.latest(p.subreddit);
        const fresh = await step(`keep r/${p.subreddit}`, async () => {
          const ids = await keepThreads(db, p.subreddit, posts, { now, ours, judged: p.judged });
          await threadsRead(db, p.subreddit, now);
          return ids;
        });
        s.kept += fresh.length;
        const llm = d.llm;
        if (llm)
          for (let i = 0; i < fresh.length; i += RANK_BATCH) {
            const batch = fresh.slice(i, i + RANK_BATCH);
            s.ranked += await step(`rank r/${p.subreddit} ${i}`, () =>
              rankThreads(db, llm, batch, audience),
            );
          }
        s.queued += (
          await step(`queue r/${p.subreddit}`, () => queueThreads(db, p.subreddit, now))
        ).length;
      });

    // Drafts, with research: the whole thread, the OP, our facts.
    const llm = d.llm;
    if (llm) {
      const facts = await step("facts", () => d.facts());
      for (const t of await step("to draft", () => threadsToDraft(db, DRAFTS_PER_PASS)))
        await reading(`draft ${t.id}`, async () => {
          const read = await r.thread(t.id);
          const op =
            t.author === "[deleted]"
              ? null
              : await readPerson(r, db, llm, t.author, {
                  audience: audience.about,
                  now,
                  step,
                }).catch((err) => {
                  if (capped(err)) throw err;
                  return null;
                });
          const out = await step(`draft ${t.id}`, () =>
            draftThread(db, llm, t.id, { read, op, facts, voice: d.voice, ours }),
          );
          if (out === "drafted") s.drafted++;
        });
    }

    // People who talk to us: commenters on our posts, DM contacts.
    for (const handle of await step("people", () => peopleToRead(db, ours, now, PEOPLE_PER_PASS)))
      await reading(`u/${handle}`, async () => {
        await readPerson(r, db, d.llm, handle, { audience: audience.about, now, step });
        s.people++;
      });

    // Learn: our comments' scores two days on.
    const toScore = await step("to score", () => threadsToScore(db, now));
    if (toScore.length)
      await reading("scores", async () => {
        const got = await r.info(toScore.flatMap((t) => (t.ref ? [t.ref] : [])));
        const scores = got.map((g) => ({ ref: g.name, score: g.score ?? 0 }));
        await step("keep scores", () => keepScores(db, scores, now));
        s.scored = scores.length;
      });

    const more =
      !s.capped &&
      (toRead.length === PLACES_PER_PASS ||
        due.length === PLACES_PER_PASS ||
        s.queued > 0 ||
        s.drafted === DRAFTS_PER_PASS ||
        s.people === PEOPLE_PER_PASS);
    const previous = await lastPass<PassOutcome<DiscoveryStats>>(ctx);
    const error =
      s.errors.length && !s.judged && !s.kept && !s.drafted && !s.people
        ? (s.errors[0] ?? null)
        : null;
    const outcome: PassOutcome<DiscoveryStats> = {
      stats: s,
      error,
      failures: error ? (previous?.failures ?? 0) + 1 : 0,
      delayMs: s.capped ? 6 * HOUR : more ? BUSY_MS : IDLE_MS,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    return outcome;
  });
}

export type RedditReadsObject = ReturnType<typeof makeRedditReads>;

const SUB = z.looseObject({ subreddit: z.string() });
const MOVE = SUB.extend({ account: z.string().describe("reddit@alt, or the handle") });
const THREAD = z.looseObject({ id: z.string() });
const COMMENT = THREAD.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});

/** The desk's discovery handlers, bound on ReachDesk. */
export function discoveryHandlers(deps: ReachDeps) {
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
      throw err;
    }
  };
  const nowOf = async (ctx: restate.Context) =>
    deps.clock ? deps.clock() : new Date(await ctx.date.now());
  return {
    /** Watch a place: its threads are read every 2 hours, from the pool account it gets. */
    watchPlace: serviceHandler(
      { input: SUB },
      async (ctx: restate.Context, req: { subreddit: string }) => {
        const now = await nowOf(ctx);
        const r = await ctx.run("watch", () =>
          terminal(() => watchPlace(deps.db, req.subreddit, now)),
        );
        ctx
          .objectSendClient<{ wake: (c: restate.ObjectContext) => Promise<unknown> }>(
            { name: "RedditReads" },
            READS_KEY,
          )
          .wake();
        return r;
      },
    ),
    skipPlace: serviceHandler(
      { input: SUB },
      async (ctx: restate.Context, req: { subreddit: string }): Promise<void> => {
        await ctx.run("skip", () => skipPlace(deps.db, req.subreddit));
      },
    ),
    movePlace: serviceHandler(
      { input: MOVE },
      async (
        ctx: restate.Context,
        req: { subreddit: string; accountId: string },
      ): Promise<void> => {
        await ctx.run("move", () =>
          terminal(() => movePlace(deps.db, req.subreddit, req.accountId)),
        );
      },
    ),
    /** Comment in a queued thread from its place's account. Sent now: the click is the yes. */
    commentThread: serviceHandler(
      { input: COMMENT, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: string; body?: string | null },
      ): Promise<{ ref: string | null }> => {
        const now = await nowOf(ctx);
        const plan = await ctx.run("plan", () =>
          terminal(() => planThreadComment(deps.db, req.id, now)),
        );
        const body = (req.body ?? plan.thread.draft ?? "").trim();
        if (!body) throw new restate.TerminalError("the comment is empty");
        const ch = channelsFor(deps, ctx)(plan.account);
        if (!ch?.comment) throw new restate.TerminalError("this account can't comment");
        // The guard again at send: none of ours may already be in the thread.
        const authors = (await ch.threadAuthors?.(plan.thread.id)) ?? [];
        const met = plan.others.find((o) =>
          authors.some((a) => a.toLowerCase() === o.toLowerCase()),
        );
        if (met) throw new restate.TerminalError(`u/${met} already wrote in this thread`);
        const sent = await ch.comment(plan.thread.target ?? plan.thread.id, body);
        await ctx.run("commented", () =>
          markCommented(deps.db, req.id, { body, ref: sent.ref, accountId: plan.account.id, now }),
        );
        wakeWatch(ctx);
        return { ref: sent.ref };
      },
    ),
    skipThread: serviceHandler(
      { input: THREAD },
      async (ctx: restate.Context, req: { id: string }): Promise<void> => {
        await ctx.run("skip", () => skipThread(deps.db, req.id));
      },
    ),
  };
}

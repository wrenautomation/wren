/**
 * Reddit discovery on Restate (designs/2026-10-06-reddit-discovery.md): `RedditReads/wren` reads
 * signed out (autobrowse `reddit-public`, paced and capped by the desk). One pass: find places
 * monthly, judge the unread ones, read each watched place's new posts every 2 hours (filter,
 * rank, queue), draft the queue with research (thread, OP, our SOPs), read back our comments'
 * scores. Reddit reads are journaled calls in the handler; the model and the table in `ctx.run`.
 * A used daily cap (the desk's 429 waiting hours) holds that identity's reads until it resets, on
 * the object's state: no pass asks it before then, and it is no error. Signed out held, drafts read
 * signed in as the thread's account.
 *
 * Each desk call waits at most the `sites` client's `limitMs` (the worker passes `LIMITS.desk`).
 * A read that gets no answer is noted and passed; one that gets none three passes in a row is held
 * (`unit_holds`, stage `loop.reddit-reads/<key>`). Two in a pass with nothing answered: the desk is
 * down, and the pass's other signed-out reads wait for the next one. The topics model call is cut
 * at `TOPICS_WAIT_MS` a try, three tries; a miss leaves the month's search for the next pass.
 */
import * as restate from "@restatedev/restate-sdk";
import { byOf, keepSentEdit } from "@wren/core/ask";
import { type CapHolds, capHeld, holdCap, liveHolds } from "@wren/core/content";
import { isVendorStop } from "@wren/core/metered";
import type { OurPost } from "@wren/core/our-posts";
import {
  CallTimeout,
  clientOfKey,
  errorText,
  LIMITS,
  lastPass,
  limitedRun,
  makeLoopObject,
  type PassOutcome,
  serviceHandler,
  setLastPass,
  stoppedPass,
  unitLimits,
} from "@wren/core/restate";
import { gate } from "@wren/core/vendors";
import type { LlmClient } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { clientReach, syncLogins } from "../clients.js";
import { peopleToRead, readPerson } from "../discovery/people.js";
import {
  type Audience,
  addPlaces,
  discoverySettingsSchema,
  failPlace,
  joined,
  judgePlace,
  keepPlace,
  movePlace,
  PLACE_FRESH_MS,
  placesDue,
  placesOfPeople,
  placesToJoin,
  placesToRead,
  skipPlace,
  threadsRead,
  topicsOf,
  WREN_ABOUT,
  watchPlace,
} from "../discovery/places.js";
import { PUBLIC_SITE, reader, SUBS_PER_READ } from "../discovery/reads.js";
import { ThreadHeld } from "../discovery/requirements.js";
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
  unrankedThreads,
} from "../discovery/threads.js";
import { ReachRefusal } from "../refusal.js";
import { scheduleThreads, sendFailed, stillDue, unschedule } from "../scheduled.js";
import { reachAccounts } from "../schema.js";
import { channelsFor, clientDeps, type ReachDeps, terminalWhy, wakeWatch } from "./index.js";
import { isSendUnsure, type Landed, sendAtMostOnce, sendError } from "./maybe-sent.js";
import { scheduleProofs } from "./proofs.js";
import { fireSlots } from "./schedule.js";

export const READS_KEY = "wren";
const HOUR = 3_600_000;
/** One listing reads every watched sub at once, so threads are read often for little. */
export const THREADS_EVERY_MS = HOUR / 2;
/** Per pass, so one pass stays a few minutes of reads at the desk's pace. */
const PLACES_PER_PASS = 3;
/** Watched places whose threads a pass reads, in listings of SUBS_PER_READ. */
const PLACES_MAX = 100;
const DRAFTS_PER_PASS = 5;
/**
 * Joins a pass: a watched place's account joins it, so its comments come from a member. Passes
 * run each half hour, so a day's joins stay under the desk's 10 per account.
 */
const JOINS_PER_PASS = 1;
/** Commenters on our posts and DM contacts read a pass: 3 reads each. */
const PEOPLE_PER_PASS = 5;
/** More waiting: come back soon; else every half hour. */
const BUSY_MS = 2 * 60_000;
const IDLE_MS = 30 * 60_000;
const FOUND_AT = "foundAt";
/** One try of the topics model call: a short completion, seconds when the model is up. */
const TOPICS_WAIT_MS = LIMITS.http;
/** Object state: reads a used daily cap holds, until it resets (ms): `reddit-public`, or an account. */
const CAP_HOLDS = "capHolds";

export interface DiscoveryDeps {
  llm: LlmClient | null;
  /** William's voice for drafts (content's voice file or its default). */
  voice: string;
  /** Our own facts: each pushed SOP's newest text. */
  facts: () => Promise<{ label: string; text: string }[]>;
  /**
   * What is true about the writer, the only first-person claims a draft may make (`wrenFacts`).
   * Left out (a client's pass), a draft claims nothing first-person.
   */
  truths?: () => Promise<readonly string[]>;
  /** What we've posted: what thread comments draw on. Left out (a client's pass), none. */
  ours?: () => Promise<readonly OurPost[]>;
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
  /** The signed-out daily cap is used: no signed-out read until it resets. No error. */
  capped: boolean;
  /** A client's vendor gate said no: why. Its reads end for the pass, as on a cap. */
  stopped: string | null;
  /** Watched places their account joined this pass. */
  joined?: number;
  /** Drafted threads put on spaced slots this pass (`autoSend`). */
  scheduled?: number;
  errors: string[];
}

/** A client's drafts until its own voice is a setting: plain, as the business's own account. */
export const CLIENT_VOICE =
  "Plain and helpful, as the business's own account: answer the question first, no pitch, no links unless asked.";

export function makeRedditReads(deps: ReachDeps & { discovery: DiscoveryDeps }) {
  return makeLoopObject<DiscoveryStats>("RedditReads", async (ctx) => {
    const now = deps.clock ? deps.clock() : new Date(await ctx.date.now());
    const owner = clientOfKey(ctx.key);
    if (!owner) return readsPass(deps, deps.discovery, ctx, now);
    const clients = deps.clients;
    if (!clients) return stoppedPass<DiscoveryStats>(ctx, now, "no client databases here");
    const plan = await ctx.run("client", () =>
      clientReach(deps.db, owner.client, ["reddit.discovery"]),
    );
    if (plan.kind === "gone") return stoppedPass<DiscoveryStats>(ctx, now, plan.why);
    if (!plan.logins.some((l) => l.platform === "reddit"))
      return stoppedPass<DiscoveryStats>(ctx, now, "no Reddit login connected");
    // Wren's buyers are the default `about`: a client's pass never reads for them.
    const block = (plan.client.products["reddit.discovery"] ?? {}) as Record<string, unknown>;
    if (typeof block.about !== "string" || !block.about.trim() || block.about.trim() === WREN_ABOUT)
      return stoppedPass<DiscoveryStats>(ctx, now, "say who its buyers are: set About");
    const audience = discoverySettingsSchema.safeParse(block);
    if (!audience.success)
      return stoppedPass<DiscoveryStats>(ctx, now, "the Reddit discovery settings do not parse");
    const model = await ctx.run(
      "gate models",
      async () => (await gate(deps.db, owner.client, "models", 1, now)).ok,
    );
    const d = clientDeps(deps, plan, "reddit.discovery", now, model);
    await ctx.run("logins", async () => {
      await syncLogins(d.db, plan.logins, now);
    });
    return readsPass(
      d,
      {
        llm: d.drafts?.llm ?? null,
        voice: CLIENT_VOICE,
        facts: () => clients.facts?.(d.db) ?? Promise.resolve([]),
        audience: async () => audience.data,
      },
      ctx,
      now,
    );
  });
}

/** One pass of reads: Wren's in main, or a client's in its own database on its own gate. */
async function readsPass(
  deps: ReachDeps,
  d: DiscoveryDeps,
  ctx: restate.ObjectContext,
  now: Date,
): Promise<PassOutcome<DiscoveryStats>> {
  const db = deps.db;
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
    stopped: null,
    errors: [],
  };
  const holds = liveHolds((await ctx.get<CapHolds>(CAP_HOLDS)) ?? {}, now.getTime());
  /** `who`'s cap is used (`reddit-public`, or an account): held until it resets. */
  const held = (who: string) => capHeld(holds, who, now.getTime());
  /** `err` used `who`'s daily cap: hold it, no error. */
  const spent = (who: string, err: unknown) => holdCap(holds, who, err, now.getTime());
  s.capped = held(PUBLIC_SITE);
  const limits = await unitLimits(ctx, db, "RedditReads");
  /**
   * One unit of signed-out reads; a used cap stops the rest, anything else is noted and passed.
   * Its no-answers count as strikes on the unit, or on the desk when nothing else answered.
   */
  const reading = async (what: string, fn: () => Promise<void>) => {
    if (s.capped || limits.skip(what, PUBLIC_SITE)) return;
    try {
      await limits.guard(what, fn, PUBLIC_SITE);
    } catch (err) {
      if (spent(PUBLIC_SITE, err)) {
        s.capped = true;
        return;
      }
      if (isVendorStop(err)) s.stopped ??= err.why;
      s.errors.push(`${what}: ${errorText(err)}`);
    }
  };

  // Places: found once a month, each judged when unread or a month old.
  const foundAt = (await ctx.get<number>(FOUND_AT)) ?? 0;
  if (!s.capped && now.getTime() - foundAt >= PLACE_FRESH_MS) {
    // A model call: cut a try at its limit, and after three the month's search waits a pass.
    let searched = true;
    const topics = await limitedRun(ctx, "topics", () => topicsOf(d.llm, audience), {
      ms: TOPICS_WAIT_MS,
    }).catch((err) => {
      if (!(err instanceof restate.TerminalError)) throw err;
      s.errors.push(`topics: ${errorText(err)}`);
      searched = false;
      return [] as string[];
    });
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
    if (!s.capped && searched) ctx.set(FOUND_AT, now.getTime());
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
        // No answer is no verdict on the place: read again next pass, held after three.
        if (spent(PUBLIC_SITE, err) || err instanceof CallTimeout) throw err;
        await step(`fail r/${p.subreddit}`, () => failPlace(db, p.subreddit, errorText(err), now));
        throw err;
      }
    });

  // Threads: every watched place's new posts in one listing (r/a+b+c/new), each half hour.
  const due = await step("places due", () => placesDue(db, now, THREADS_EVERY_MS, PLACES_MAX));
  for (let at = 0; at < due.length; at += SUBS_PER_READ) {
    const group = due.slice(at, at + SUBS_PER_READ);
    // Back to the oldest last read in the group (a day for a new place), so no post is missed.
    // The journal hands `threadsAt` back as text, so it's read through Date.
    const since = Math.min(
      ...group.map((p) =>
        p.threadsAt ? new Date(p.threadsAt).getTime() : now.getTime() - 24 * HOUR,
      ),
    );
    await reading(`r/${group.map((p) => p.subreddit).join("+")} new`, async () => {
      const posts = await r.latest(
        group.map((p) => p.subreddit),
        since,
      );
      const bySub = new Map<string, typeof posts>();
      for (const x of posts) {
        const k = (x.subreddit ?? "").toLowerCase();
        bySub.set(k, [...(bySub.get(k) ?? []), x]);
      }
      for (const p of group) {
        const fresh = await step(`keep r/${p.subreddit}`, async () => {
          const ids = await keepThreads(db, p.subreddit, bySub.get(p.subreddit) ?? [], {
            now,
            ours,
            judged: p.judged,
          });
          await threadsRead(db, p.subreddit, now);
          return ids;
        });
        s.kept += fresh.length;
        const llm = d.llm;
        const unranked = llm
          ? await step(`unranked r/${p.subreddit}`, () => unrankedThreads(db, p.subreddit))
          : [];
        if (llm)
          for (let i = 0; i < unranked.length; i += RANK_BATCH) {
            const batch = unranked.slice(i, i + RANK_BATCH);
            s.ranked += await step(`rank r/${p.subreddit} ${i}`, () =>
              rankThreads(db, llm, batch, audience),
            );
          }
        s.queued += (
          await step(`queue r/${p.subreddit}`, () => queueThreads(db, p.subreddit, now))
        ).length;
      }
    });
  }

  // Drafts, with research: the whole thread, the OP, our facts.
  const llm = d.llm;
  if (llm) {
    const facts = await step("facts", () => d.facts());
    const truths = d.truths
      ? await step("truths", async () => [...((await d.truths?.()) ?? [])])
      : [];
    const posts = d.ours
      ? await step("our posts", async () => [...((await d.ours?.()) ?? [])])
      : [];
    // A used signed-out cap doesn't hold drafts: the thread is read signed in as the account
    // that will comment there (its own read cap), and the author's card is left out. A thread
    // with no account waits for the reset.
    const accounts = new Map(
      await step("draft accounts", async () =>
        (
          await db
            .select({ id: reachAccounts.id, account: reachAccounts.account })
            .from(reachAccounts)
            .where(eq(reachAccounts.platform, "reddit"))
        ).map((a) => [a.id, a.account] as const),
      ),
    );
    for (const t of await step("to draft", () => threadsToDraft(db, DRAFTS_PER_PASS, now))) {
      const as = t.accountId ? accounts.get(t.accountId) : undefined;
      const signedIn = as && !held(as) ? as : null;
      if (s.capped && !signedIn) continue;
      try {
        let read = s.capped
          ? null
          : await r.thread(t.id).catch((err) => {
              if (!spent(PUBLIC_SITE, err)) throw err;
              s.capped = true;
              return null;
            });
        if (!read) {
          if (!signedIn) continue;
          read = await reader(deps.sitesFor(ctx), signedIn).thread(t.id);
        }
        const op =
          t.author === "[deleted]" || s.capped
            ? null
            : await readPerson(r, db, llm, t.author, {
                audience: audience.about,
                now,
                step,
              }).catch((err) => {
                if (spent(PUBLIC_SITE, err)) s.capped = true;
                return null;
              });
        const out = await step(`draft ${t.id}`, () =>
          draftThread(db, llm, t.id, { read, op, facts, truths, voice: d.voice, ours, posts }),
        );
        if (out === "drafted") s.drafted++;
      } catch (err) {
        if (as && spent(as, err)) continue;
        if (isVendorStop(err)) s.stopped ??= err.why;
        s.errors.push(`draft ${t.id}: ${errorText(err)}`);
      }
    }
  }
  // Wren's own pass with autoSend: drafted threads onto each account's spaced slots.
  if (audience.autoSend && !clientOfKey(ctx.key)) {
    const slots = await step("schedule", () => scheduleThreads(db, { now, rand: Math.random }));
    await fireSlots(ctx, slots);
    s.scheduled = slots.length;
  }

  // People who talk to us: commenters on our posts, DM contacts.
  for (const handle of await step("people", () => peopleToRead(db, ours, now, PEOPLE_PER_PASS)))
    await reading(`u/${handle}`, async () => {
      await readPerson(r, db, d.llm, handle, { audience: audience.about, now, step });
      s.people++;
    });

  // Learn: our comments' scores two days on.
  for (const p of await step("to join", () => placesToJoin(db, JOINS_PER_PASS)))
    try {
      await deps
        .sitesFor(ctx)
        .call(
          "reddit",
          "POST",
          "/api/subscribe",
          { sr_name: p.subreddit, action: "sub" },
          p.account,
        );
      await step(`joined r/${p.subreddit}`, () => joined(db, p.subreddit, now));
      s.joined = (s.joined ?? 0) + 1;
    } catch (err) {
      s.errors.push(`join r/${p.subreddit}: ${errorText(err)}`);
    }

  const toScore = await step("to score", () => threadsToScore(db, now));
  if (toScore.length)
    await reading("scores", async () => {
      const got = await r.info(toScore.flatMap((t) => (t.ref ? [t.ref] : [])));
      const scores = got.map((g) => ({ ref: g.name, score: g.score ?? 0 }));
      await step("keep scores", () => keepScores(db, scores, now));
      s.scored = scores.length;
    });

  ctx.set(CAP_HOLDS, holds);
  const more =
    !s.capped &&
    (toRead.length === PLACES_PER_PASS ||
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
    delayMs: more ? BUSY_MS : IDLE_MS,
    now: now.toISOString(),
  };
  await setLastPass(ctx, outcome);
  return outcome;
}

export type RedditReadsObject = ReturnType<typeof makeRedditReads>;

const SUB = z.looseObject({ subreddit: z.string() });
const MOVE = SUB.extend({ account: z.string().describe("reddit@alt, or the handle") });
const THREAD = z.looseObject({ id: z.string() });
const COMMENT = THREAD.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
  at: z.iso
    .datetime()
    .nullish()
    .describe("The scheduler's slot; one moved or cleared sends nothing"),
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
      async (ctx: restate.Context, req: { subreddit: string; account: string }): Promise<void> => {
        // The input names it `account` (MOVE); `accountId` was always undefined here.
        await ctx.run("move", () => terminal(() => movePlace(deps.db, req.subreddit, req.account)));
      },
    ),
    /** Comment in a queued thread from its place's account. Sent now: the click is the yes. */
    commentThread: serviceHandler(
      { input: COMMENT, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: string; body?: string | null; at?: string | null; again?: boolean },
      ): Promise<{ ref: string | null; held?: string }> => {
        const now = await nowOf(ctx);
        const at = req.at;
        if (at && !(await ctx.run("due", () => stillDue(deps.db, "thread", req.id, at))))
          return { ref: null, held: "taken off the schedule" };
        // A sub whose floor we don't meet holds the comment: queued, not dropped, not sent.
        const planned = await ctx.run("plan", async () => {
          try {
            return { plan: await planThreadComment(deps.db, req.id, now) };
          } catch (err) {
            if (err instanceof ThreadHeld) return { held: err.message };
            if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
            throw err;
          }
        });
        if ("held" in planned) {
          if (!at) throw new restate.TerminalError(planned.held);
          await ctx.run("hold", () => unschedule(deps.db, { threads: [req.id] }));
          return { ref: null, held: planned.held };
        }
        const plan = planned.plan;
        const body = (req.body ?? plan.thread.draft ?? "").trim();
        if (!body) throw new restate.TerminalError("the comment is empty");
        const ch = channelsFor(deps, ctx)(plan.account);
        const comment = ch?.comment;
        if (!ch || !comment) throw new restate.TerminalError("this account can't comment");
        const target = plan.thread.target ?? plan.thread.id;
        const findSent = ch.findSent;
        let sent: Landed;
        try {
          // At most once (designs/2026-10-16-maybe-sent.md): our words already there are
          // recorded, not sent again; a send that may have gone through is looked for.
          sent = await sendAtMostOnce(ctx, deps.db, {
            item: `thread:${req.id}`,
            platform: "reddit",
            account: plan.account.account,
            words: body,
            target,
            url: plan.thread.url,
            again: req.again === true,
            look:
              findSent && ((since) => findSent({ kind: "comment", to: target, text: body, since })),
            // The guard again at send: none of ours may already be in the thread.
            before: async () => {
              const authors = (await ch.threadAuthors?.(plan.thread.id)) ?? [];
              const met = plan.others.find((o) =>
                authors.some((a) => a.toLowerCase() === o.toLowerCase()),
              );
              if (met) throw new restate.TerminalError(`u/${met} already wrote in this thread`);
            },
            send: () => comment(target, body),
          });
        } catch (thrown) {
          // Unsure waits on a person in To approve; its slot leaves the schedule.
          if (isSendUnsure(thrown)) {
            if (at) await ctx.run("hold", () => unschedule(deps.db, { threads: [req.id] }));
            throw thrown;
          }
          const err = sendError(thrown);
          if (at && err instanceof restate.TerminalError)
            await ctx.run("send failed", () => sendFailed(deps.db, "thread", req.id, err.message));
          throw err;
        }
        await ctx.run("commented", async () => {
          // Words that differ from the draft are his edit.
          await keepSentEdit(deps.db, {
            record: "thread",
            id: req.id,
            by: byOf(req),
            before: plan.thread.draft,
            after: body,
          });
          await markCommented(deps.db, req.id, {
            body,
            ref: sent.ref,
            accountId: plan.account.id,
            now,
            by: byOf(req),
          });
        });
        scheduleProofs(ctx, `thread:${req.id}`);
        wakeWatch(ctx);
        return { ref: sent.ref };
      },
    ),
    skipThread: serviceHandler(
      { input: THREAD },
      async (ctx: restate.Context, req: { id: string; reason?: unknown; note?: unknown }) => {
        const why = terminalWhy(req);
        await ctx.run("skip", () => skipThread(deps.db, req.id, { by: byOf(req), ...why }));
      },
    ),
  };
}

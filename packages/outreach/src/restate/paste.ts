/**
 * ReachDesk.paste: a link he pastes in Marketing → Engage (`../intercept.ts`). A subreddit or an
 * account is watched; a thread is queued and the reads pass woken to draft it; a post is read
 * once and drafted now, waiting in Engage like any other.
 */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { serviceHandler } from "@wren/core/restate";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { CREATOR_SITES, type CreatorSite, findCreators, markFollowed } from "../creator-search.js";
import { addPlaces, watchPlace } from "../discovery/places.js";
import { reader, signedOut } from "../discovery/reads.js";
import {
  followAccount,
  holdPasted,
  keepPasted,
  pastedOf,
  postUrlOf,
  queuePastedThread,
} from "../intercept.js";
import { allCommentsSettings, draftPost, postReader } from "../reach-posts.js";
import { ReachRefusal } from "../refusal.js";
import { READS_KEY } from "./discovery.js";
import type { ReachDeps } from "./index.js";

const PASTE = z.looseObject({ url: z.string().trim().min(1).max(2000) });
const FIND = z.looseObject({
  q: z.string().trim().min(1).max(200).describe("A name, a handle or a topic"),
  only: z.array(z.enum(CREATOR_SITES)).optional().describe("The sites to search; all when blank"),
});

/** What the paste did, in a line the console shows as is. */
export interface Pasted {
  did: "watching" | "following" | "queued" | "drafted" | "waiting" | "answered" | "dropped";
  said: string;
  /** The row it made or found: `thread:<id>` or `onpost:<id>`. */
  item: string | null;
}

export function pasteHandlers(deps: ReachDeps) {
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
  const wakeReads = (ctx: restate.Context) =>
    ctx
      .objectSendClient<{ wake: (c: restate.ObjectContext) => Promise<unknown> }>(
        { name: "RedditReads" },
        READS_KEY,
      )
      .wake();

  return {
    /**
     * Find accounts to follow by name or topic on every site (Marketing → Feed). Each hit says
     * whether it's followed already: in Learn's sources, or the comments' LinkedIn pages.
     */
    findCreators: serviceHandler(
      { input: FIND },
      async (ctx: restate.Context, req: { q: string; only?: CreatorSite[] }) => {
        const settings = await ctx.run("settings", () => allCommentsSettings(deps.db));
        const found = await findCreators(deps.sitesFor(ctx), req.q, {
          ...(req.only ? { only: req.only } : {}),
          // A search only reads, so it goes as Wren's own login when no comments account is set.
          accounts: {
            linkedin: settings.linkedin.account || "linkedin@wren",
            x: settings.x.account || "x@wren",
          },
        });
        const follows = await ctx.run("follows", async () =>
          (
            (await deps.db.execute(
              sql`select url, page from learn.sources where client = 'wren' and stopped_at is null`,
            )) as unknown as { url: string; page: string | null }[]
          ).flatMap((r) => (r.page ? [r.url, r.page] : [r.url])),
        );
        return {
          hits: markFollowed(found.hits, follows, settings.linkedin.pages),
          failed: found.failed,
        };
      },
    ),
    paste: serviceHandler(
      { input: PASTE },
      async (ctx: restate.Context, req: { url: string }): Promise<Pasted> => {
        const p = pastedOf(req.url);
        const now = await nowOf(ctx);
        const by = byOf(req) ?? "william";
        if (p.kind === "unknown") throw new restate.TerminalError(p.why, { errorCode: 400 });

        if (p.kind === "place") {
          const r = await ctx.run("watch", () =>
            terminal(async () => {
              await addPlaces(deps.db, [{ name: p.subreddit, foundBy: "pasted" }]);
              return watchPlace(deps.db, p.subreddit, now);
            }),
          );
          wakeReads(ctx);
          return {
            did: "watching",
            said: r.account
              ? `Watching r/${p.subreddit}. New threads show here as they come.`
              : `Watching r/${p.subreddit}. None of our Reddit accounts meets its minimums yet, so nothing is drafted there.`,
            item: null,
          };
        }

        if (p.kind === "account") {
          const added = await ctx.run("follow", () =>
            terminal(() => followAccount(deps.db, p.platform, p.handle, by)),
          );
          return {
            did: "following",
            said: added
              ? `Following ${p.handle}. Their new posts are read first each day.`
              : `Already following ${p.handle}.`,
            item: null,
          };
        }

        if (p.kind === "thread") {
          const read = await reader(signedOut(deps.sitesFor(ctx))).thread(p.id);
          const t = await ctx.run("queue", () =>
            terminal(() => queuePastedThread(deps.db, read, now)),
          );
          if (t.state === "commented")
            return { did: "answered", said: "We already commented there.", item: `thread:${t.id}` };
          wakeReads(ctx);
          return {
            did: "queued",
            said: `Queued "${t.title.slice(0, 80)}". Its draft lands here within a few minutes.`,
            item: `thread:${t.id}`,
          };
        }

        const settings = await ctx.run("settings", () => allCommentsSettings(deps.db));
        const s = settings[p.platform];
        if (!s.account)
          throw new restate.TerminalError(
            `no ${p.platform} account is set for comments (Shop → ${p.platform} comments)`,
          );
        const read = postReader(deps.sitesFor(ctx), p.platform, s.account, { now });
        const post = await read.one(p.ref);
        if (!post)
          throw new restate.TerminalError(`that post is gone: ${postUrlOf(p.platform, p.ref)}`);
        const kept = await ctx.run("keep", () =>
          keepPasted(deps.db, post, { platform: p.platform, account: s.account, now }),
        );
        const item = `onpost:${kept.id}`;
        if (kept.state === "queued")
          return { did: "waiting", said: "It already waits here.", item };
        if (kept.state === "commented")
          return { did: "answered", said: "We already commented on it.", item };
        const llm = deps.drafts?.llm;
        if (!llm) throw new restate.TerminalError("no model is set for drafts");
        const guide = deps.drafts?.commentGuide;
        const g = guide ? await ctx.run("guide", () => guide(p.platform)) : undefined;
        const facts = deps.drafts?.facts;
        const truths = facts ? await ctx.run("facts", async () => [...(await facts())]) : [];
        const out = await ctx.run("draft", () =>
          draftPost(deps.db, llm, kept.id, {
            ...(g ? { guide: g } : {}),
            facts: truths,
            ...(deps.drafts?.voice ? { voice: deps.drafts.voice } : {}),
            now,
          }),
        );
        if (out === "queued")
          return { did: "drafted", said: `Drafted a reply to ${post.author || "the post"}.`, item };
        await ctx.run("hold", () => holdPasted(deps.db, kept.id, now));
        return {
          did: "dropped",
          said: "The model had nothing worth adding. It waits here for your own words.",
          item,
        };
      },
    ),
  };
}

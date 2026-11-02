/**
 * His own picks, by link (Outreach → Engage, the paste box). Reddit: a subreddit is watched, a
 * thread queued for the next pass to draft. LinkedIn, X, Instagram: an account joins the comments
 * settings' pages (read first each pass, ranked as a key person), a post is read once and drafted
 * now. Pasting overrides the filters a found post must pass: fit, audience words, age.
 */
import { settingsFor, setWrenSettings } from "@wren/core/clients";
import { CanonError, resolveObject } from "@wren/core/objects";
import { atomic, type Queryable } from "@wren/db";
import { eq, inArray, sql } from "drizzle-orm";
import { accountFor, addPlaces, placeBySub } from "./discovery/places.js";
import type { ThreadRead } from "./discovery/threads.js";
import { type FeedPost, vanityOf } from "./reach-posts/read.js";
import { COMMENTS_COMPONENTS, COMMENTS_SETTINGS } from "./reach-posts/settings.js";
import { ReachRefusal } from "./refusal.js";
import { type ReachPostPlatform, reachPosts, redditThreads } from "./schema.js";

export type Pasted =
  | { kind: "place"; subreddit: string }
  | { kind: "thread"; subreddit: string | null; id: string }
  | { kind: "account"; platform: ReachPostPlatform; handle: string }
  | { kind: "post"; platform: ReachPostPlatform; ref: string }
  | { kind: "unknown"; why: string };

const NAME: Readonly<Record<ReachPostPlatform, string>> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  threads: "Threads",
};
/** First path parts that are the site's own pages, not an account. */
const X_PAGES = new Set([
  "home",
  "explore",
  "search",
  "i",
  "notifications",
  "messages",
  "settings",
  "hashtag",
  "intent",
  "share",
]);
const IG_PAGES = new Set([
  "explore",
  "accounts",
  "direct",
  "stories",
  "reels",
  "about",
  "developer",
  "legal",
]);
const POST_URN = /urn:li:(activity|ugcPost|share):(\d+)/;
const POST_SLUG = /-(activity|ugcPost|share)-(\d+)-/;

const unknown = (why: string): Pasted => ({ kind: "unknown", why });

/** What a pasted link names. */
export function pastedOf(raw: string): Pasted {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return unknown("that isn't a link");
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, "");
  const path = decodeURIComponent(u.pathname);
  const parts = path.split("/").filter(Boolean);
  const [a, b, c, d] = parts;
  if (host === "reddit.com") {
    if (a === "r" && b) {
      if (c === "comments" && d)
        return { kind: "thread", subreddit: b.toLowerCase(), id: `t3_${d}` };
      return { kind: "place", subreddit: b.toLowerCase() };
    }
    if (a === "comments" && b) return { kind: "thread", subreddit: null, id: `t3_${b}` };
    return unknown("on Reddit, paste a subreddit or a thread");
  }
  if (host === "redd.it" && a) return { kind: "thread", subreddit: null, id: `t3_${a}` };
  if (host === "linkedin.com") {
    const urn = POST_URN.exec(path) ?? POST_SLUG.exec(path);
    if (urn) return { kind: "post", platform: "linkedin", ref: `urn:li:${urn[1]}:${urn[2]}` };
    if ((a === "company" || a === "showcase") && b)
      return { kind: "account", platform: "linkedin", handle: b.toLowerCase() };
    if (a === "in" && b) {
      const vanity = vanityOf(`https://www.linkedin.com/in/${b}/`);
      if (vanity) return { kind: "account", platform: "linkedin", handle: `in/${vanity}` };
    }
    return unknown("on LinkedIn, paste a post, a company or a person");
  }
  if (host === "x.com" || host === "twitter.com") {
    const id =
      b === "status"
        ? c
        : a === "i" && b === "web" && c === "status"
          ? d
          : a === "i" && b === "status"
            ? c
            : undefined;
    if (id && /^\d+$/.test(id)) return { kind: "post", platform: "x", ref: id };
    if (a && !b && /^\w{1,15}$/.test(a) && !X_PAGES.has(a.toLowerCase()))
      return { kind: "account", platform: "x", handle: a.toLowerCase() };
    return unknown("on X, paste a post or an account");
  }
  if (host === "instagram.com") {
    if ((a === "p" || a === "reel" || a === "reels") && b)
      return { kind: "post", platform: "instagram", ref: b };
    if (a && !b && /^[\w.]{1,30}$/.test(a) && !IG_PAGES.has(a.toLowerCase()))
      return { kind: "account", platform: "instagram", handle: a.toLowerCase() };
    return unknown("on Instagram, paste a post or an account");
  }
  return unknown("paste a Reddit, LinkedIn, X or Instagram link");
}

/** A post's link from its ref, as the platform shows it. */
export function postUrlOf(platform: ReachPostPlatform, ref: string): string {
  if (platform === "linkedin") return `https://www.linkedin.com/feed/update/${ref}/`;
  if (platform === "x") return `https://x.com/i/status/${ref}`;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${ref}`;
  if (platform === "tiktok") return `https://www.tiktok.com/@_/video/${ref}`;
  if (platform === "threads") return `https://www.threads.com/t/${ref}`;
  return `https://www.instagram.com/p/${ref}/`;
}

/**
 * Follow an account: it joins the platform's pages, read first each pass. A LinkedIn person is
 * `in/<vanity>`. Answers false when it was there already.
 */
export async function followAccount(
  db: Queryable,
  platform: ReachPostPlatform,
  handle: string,
  by: string,
): Promise<boolean> {
  const component = COMMENTS_COMPONENTS[platform];
  const was = ((await settingsFor(db, null))[component] ?? {}) as Record<string, unknown>;
  const pages = Array.isArray(was.pages) ? (was.pages as string[]) : [];
  if (pages.some((p) => p.toLowerCase() === handle)) return false;
  const next = { ...was, pages: [handle, ...pages] };
  const ok = COMMENTS_SETTINGS[platform].safeParse(next);
  if (!ok.success)
    throw new ReachRefusal(`${NAME[platform]} comments settings: ${ok.error.issues[0]?.message}`);
  await setWrenSettings(db, component, next, by);
  return true;
}

/** A spelling no rule reads is the person's paste, not a fault: a refusal he sees. */
const refused =
  (why: string) =>
  (e: unknown): never => {
    throw e instanceof CanonError ? new ReachRefusal(why) : e;
  };

/**
 * Keep a pasted post as found, past the filters, so it drafts now. One already waiting or
 * answered stays as it is: the answer says which.
 */
export async function keepPasted(
  db: Queryable,
  p: FeedPost,
  o: { platform: ReachPostPlatform; account: string; now: Date },
): Promise<{ id: number; state: string }> {
  const at = p.at ? new Date(p.at) : null;
  const postedAt = at && !Number.isNaN(at.getTime()) ? at : null;
  const handle = p.handle ?? (o.platform === "linkedin" ? vanityOf(p.authorUrl) : null);
  return atomic(db, async (tx) => {
    // The post is a platform object first; the row keeps the ref that comes back.
    const ref = await resolveObject(tx, {
      platform: o.platform,
      kind: "post",
      raw: p.ref,
      url: p.url,
      author: handle,
      at: postedAt,
    }).catch(refused("that post has no usable address"));
    const values = {
      platform: o.platform,
      ref,
      author: p.author,
      authorUrl: p.authorUrl,
      handle,
      headline: p.headline ?? null,
      text: p.text,
      url: p.url,
      postedAt,
      reactions: p.reactions,
      comments: p.comments,
      foundBy: "pasted",
      account: o.account,
      fit: 100,
      why: "you pasted it",
      state: "found" as const,
      stateReason: null,
      raw: (p.raw ?? p) as Record<string, unknown>,
      createdAt: o.now,
    };
    await tx
      .insert(reachPosts)
      .values(values)
      .onConflictDoUpdate({
        target: [reachPosts.platform, reachPosts.ref],
        set: { state: "found", stateReason: null, fit: 100, why: "you pasted it", text: p.text },
        setWhere: inArray(reachPosts.state, ["found", "skipped", "dropped"]),
      });
    const [row] = await tx
      .select({ id: reachPosts.id, state: reachPosts.state })
      .from(reachPosts)
      .where(sql`${reachPosts.platform} = ${o.platform} and ${reachPosts.ref} = ${ref}`);
    if (!row) throw new Error("the pasted post was not kept");
    return row;
  });
}

/**
 * Queue a pasted thread for the next pass to draft: its place is added (not watched), the thread
 * gets the place's account. One already queued or answered stays as it is.
 */
export async function queuePastedThread(
  db: Queryable,
  read: ThreadRead,
  now: Date,
): Promise<{ id: string; state: string; title: string }> {
  const p = read.post;
  const sub = (p.subreddit ?? "").toLowerCase();
  const name = p.name;
  if (!name || !sub) throw new ReachRefusal("that thread didn't read");
  await addPlaces(db, [{ name: sub, foundBy: "pasted" }]);
  const place = await placeBySub(db, sub);
  const accountId = place.accountId ?? (await accountFor(db, place, now));
  return atomic(db, async (tx) => {
    // The thread is a platform object first; the row keeps the ref that comes back.
    const url = `https://www.reddit.com${p.permalink ?? `/comments/${p.id}`}`;
    const postedAt = new Date((p.created_utc ?? now.getTime() / 1000) * 1000);
    const ref = await resolveObject(tx, {
      platform: "reddit",
      kind: "post",
      raw: name,
      url,
      author: p.author && p.author !== "[deleted]" ? p.author : null,
      at: postedAt,
    }).catch(refused("that thread didn't read"));
    const row = {
      id: ref,
      subreddit: place.subreddit,
      title: p.title ?? "",
      body: p.selftext ?? "",
      author: p.author ?? "[deleted]",
      url,
      postedAt,
      comments: p.num_comments ?? 0,
      raw: p as unknown as Record<string, unknown>,
      dropped: null,
      fit: 10,
      angle: "you pasted it",
      state: "queued" as const,
      accountId,
    };
    await tx
      .insert(redditThreads)
      .values(row)
      .onConflictDoUpdate({
        target: redditThreads.id,
        set: { state: "queued", dropped: null, fit: 10, angle: "you pasted it", accountId },
        setWhere: inArray(redditThreads.state, ["new", "ranked", "dropped", "skipped"]),
      });
    const [t] = await tx
      .select({ id: redditThreads.id, state: redditThreads.state })
      .from(redditThreads)
      .where(eq(redditThreads.id, ref));
    if (!t) throw new Error("the pasted thread was not kept");
    return { ...t, title: row.title };
  });
}

/** A pasted post the model had nothing for still waits on him, with no draft, to write himself. */
export async function holdPasted(db: Queryable, id: number, now: Date): Promise<void> {
  await db
    .update(reachPosts)
    .set({ state: "queued", draft: null, stateReason: null, queuedAt: now })
    .where(eq(reachPosts.id, id));
}

/**
 * The link a found row stands for, picked from Explore: `reply` its own address; `follow` its
 * author's (X and Instagram by handle, LinkedIn by profile), or a thread's subreddit.
 */
export async function pickedUrl(
  db: Queryable,
  id: string,
  act: "reply" | "follow",
): Promise<string> {
  const at = id.indexOf(":");
  const [type, key] = [id.slice(0, at), id.slice(at + 1)];
  if (type === "thread") {
    const [t] = await db
      .select({ url: redditThreads.url, subreddit: redditThreads.subreddit })
      .from(redditThreads)
      .where(eq(redditThreads.id, key));
    if (!t) throw new ReachRefusal(`no thread ${key}`);
    return act === "reply" ? t.url : `https://www.reddit.com/r/${t.subreddit}/`;
  }
  const [p] = await db
    .select({
      platform: reachPosts.platform,
      url: reachPosts.url,
      ref: reachPosts.ref,
      handle: reachPosts.handle,
      authorUrl: reachPosts.authorUrl,
    })
    .from(reachPosts)
    .where(eq(reachPosts.id, Number(key)));
  if (!p) throw new ReachRefusal(`no post ${key}`);
  if (act === "reply") return p.url || postUrlOf(p.platform, p.ref);
  if (p.platform === "linkedin" && p.authorUrl) return p.authorUrl;
  const handle = p.handle?.replace(/^@/, "");
  if (handle && p.platform !== "linkedin")
    return {
      x: `https://x.com/${handle}`,
      youtube: `https://www.youtube.com/channel/${handle}`,
      tiktok: `https://www.tiktok.com/@${handle}`,
      threads: `https://www.threads.com/@${handle}`,
      instagram: `https://www.instagram.com/${handle}/`,
    }[p.platform];
  if (p.authorUrl) return p.authorUrl;
  throw new ReachRefusal("its author has no address to follow");
}

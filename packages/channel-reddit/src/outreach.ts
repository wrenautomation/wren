/**
 * Reddit as an `OutreachChannel`, over autobrowse's `reddit` site (the Data
 * API's shapes, answered by the signed-in page on the Mac's desk). One
 * adapter = one account: build it over `asAccount(sites, "reddit@alt")`.
 *
 * find: `r/<sub> words` reads that subreddit's search (or its newest posts
 * with no words); bare words read site-wide search. Prospects are the posts'
 * authors, one row each, `foundIn` = the subreddit. enrich: the user's card
 * plus their last posts and comments (one overview read; the card comes with many others' in one
 * read when `find` or `learn` showed their ids). message: a private message
 * (`/api/compose`, not chat). replies and comments: one read of the inbox per adapter, nothing
 * marked read; DMs are replies, comment answers and post replies are comments. comment: an answer
 * under a comment or a post. Reddit has no connect step, so `relationship`/`connect` are absent.
 */
import { SiteCallError } from "@wren/core/content";
import {
  type AccountHealth,
  type CommentIn,
  type FindQuery,
  type Found,
  HANDLE_RE,
  handleOf,
  type OutreachChannel,
  type Profile,
  type Reply,
  type Sent,
} from "@wren/core/outreach";
import {
  answerOf,
  commentRef,
  type Listing,
  REDDIT_SITE,
  redditUrl,
  type Thing,
} from "./content.js";
import { threadOf, threadQuery } from "./thread.js";

interface RedditOutreachOptions {
  account: string;
  /** The login's username, when known: replies skip our own words without a `/api/v1/me` read. */
  handle?: string | null;
  now?: () => Date;
  /**
   * Read people's cards (age, karma) in `enrich`. Off for a signed-out reader: Reddit answers
   * 403 for every card read signed out since 2026-10-13, and each refusal spends a desk read.
   */
  cards?: boolean;
}

interface UserAbout {
  id?: string;
  name?: string;
  created_utc?: number;
  link_karma?: number;
  comment_karma?: number;
  total_karma?: number;
  is_suspended?: boolean;
  accept_pms?: boolean;
  verified?: boolean;
}

interface Me extends UserAbout {
  has_verified_email?: boolean;
}

/** A `t4` (private message) or, with `was_comment`, a `t1` as the inbox lists it. */
interface Message {
  id: string;
  name: string;
  author?: string;
  type?: string;
  parent_id?: string;
  subreddit?: string;
  link_title?: string;
  dest?: string;
  subject?: string;
  body?: string;
  created_utc?: number;
  new?: boolean;
  was_comment?: boolean;
  context?: string;
  first_message_name?: string | null;
}

const AUTHOR_SKIP = new Set(["[deleted]", "AutoModerator"]);
/** Reddit's own notices land in the inbox as DMs from u/reddit; never a person. */
const INBOX_SKIP = new Set([...AUTHOR_SKIP, "reddit"]);
const INBOX_PAGE = 100;

/** `/r/x/comments/abc/title/def/?context=3` → `t3_abc`. */
export const postOf = (context: string | undefined) => {
  const m = /\/comments\/([a-z0-9]+)/i.exec(context ?? "");
  return m ? `t3_${m[1]}` : null;
};
const RECENT = 10;
/** Accounts whose cards one `user_data_by_account_ids` read returns. */
const CARDS_PER_READ = 100;
/** Ids remembered for a read-ahead; the oldest go first. */
const KNOWN_MAX = 1000;
const T2 = /^t2_[a-z0-9]+$/;

/** `r/startups hiring` → { sr: "startups", words: "hiring" }; `hiring` → { sr: null, words: "hiring" }. */
export function parseFindQuery(query: string): { sr: string | null; words: string } {
  const m = /^\s*(?:\/?r\/)([A-Za-z0-9_]{2,21})\b\s*(.*)$/.exec(query);
  if (m) return { sr: m[1] ?? null, words: (m[2] ?? "").trim() };
  return { sr: null, words: query.trim() };
}

const iso = (utc: number | undefined, now: () => Date) =>
  (utc ? new Date(utc * 1000) : now()).toISOString();
const items = <T>(l: Listing | undefined): T[] =>
  ((l?.data?.children ?? []) as unknown as Array<{ data: T }>).map((c) => c.data);
const after = (l: Listing | undefined): string | null =>
  ((l?.data as { after?: string | null } | undefined)?.after ?? null) || null;

/** The channel, plus a way to tell it whose ids a listing showed (see `learn`). */
type RedditOutreach = OutreachChannel & {
  /**
   * Who a listing's things came from (`author` and `author_fullname`). `enrich` then reads the
   * card of everyone remembered and not yet read in one read, instead of one `about` each.
   */
  learn(
    people: ReadonlyArray<{ handle?: string | null | undefined; id?: string | null | undefined }>,
  ): void;
};

/** Reddit answered 403: an endpoint closed to this reader, not a bad request or a spent cap. */
const closed = (err: unknown) =>
  err instanceof SiteCallError && (err.status === 403 || /HTTP 403/.test(err.message));

export function redditOutreach(
  sites: import("@wren/core/content").SiteClient,
  o: RedditOutreachOptions,
): RedditOutreach {
  const now = o.now ?? (() => new Date());
  const call = <T>(
    method: "GET" | "POST",
    path: string,
    input: Record<string, unknown> = {},
  ): Promise<T> => sites.call<T>(REDDIT_SITE, method, path, input);
  const via = (method: "GET" | "POST", path: string) =>
    sites.via(REDDIT_SITE, method, path).then((v) => (v === "browser" ? "browser" : "api"));
  let me: Promise<Me> | null = null;
  const whoami = () => {
    me ??= call<Me>("GET", "/api/v1/me").catch((err) => {
      me = null;
      throw err;
    });
    return me;
  };
  let inbox: Promise<Message[]> | null = null;
  const readInbox = () => {
    inbox ??= call<Listing>("GET", "/message/inbox", { limit: INBOX_PAGE, raw_json: 1 }).then(
      (l) => items<Message>(l).filter((m) => m.author && !INBOX_SKIP.has(m.author)),
      (err) => {
        inbox = null;
        throw err;
      },
    );
    return inbox;
  };
  const thread = async (post: string, focus?: string | null) =>
    threadOf(
      post,
      await call<[Listing, Listing]>(
        "GET",
        `/comments/${post.replace(/^t3_/, "")}`,
        threadQuery(focus),
      ),
      now,
    );
  const user = (handle: string) => {
    const h = handleOf("reddit", handle);
    if (!HANDLE_RE.reddit.test(h)) throw new Error(`reddit: not a username: ${handle}`);
    return h;
  };

  // Cards. A card is read once per run: kept here. Ids a listing showed wait in `ids`, and the
  // first card asked for takes up to 100 of them along in one read.
  const ids = new Map<string, string>();
  const cards = new Map<string, UserAbout>();
  // An endpoint Reddit closed to this reader is asked once per run, not once per person.
  let batchClosed = false;
  let aboutClosed = false;
  const learn: RedditOutreach["learn"] = (people) => {
    for (const p of people) {
      const k = p.handle?.toLowerCase();
      if (!k || AUTHOR_SKIP.has(p.handle as string) || !p.id || !T2.test(p.id)) continue;
      if (ids.has(k) || cards.has(k)) continue;
      ids.set(k, p.id);
      if (ids.size > KNOWN_MAX) ids.delete(ids.keys().next().value as string);
    }
  };
  const cardOf = async (h: string): Promise<UserAbout | null> => {
    if (o.cards === false) return null;
    const k = h.toLowerCase();
    const kept = cards.get(k);
    if (kept) return kept;
    const id = ids.get(k);
    if (id && !batchClosed) {
      const batch = [...ids].filter(([name]) => name !== k && !cards.has(name));
      const asked = [[k, id] as const, ...batch].slice(0, CARDS_PER_READ);
      try {
        const got = await call<Record<string, UserAbout>>("GET", "/api/user_data_by_account_ids", {
          ids: asked.map(([, tid]) => tid).join(","),
          raw_json: 1,
        });
        for (const [name, tid] of asked) {
          ids.delete(name);
          const c = got?.[tid];
          if (c) cards.set(name, { ...c, id: tid.slice(3) });
        }
      } catch (err) {
        if (err instanceof SiteCallError && err.status === 429) throw err;
        batchClosed = true;
      }
      const hit = cards.get(k);
      if (hit) return hit;
    }
    if (aboutClosed) return null;
    try {
      const about = await call<{ data?: UserAbout } | UserAbout>("GET", `/user/${h}/about`, {
        raw_json: 1,
      });
      const card = ("data" in about && about.data ? about.data : about) as UserAbout;
      cards.set(k, card);
      return card;
    } catch (err) {
      // Signed out, Reddit answers 403 for a user's card (no feed twin): the person is read
      // without it, and the card is not asked for again this run.
      if (!closed(err)) throw err;
      aboutClosed = true;
      return null;
    }
  };

  return {
    platform: "reddit",
    account: o.account,
    learn,

    async find(q: FindQuery): Promise<Found> {
      const { sr, words } = parseFindQuery(q.query);
      const limit = Math.min(Math.max(q.limit, 1), 100);
      const page: Record<string, unknown> = { limit, raw_json: 1 };
      if (q.cursor) page.after = q.cursor;
      let listing: Listing;
      let path: string;
      if (sr && words) {
        path = "/r/{subreddit}/search";
        listing = await call<Listing>("GET", `/r/${sr}/search`, {
          ...page,
          q: words,
          restrict_sr: 1,
          sort: "new",
        });
      } else if (sr) {
        path = "/r/{subreddit}/new";
        listing = await call<Listing>("GET", `/r/${sr}/new`, page);
      } else {
        path = "/search";
        listing = await call<Listing>("GET", "/search", { ...page, q: words, sort: "new" });
      }
      const seen = new Set<string>();
      const things = items<Thing & { subreddit?: string; author_flair_text?: string | null }>(
        listing,
      );
      learn(things.map((t) => ({ handle: t.author, id: t.author_fullname })));
      const prospects = things.flatMap((t) => {
        const a = t.author;
        if (!a || AUTHOR_SKIP.has(a) || seen.has(a)) return [];
        seen.add(a);
        return [
          {
            handle: a,
            url: `https://www.reddit.com/user/${a}`,
            name: null,
            headline: t.author_flair_text ?? null,
            foundIn: `r/${t.subreddit ?? sr ?? "all"}`,
          },
        ];
      });
      return { prospects, cursor: after(listing), fetchedWith: await via("GET", path) };
    },

    async enrich(handle: string): Promise<Profile> {
      const h = user(handle);
      // One overview read lists their posts and comments together; the card comes from the kept
      // batch when their id is known.
      const [card, overview] = await Promise.all([
        cardOf(h),
        call<Listing>("GET", `/user/${h}/overview`, {
          limit: RECENT * 2,
          sort: "new",
          raw_json: 1,
        }),
      ]);
      const things = (overview?.data?.children ?? []) as Array<{
        kind: string;
        data: Thing & { subreddit?: string; link_title?: string };
      }>;
      const recent = things
        .map(({ kind, data: t }) =>
          kind === "t1"
            ? {
                at: iso(t.created_utc, now),
                where: `r/${t.subreddit ?? "?"} · ${t.link_title ?? "comment"}`,
                text: (t.body ?? "").slice(0, 1000),
                url: t.permalink ? redditUrl(t.permalink) : null,
              }
            : {
                at: iso(t.created_utc, now),
                where: `r/${t.subreddit ?? "?"}`,
                text: [t.title, t.selftext].filter(Boolean).join("\n").slice(0, 1000),
                url: t.permalink ? redditUrl(t.permalink) : null,
              },
        )
        .sort((a, b) => b.at.localeCompare(a.at));
      return {
        handle: card?.name ?? h,
        url: `https://www.reddit.com/user/${card?.name ?? h}`,
        name: null,
        headline: null,
        foundIn: "enrich",
        about: null,
        current: null,
        company: null,
        location: null,
        recent,
        raw: { about: card },
        fetchedAt: now().toISOString(),
        fetchedWith: await via("GET", "/user/{username}/overview"),
      };
    },

    async message(handle, text, subject): Promise<Sent> {
      const to = user(handle);
      const a = await call<Parameters<typeof answerOf>[1]>("POST", "/api/compose", {
        api_type: "json",
        to,
        subject: (subject ?? "").trim() || "hi",
        text,
      });
      answerOf("/api/compose", a);
      return { ref: null, at: now().toISOString(), fetchedWith: await via("POST", "/api/compose") };
    },

    async replies(since): Promise<Reply[]> {
      const self = o.handle ?? (await whoami()).name ?? null;
      const floor = since?.toISOString() ?? "";
      return (await readInbox())
        .filter((m) => !m.was_comment && m.author !== self)
        .map((m) => ({
          ref: m.name,
          handle: m.author as string,
          name: null,
          text: [m.subject, m.body].filter(Boolean).join("\n"),
          at: iso(m.created_utc, now),
          threadUrl: `https://www.reddit.com/message/messages/${m.first_message_name ? m.first_message_name.replace(/^t4_/, "") : m.id}`,
        }))
        .filter((r) => r.at > floor);
    },

    async comments(): Promise<CommentIn[]> {
      return (await readInbox()).flatMap((m) => {
        const post = postOf(m.context);
        if (!m.was_comment || !post) return [];
        // The inbox leaves `type` out (autobrowse's listing, 2026-10-20), so the parent says what
        // it answers. A reply under one of our posts is the content side's row: it reads the
        // post's own thread (`redditContent().comments`), so this writes the same row and the
        // unique (platform, ref) keeps one.
        const onPost = !m.parent_id || m.parent_id.startsWith("t3_");
        return [
          {
            ref: commentRef(m.name),
            post,
            parent: onPost ? post : (m.parent_id as string),
            kind: onPost ? "post_reply" : (m.type ?? "comment_reply"),
            channel: onPost ? ("content" as const) : ("reach" as const),
            place: m.subreddit ?? null,
            postTitle: m.link_title ?? null,
            handle: m.author as string,
            text: m.body ?? "",
            url: redditUrl(m.context ?? `/comments/${post.slice(3)}`),
            at: iso(m.created_utc, now),
            raw: m as unknown as Record<string, unknown>,
          },
        ];
      });
    },

    async comment(parent, text): Promise<Sent> {
      const made = answerOf<{ things?: Array<{ data?: { name?: string } }> }>(
        "/api/comment",
        await call("POST", "/api/comment", { api_type: "json", thing_id: parent, text }),
      );
      return {
        ref: made.things?.[0]?.data?.name ?? null,
        at: now().toISOString(),
        fetchedWith: await via("POST", "/api/comment"),
      };
    },

    // The whole conversation, any depth: the send guard sees a reply's author three levels in.
    async threadAuthors(post): Promise<string[]> {
      const read = await thread(post);
      return [...new Set([read.post.handle ?? "", ...read.nodes.map((n) => n.handle)])].filter(
        (h) => h && !AUTHOR_SKIP.has(h),
      );
    },

    thread: (post, focus) => thread(post, focus),

    async commentCounts(posts): Promise<Record<string, number>> {
      const ids = [...new Set(posts.map((p) => `t3_${p.replace(/^t3_/, "")}`))];
      const out: Record<string, number> = {};
      // `/api/info` takes 100 fullnames a read.
      for (let i = 0; i < ids.length; i += 100) {
        const l = await call<Listing>("GET", "/api/info", { id: ids.slice(i, i + 100).join(",") });
        for (const t of items<Thing>(l))
          if (typeof t.num_comments === "number") out[t.name] = t.num_comments;
      }
      return out;
    },

    async health(): Promise<AccountHealth> {
      const m = await whoami();
      return {
        handle: m.name ?? o.account,
        createdAt: m.created_utc ? iso(m.created_utc, now) : null,
        karma: m.total_karma ?? (m.link_karma ?? 0) + (m.comment_karma ?? 0),
        suspended: Boolean(m.is_suspended),
        acceptsMessages: m.accept_pms ?? null,
        raw: m as unknown as Record<string, unknown>,
        asOf: now().toISOString(),
      };
    },
  };
}

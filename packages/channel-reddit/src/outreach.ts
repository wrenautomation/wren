/**
 * Reddit as an `OutreachChannel`, over autobrowse's `reddit` site (the Data
 * API's shapes, answered by the signed-in page on the Mac's desk). One
 * adapter = one account: build it over `asAccount(sites, "reddit@alt")`.
 *
 * find: `r/<sub> words` reads that subreddit's search (or its newest posts
 * with no words); bare words read site-wide search. Prospects are the posts'
 * authors, one row each, `foundIn` = the subreddit. enrich: the user's card
 * plus their last posts and comments. message: a private message
 * (`/api/compose`, not chat). replies and comments: one read of the inbox per adapter, nothing
 * marked read; DMs are replies, comment answers and post replies are comments. comment: an answer
 * under a comment or a post. Reddit has no connect step, so `relationship`/`connect` are absent.
 */
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
import { answerOf, type Listing, REDDIT_SITE, redditUrl, type Thing } from "./content.js";

export interface RedditOutreachOptions {
  account: string;
  now?: () => Date;
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

export function redditOutreach(
  sites: import("@wren/core/content").SiteClient,
  o: RedditOutreachOptions,
): OutreachChannel {
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
  const user = (handle: string) => {
    const h = handleOf("reddit", handle);
    if (!HANDLE_RE.reddit.test(h)) throw new Error(`reddit: not a username: ${handle}`);
    return h;
  };

  return {
    platform: "reddit",
    account: o.account,

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
      const prospects = items<Thing & { subreddit?: string; author_flair_text?: string | null }>(
        listing,
      ).flatMap((t) => {
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
      const [about, posts, comments] = await Promise.all([
        call<{ data?: UserAbout } | UserAbout>("GET", `/user/${h}/about`, { raw_json: 1 }),
        call<Listing>("GET", `/user/${h}/submitted`, { limit: RECENT, sort: "new", raw_json: 1 }),
        call<Listing>("GET", `/user/${h}/comments`, { limit: RECENT, sort: "new", raw_json: 1 }),
      ]);
      const card = ("data" in about && about.data ? about.data : about) as UserAbout;
      const recent = [
        ...items<Thing & { subreddit?: string }>(posts).map((t) => ({
          at: iso(t.created_utc, now),
          where: `r/${t.subreddit ?? "?"}`,
          text: [t.title, t.selftext].filter(Boolean).join("\n").slice(0, 1000),
          url: t.permalink ? redditUrl(t.permalink) : null,
        })),
        ...items<Thing & { subreddit?: string; link_title?: string }>(comments).map((t) => ({
          at: iso(t.created_utc, now),
          where: `r/${t.subreddit ?? "?"} · ${t.link_title ?? "comment"}`,
          text: (t.body ?? "").slice(0, 1000),
          url: t.permalink ? redditUrl(t.permalink) : null,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return {
        handle: card.name ?? h,
        url: `https://www.reddit.com/user/${card.name ?? h}`,
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
        fetchedWith: await via("GET", "/user/{username}/about"),
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
      const self = (await whoami()).name ?? null;
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
        return [
          {
            ref: m.name,
            post,
            parent: m.parent_id ?? post,
            kind: m.type ?? "comment_reply",
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

    async threadAuthors(post): Promise<string[]> {
      const [head, tree] = await call<[Listing, Listing]>(
        "GET",
        `/comments/${post.replace(/^t3_/, "")}`,
        {
          raw_json: 1,
          limit: 500,
        },
      );
      const out = items<Thing>(head).map((t) => t.author ?? "");
      const walk = (l: Listing | undefined) => {
        for (const c of items<Thing & { replies?: Listing | "" }>(l)) {
          if (c.author) out.push(c.author);
          if (c.replies) walk(c.replies);
        }
      };
      walk(tree);
      return [...new Set(out.filter(Boolean))];
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

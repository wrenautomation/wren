/**
 * A person's saves into Canon (designs/2026-11-12-eden-method.md §2). Readers turn each route's
 * answer into `Saved` items; `keepSaved` writes them; `wren capture file` files the unfiled ones.
 * A save is the person's own source: `provider: {kind: human}`, no note (they wrote none).
 */
import { resolveObjects } from "@wren/core/objects";
import { atomic, type Db } from "@wren/db";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { type Capture, type CaptureSource, captures as t } from "./captures-schema.js";
import type { Source } from "./sops/index.js";

export { CAPTURE_SOURCES, type Capture, type CaptureSource } from "./captures-schema.js";

/** failed files before a row waits for a person */
export const MAX_ATTEMPTS = 3;

export type SavedPlatform = "instagram" | "x" | "youtube" | "linkedin";

export interface Saved {
  platform: SavedPlatform;
  /** the platform's id as the reader holds it: IG shortcode, tweet id, video id, LinkedIn URN */
  ref: string;
  url: string;
  author: string | null;
  at: Date | null;
  lists: string[];
  raw: unknown;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- Instagram: GET /web/saved → { collections?, media } -----------------------------------------

/** IG saved: a reel (`clips`) links `/reel/`, the rest `/p/`; collection ids become their names. */
export function instagramSaved(answer: unknown): Saved[] {
  const a = obj(answer);
  const names = new Map<string, string>();
  for (const c of Array.isArray(a.collections) ? a.collections : []) {
    const id = str(obj(c).collection_id) ?? str(obj(c).id);
    const name = str(obj(c).collection_name) ?? str(obj(c).name);
    if (id && name) names.set(id, name);
  }
  const media = Array.isArray(a.media) ? a.media : [];
  return media.flatMap((m): Saved[] => {
    const o = obj(m);
    const code = str(o.code);
    if (!code) return [];
    const reel = o.product_type === "clips";
    const taken = num(o.taken_at);
    const ids = Array.isArray(o.saved_collection_ids) ? o.saved_collection_ids.map(String) : [];
    return [
      {
        platform: "instagram",
        ref: code,
        url: `https://www.instagram.com/${reel ? "reel" : "p"}/${code}/`,
        author: str(obj(o.user).username),
        at: taken ? new Date(taken * 1000) : null,
        lists: ids.flatMap((id) => names.get(id) ?? []),
        raw: m,
      },
    ];
  });
}

// ---- X: GET /web/bookmarks → { items: tweet_results.result[] } ----------------------------------

/** A tweet result, unwrapped from X's visibility wrapper. */
const tweetOf = (item: unknown): Obj => {
  const r = obj(item);
  return r.__typename === "TweetWithVisibilityResults" ? obj(r.tweet) : r;
};
const handleOf = (t: Obj) => {
  const u = obj(obj(obj(t.core).user_results).result);
  return str(obj(u.core).screen_name) ?? str(obj(u.legacy).screen_name);
};

export function xBookmarks(answer: unknown): Saved[] {
  const items = obj(answer).items;
  return (Array.isArray(items) ? items : []).flatMap((item): Saved[] => {
    const t = tweetOf(item);
    const id = str(t.rest_id);
    if (!id) return [];
    const handle = handleOf(t);
    const made = str(obj(t.legacy).created_at);
    return [
      {
        platform: "x",
        ref: id,
        url: `https://x.com/${handle ?? "i"}/status/${id}`,
        author: handle,
        at: made ? new Date(made) : null,
        lists: [],
        raw: item,
      },
    ];
  });
}

/** Whether a tweet carries a video: yt-dlp reads it (watch and breakdown); else we write it. */
export function xHasVideo(raw: unknown): boolean {
  const media = obj(obj(tweetOf(raw).legacy).extended_entities).media;
  return (
    Array.isArray(media) &&
    media.some((m) => ["video", "animated_gif"].includes(String(obj(m).type)))
  );
}

/** A tweet's full text, its links opened (t.co → the real URL). */
function tweetText(t: Obj): string {
  const legacy = obj(t.legacy);
  const note = str(obj(obj(obj(t.note_tweet).note_tweet_results).result).text);
  let text = note ?? str(legacy.full_text) ?? "";
  for (const u of (obj(legacy.entities).urls as unknown[] | undefined) ?? []) {
    const short = str(obj(u).url);
    const long = str(obj(u).expanded_url);
    if (short && long) text = text.split(short).join(long);
  }
  // a media link at the end is the picture itself, listed below
  for (const m of (obj(legacy.entities).media as unknown[] | undefined) ?? []) {
    const short = str(obj(m).url);
    if (short) text = text.split(short).join("");
  }
  return text.trim();
}

const counts = (legacy: Obj, views: string | null) =>
  [
    views ? `${Number(views).toLocaleString("en-US")} views` : null,
    num(legacy.favorite_count) !== null
      ? `${num(legacy.favorite_count)?.toLocaleString("en-US")} likes`
      : null,
    num(legacy.retweet_count) !== null
      ? `${num(legacy.retweet_count)?.toLocaleString("en-US")} reposts`
      : null,
    num(legacy.reply_count) !== null
      ? `${num(legacy.reply_count)?.toLocaleString("en-US")} replies`
      : null,
    num(legacy.bookmark_count) !== null
      ? `${num(legacy.bookmark_count)?.toLocaleString("en-US")} bookmarks`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

const frontMatter = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n`;

/** A saved tweet as a Canon source, from the item alone: text, article, quote, pictures, counts. */
export function xSource(raw: unknown, url: string, day: string): Source {
  const t = tweetOf(raw);
  const id = str(t.rest_id) ?? "";
  const legacy = obj(t.legacy);
  const handle = handleOf(t);
  const text = tweetText(t);
  const article = obj(obj(obj(t.article).article_results).result);
  const articleTitle = str(article.title);
  const quote = tweetOf(obj(obj(t.quoted_status_result).result));
  const pictures = ((obj(legacy.extended_entities).media as unknown[] | undefined) ?? [])
    .filter((m) => obj(m).type === "photo")
    .flatMap((m) => str(obj(m).media_url_https) ?? []);
  const firstLine = (articleTitle ?? text.split("\n").find((l) => l.trim()) ?? "").trim();
  const title = `${handle ? `@${handle}: ` : ""}${firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine || `post ${id}`}`;
  const parts = [
    text,
    articleTitle
      ? `## Article: ${articleTitle}\n\n${str(article.preview_text) ?? ""}\n\nhttps://x.com/i/article/${str(article.rest_id) ?? ""}`
      : null,
    str(quote.rest_id)
      ? `## Quoting @${handleOf(quote) ?? "?"}\n\n${tweetText(quote)}\n\nhttps://x.com/${handleOf(quote) ?? "i"}/status/${str(quote.rest_id)}`
      : null,
    pictures.length ? `## Pictures\n\n${pictures.map((p) => `- ${p}`).join("\n")}` : null,
    `Saved on ${day}. Counts then: ${counts(legacy, str(obj(t.views).count)) || "none shown"}.`,
  ].filter((p): p is string => !!p?.trim());
  return {
    name: `x-${id}.md`,
    md: `${frontMatter({ url, title, ...(handle ? { channel: handle } : {}) })}# ${title}\n\n${parts.join("\n\n")}\n`,
  };
}

// ---- YouTube: videos?myRating=like, playlistItems --------------------------------------------------

/** Liked videos (`videos` items, `id` is the video) or a playlist's items (`resourceId`). */
export function youtubeVideos(answer: unknown, list: string | null): Saved[] {
  const items = obj(answer).items;
  return (Array.isArray(items) ? items : []).flatMap((item): Saved[] => {
    const o = obj(item);
    const snippet = obj(o.snippet);
    const id =
      o.kind === "youtube#playlistItem"
        ? str(obj(snippet.resourceId).videoId)
        : typeof o.id === "string"
          ? o.id
          : null;
    if (!id) return [];
    const at = str(snippet.publishedAt);
    return [
      {
        platform: "youtube",
        ref: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        author: str(snippet.videoOwnerChannelTitle) ?? str(snippet.channelTitle),
        at: at && o.kind !== "youtube#playlistItem" ? new Date(at) : null,
        lists: list ? [list] : [],
        raw: item,
      },
    ];
  });
}

// ---- LinkedIn: GET /web/saved → { posts } (autobrowse linkedin/saved) -----------------------------

export function linkedinSaved(answer: unknown): Saved[] {
  const posts = obj(answer).posts;
  return (Array.isArray(posts) ? posts : []).flatMap((p): Saved[] => {
    const o = obj(p);
    const urn = str(o.urn);
    if (!urn) return [];
    const at = str(o.at);
    return [
      {
        platform: "linkedin",
        ref: urn,
        url: str(o.url) ?? `https://www.linkedin.com/feed/update/${urn}/`,
        author: str(obj(o.author).name),
        at: at ? new Date(at) : null,
        lists: [],
        raw: p,
      },
    ];
  });
}

/** A saved LinkedIn post as a Canon source, from the item alone (the page shows no counts). */
export function linkedinSource(raw: unknown, url: string, day: string): Source {
  const o = obj(raw);
  const urn = str(o.urn) ?? "";
  const id = /(\d+)$/.exec(urn)?.[1] ?? urn.replace(/\W+/g, "-");
  const author = obj(o.author);
  const name = str(author.name);
  const text = str(o.text) ?? "";
  const firstLine = (text.split("\n").find((l) => l.trim()) ?? "").trim();
  const title = `${name ? `${name}: ` : ""}${firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine || `post ${id}`}`;
  const images = Array.isArray(o.images) ? o.images.flatMap((i) => str(i) ?? []) : [];
  const parts = [
    [name, str(author.headline), str(author.url)].filter(Boolean).join(" · "),
    text,
    images.length ? `## Pictures\n\n${images.map((p) => `- ${p}`).join("\n")}` : null,
    `Saved on ${day}${str(o.age) ? `; posted ${str(o.age)} before` : ""}.`,
  ].filter((p): p is string => !!p?.trim());
  return {
    name: `linkedin-${id}.md`,
    md: `${frontMatter({ url, title, ...(name ? { channel: name } : {}) })}# ${title}\n\n${parts.join("\n\n")}\n`,
  };
}

// ---- The table ---------------------------------------------------------------------------------

/** the old row's array and the new one's, as a set */
const union = (col: "lists" | "sources") =>
  sql.raw(
    `(select coalesce(array_agg(distinct x order by x), '{}') from unnest(captures.${col} || excluded.${col}) x)`,
  );

/** Keep each item: new rows, or the old row's lists and sources widened. Answers how many were new. */
export async function keepSaved(
  db: Db,
  person: string,
  source: CaptureSource,
  items: readonly Saved[],
): Promise<{ read: number; added: number }> {
  if (!items.length) return { read: 0, added: 0 };
  return atomic(db, async (tx) => {
    const refs = await resolveObjects(
      tx,
      items.map((s) => ({
        platform: s.platform,
        kind: "post" as const,
        raw: s.ref,
        url: s.url,
        author: s.author,
        at: s.at,
      })),
    );
    // one row per object; one video in two playlists: both lists
    const rows = new Map<string, typeof t.$inferInsert>();
    for (const s of items) {
      const ref = refs.get(s.ref) as string;
      const key = `${s.platform}:${ref}`;
      const lists = [...new Set([...(rows.get(key)?.lists ?? []), ...s.lists])];
      rows.set(key, {
        platform: s.platform,
        ref,
        person,
        sources: [source],
        url: s.url,
        author: s.author?.slice(0, 200) ?? null,
        lists,
        raw: s.raw,
      });
    }
    const out = await tx
      .insert(t)
      .values([...rows.values()])
      .onConflictDoUpdate({
        target: [t.platform, t.ref, t.person],
        set: {
          lastSeen: sql`now()`,
          raw: sql`excluded.raw`,
          lists: union("lists"),
          sources: union("sources"),
        },
      })
      .returning({ fresh: sql<boolean>`xmax = 0` });
    return { read: items.length, added: out.filter((r) => r.fresh).length };
  });
}

/** Rows to file, oldest seen first, under the retry limit. */
export function unfiled(db: Db, person: string, source: CaptureSource, limit: number) {
  return db
    .select()
    .from(t)
    .where(
      and(
        eq(t.person, person),
        isNull(t.filedAt),
        lt(t.attempts, MAX_ATTEMPTS),
        sql`${source} = any(${t.sources})`,
      ),
    )
    .orderBy(asc(t.firstSeen), asc(t.id))
    .limit(limit);
}

export async function markFiled(db: Db, id: number, records: string[]) {
  await db.update(t).set({ filedAt: sql`now()`, records, error: null }).where(eq(t.id, id));
}

export async function markFailed(db: Db, id: number, error: string) {
  await db
    .update(t)
    .set({ attempts: sql`${t.attempts} + 1`, error: error.slice(0, 2000) })
    .where(eq(t.id, id));
}

/** Per source: read, filed, waiting, failed (at the retry limit). */
export async function captureCounts(db: Db, person: string) {
  const rows = await db.execute<{
    source: string;
    read: number;
    filed: number;
    waiting: number;
    failed: number;
  }>(sql`select s as source, count(*)::int as read,
      count(*) filter (where filed_at is not null)::int as filed,
      count(*) filter (where filed_at is null and attempts < ${MAX_ATTEMPTS})::int as waiting,
      count(*) filter (where filed_at is null and attempts >= ${MAX_ATTEMPTS})::int as failed
    from captures, unnest(sources) s where person = ${person} group by s order by s`);
  return [...rows];
}

export type { Capture as CaptureRow };

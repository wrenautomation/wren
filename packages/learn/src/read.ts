/**
 * Reading: an item's words, kept as its transcript. An article is read on the worker, from its
 * feed text when that's the whole post, else from its page. A YouTube video is read on the
 * worker too when it has a video reader (Gemini through the gateway, by URL). Any other video or
 * reel, and a YouTube read that failed, needs yt-dlp and a home IP, so it waits for the Mac's
 * reader (`wren learn read`), which reads it with the `sop add` readers and scores it there. A
 * client's video is read on that client's own `models` allowance: gated before, metered after.
 */
import { WREN } from "@wren/core/access";
import type { Step } from "@wren/core/spine";
import { gate, meter } from "@wren/core/vendors";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { FetchFn } from "./feeds.js";
import { decode, ogImageOf, plain, secondsOf } from "./feeds.js";
import { needsMac, youtubeId } from "./links.js";
import { type ItemKind, items } from "./schema.js";
import { itemIdOf } from "./score.js";

/** Feed text this long is the whole post: no page fetch. */
const WHOLE_POST = 1_500;
/** Text kept from a page. */
const KEEP_PAGE = 60_000;

/** What a page says: its title, author and main text, paragraphs kept. */
export function pageText(html: string): {
  title: string;
  creator: string | null;
  text: string;
  image: string | null;
} {
  const meta = (name: string) => {
    for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
      const a = m[1] ?? "";
      const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(a)?.[1];
      if (key?.toLowerCase() !== name) continue;
      const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(a)?.[1];
      if (content) return decode(content).trim();
    }
    return "";
  };
  const titleTag = plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const title = meta("og:title") || titleTag;
  const creator = meta("author") || meta("article:author") || null;
  const body =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ??
    html;
  const text = body
    .replace(/<(script|style|nav|header|footer|aside|form|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n, h) => `\n\n${"#".repeat(Number(n))} ${plain(h)}\n\n`,
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|li|blockquote|pre|tr)>|<br\s*\/?>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  const paras = decode(text)
    .split(/\n{2,}/)
    .map((p) =>
      p
        .replace(/[ \t\r\f\v]+/g, " ")
        .replace(/ *\n */g, "\n")
        .trim(),
    )
    .filter(Boolean);
  const description = meta("og:description") || meta("description");
  const out = paras.join("\n\n") || description;
  return { title, creator, text: out.slice(0, KEEP_PAGE), image: ogImageOf(html) };
}

const yaml = (fields: Record<string, string | number | null | undefined>) =>
  `---\n${Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
    .join("\n")}\n---\n\n`;

/** The file an item becomes under an SOP's `sources/`: the `sop add` name for a video, else host and path. */
export function fileOf(url: string): string {
  const u = new URL(url);
  const yt = youtubeId(u);
  if (yt) return `youtube-${yt}.md`;
  const slug = `${u.hostname}${u.pathname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `web-${slug || "page"}.md`;
}

/** An article's transcript: front matter as `sop add` writes it, then its text. */
export function articleMd(p: {
  url: string;
  title: string;
  creator: string | null;
  publishedAt: Date | null;
  text: string;
}): string {
  return `${yaml({
    source: `web:${new URL(p.url).hostname}`,
    title: p.title,
    url: p.url,
    channel: p.creator,
    uploaded: p.publishedAt?.toISOString().slice(0, 10),
    priority: 5,
  })}# ${p.title}\n\n${p.text}\n`;
}

/** A transcript's front matter field, as the readers write it. */
export function frontField(md: string, key: string): string | null {
  const head = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
  const raw = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(head)?.[1]?.trim();
  if (!raw) return null;
  try {
    return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  } catch {
    return raw;
  }
}

export type ReadResult = "read" | "mac" | "failed" | null;

/**
 * Read one item on the worker. A video or reel is marked for the Mac; an article keeps its feed
 * text when that's the whole post, else its page is fetched. Null for no such item or one read.
 */
export async function readItem(
  db: Db,
  fetchFn: FetchFn,
  id: number,
  video: VideoReader | null = null,
): Promise<ReadResult> {
  const [item] = await db.select().from(items).where(eq(items.id, id));
  if (!item) return null;
  if (item.readAt) return "read";
  if (needsMac(item.kind, item.mediaUrl)) {
    if (video && youtubeOf(item.url)) {
      const r = await readVideo(db, video, id);
      if (r === "read") return "read";
      // The Mac reads it from the captions: the worker's failure isn't the item's.
      if (r === "failed") await db.update(items).set({ readFailure: null }).where(eq(items.id, id));
    }
    if (!item.needsMac)
      await db.update(items).set({ needsMac: new Date() }).where(eq(items.id, id));
    return "mac";
  }
  let { title, creator, text, thumbnailUrl } = item;
  // A creator's post is whole as its site gave it; the page is a login wall.
  const social = item.type === "instagram" || item.type === "x" || item.type === "tiktok";
  if (text.length < WHOLE_POST && !social) {
    try {
      const res = await fetchFn(item.url, {
        headers: { "user-agent": "wren-learn/1.0 (+https://wrenautomation.com)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = pageText(await res.text());
      if (page.text.length > text.length) text = page.text;
      if (page.title && (title === item.url || title === "(untitled)")) title = page.title;
      creator ??= page.creator;
      thumbnailUrl ??= page.image;
    } catch (err) {
      // A feed item with some text still reads; a bare saved link fails until a retry.
      if (!text) {
        const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        await db.update(items).set({ readFailure: error }).where(eq(items.id, id));
        return "failed";
      }
    }
  }
  const md = articleMd({ url: item.url, title, creator, publishedAt: item.publishedAt, text });
  await db
    .update(items)
    .set({
      ...pgSafe({ title, creator, text, transcript: md }),
      thumbnailUrl,
      file: fileOf(item.url),
      readAt: new Date(),
      readFailure: null,
    })
    .where(and(eq(items.id, id), isNull(items.readAt)));
  return "read";
}

/** `learn.read` on the spine: a read item leaves by `read`; one for the Mac stops here. */
export const readStep =
  (db: Db, fetchFn: FetchFn, video: VideoReader | null = null): Step =>
  async (_port, e) =>
    (await readItem(db, fetchFn, itemIdOf(e), video)) === "read"
      ? [{ port: "read", event: e }]
      : [];

/** A video or audio reader: a transcript as markdown and its SOP source file name. */
export type VideoReader = (item: {
  url: string;
  kind: ItemKind;
  title: string;
  creator: string | null;
  /** Seconds, when the feed said. */
  duration: number | null;
  /** An episode's audio file. */
  mediaUrl: string | null;
}) => Promise<{ file: string; md: string }>;

const youtubeOf = (raw: string): string | null => {
  try {
    return youtubeId(new URL(raw));
  } catch {
    return null;
  }
};

/**
 * Items waiting for the Mac, saved ones first, newest first, in every workspace or `client`'s
 * alone. `retry` takes failed ones too.
 */
export async function waitingForMac(
  db: Db,
  opts: { limit?: number; retry?: boolean; client?: string | null } = {},
) {
  return db
    .select({
      id: items.id,
      client: items.client,
      url: items.url,
      kind: items.kind,
      title: items.title,
    })
    .from(items)
    .where(
      and(
        opts.client ? eq(items.client, opts.client) : undefined,
        isNull(items.readAt),
        isNotNull(items.needsMac),
        isNull(items.archivedAt),
        opts.retry ? undefined : isNull(items.readFailure),
      ),
    )
    .orderBy(sql`${items.savedAt} desc nulls last`, desc(items.createdAt), asc(items.id))
    .limit(opts.limit ?? 20);
}

/**
 * Read one video item with a reader (the Mac's, or the worker's for YouTube); its failure is
 * kept on the row. A client's item reads only while its `models` gate is open ("waits", and why
 * on the row, when shut), and each read is metered to it.
 */
export async function readVideo(
  db: Db,
  reader: VideoReader,
  id: number,
  now = new Date(),
): Promise<ReadResult | "waits"> {
  const [item] = await db.select().from(items).where(eq(items.id, id));
  if (!item) return null;
  if (item.readAt) return "read";
  const client = item.client === WREN ? null : item.client;
  if (client) {
    const g = await gate(db, client, "models", 1, now);
    if (!g.ok) {
      await db
        .update(items)
        .set({ readFailure: `Waits for models: ${g.why}`.slice(0, 500) })
        .where(eq(items.id, id));
      return "waits";
    }
  }
  try {
    const { file, md } = await reader(item);
    const title = frontField(md, "title");
    const creator = frontField(md, "channel");
    const duration = secondsOf(frontField(md, "duration") ?? "");
    const thumbnail = frontField(md, "thumbnail");
    const better = (t: string) => t === item.url || t === "(untitled)";
    await db
      .update(items)
      .set({
        ...pgSafe({
          transcript: md,
          ...(title && better(item.title) ? { title } : {}),
          ...(creator && !item.creator ? { creator } : {}),
        }),
        file,
        ...(duration && !item.duration ? { duration } : {}),
        ...(thumbnail?.startsWith("https://") && !item.thumbnailUrl
          ? { thumbnailUrl: thumbnail }
          : {}),
        readAt: new Date(),
        readFailure: null,
      })
      .where(eq(items.id, id));
    if (client)
      await meter(db, { client, vendor: "models", units: 1, part: "learn.read", at: now });
    return "read";
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db.update(items).set({ readFailure: error }).where(eq(items.id, id));
    return "failed";
  }
}

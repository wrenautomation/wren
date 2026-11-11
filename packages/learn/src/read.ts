/**
 * Reading: an item's words, kept as its transcript. An article is read on the worker, from its
 * feed text when that's the whole post, else from its page. A video or reel needs yt-dlp and a
 * home IP, so it waits for the Mac's reader (`wren learn read`), which reads it with the `sop add`
 * readers (frames read by Claude, speech by the ear) and scores it there. A
 * client's video is read on that client's own `models` allowance: gated before, metered after.
 */
import { WREN } from "@wren/core/access";
import { decodeHtml as decode } from "@wren/core/html";
import { gate, meter } from "@wren/core/vendors";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { sourceId } from "@wrenautomation/knowledge";
import { type Fetcher, PoliteFetcher } from "@wrenautomation/read/fetch";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { needsMac, youtubeId } from "./links.js";
import { type ItemKind, items } from "./schema.js";

/** An element's text as plain words: CDATA unwrapped, escaped HTML read, tags dropped. */
function plain(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const html = cdata ? (cdata[1] ?? "") : decode(raw);
  return decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const attr = (a: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(a)?.[1];

/** An https address, or null: the app loads nothing over http. */
const httpsOr = (url: string | undefined | null): string | null => {
  const u = url?.trim();
  if (!u) return null;
  if (u.startsWith("https://")) return u;
  return u.startsWith("http://") ? `https://${u.slice(7)}` : null;
};

/** A page's og:image, https only. */
function ogImageOf(html: string): string | null {
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = m[1] ?? "";
    const key = attr(a, "property") ?? attr(a, "name");
    if (key?.toLowerCase() !== "og:image") continue;
    const content = attr(a, "content");
    if (content) return httpsOr(decode(content));
  }
  return null;
}

/** Seconds from "90", "1:30" or "1:02:03"; null when it reads as none. */
export function secondsOf(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s)) || null;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) || null;
}

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

/** The file an item becomes: its knowledge source id (`sourceId`, one id per URL for every writer). */
export const fileOf = (url: string): string => `${sourceId(url)}.md`;

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

type ReadResult = "read" | "mac" | "failed" | null;

/**
 * The page reader for saved links: `@wrenautomation/read`'s door, under learn's own UA. One try: the walk reads
 * items one by one in a Lambda, and a failed read is tried again on a later pass.
 */
export const pageFetcher = (): Fetcher =>
  new PoliteFetcher("wren-learn/1.0 (+https://wrenautomation.com)", { timeout: 30, retries: 1 });

/**
 * Read one item on the worker. A video or reel is marked for the Mac; an article keeps its feed
 * text when that's the whole post, else its page is fetched. Null for no such item or one read.
 */
export async function readItem(
  db: Db,
  pages: Fetcher,
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
      const res = await pages.get(item.url);
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      const page = pageText(res.text);
      if (page.text.length > text.length) text = page.text;
      if (page.title && (title === item.url || title === "(untitled)")) title = page.title;
      creator ??= page.creator;
      thumbnailUrl ??= page.image;
    } catch (err) {
      // A feed item with some text still reads; a bare saved link fails until a retry.
      if (!text) {
        const error = (err instanceof Error ? err.message : String(err)).slice(0, 5000);
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

/** A video or audio reader: a transcript as markdown and its SOP source file name. */
export type VideoReader = (item: {
  url: string;
  kind: ItemKind;
  title: string;
  creator: string | null;
  /** Seconds, when the feed said. */
  duration: number | null;
  /** An episode's audio file; a reel's video file (signed, expires). */
  mediaUrl: string | null;
  /** What the feed said: a reel's whole caption. */
  text: string | null;
  publishedAt: Date | null;
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
        .set({ readFailure: `Waits for models: ${g.why}`.slice(0, 5000) })
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
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 5000);
    await db.update(items).set({ readFailure: error }).where(eq(items.id, id));
    return "failed";
  }
}

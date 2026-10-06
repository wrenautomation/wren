/**
 * The radar, in the Watch (designs/2026-10-05-end-goal.md, #2): the feeds Wren follows, each new
 * item scored 0-10 against how Wren works today (its pushed SOPs). The score sets the verdict, so
 * items land in the Inbox app's queue beside mail: 7 and up shows, 4 to 6 holds, the rest drops.
 * RSS and Atom only: Substack, YouTube channels, GitHub releases, Reddit, HN and most blogs publish
 * one. Items are kept before they're scored, so a pass that dies loses no reads.
 */
import type { SpineEvent, Step } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { feeds, items, type Verdict } from "./schema.js";

export interface FeedItem {
  url: string;
  title: string;
  text: string;
  publishedAt: Date | null;
}

export interface Feed {
  title: string;
  items: FeedItem[];
}

/** Text kept per item; the prompt reads the first `PROMPT_TEXT`. */
const KEEP_TEXT = 20_000;
const PROMPT_TEXT = 4_000;
/** A feed is read at most this often, whatever the Watch's pace. */
export const FEED_EVERY_MS = 60 * 60_000;
/** Failed reads of the model's answer before an item is left unscored. */
const MAX_TRIES = 3;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/** An element's text as plain words: CDATA unwrapped, escaped HTML read, tags dropped. */
function plain(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const html = cdata ? (cdata[1] ?? "") : decode(raw);
  return decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const tagRe = (tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
const first = (block: string, tags: readonly string[]): string => {
  for (const t of tags) {
    const m = tagRe(t).exec(block);
    if (m?.[1]?.trim()) return m[1];
  }
  return "";
};

/** Atom's alternate link (or its only one), else RSS's `<link>` text, else a permalink guid. */
function linkOf(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1] ?? "");
  const attr = (a: string, name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(a)?.[1];
  const alt = links.find((a) => attr(a, "href") && (attr(a, "rel") ?? "alternate") === "alternate");
  const href = alt ? attr(alt, "href") : undefined;
  if (href) return decode(href).trim();
  const text = plain(first(block, ["link"]));
  if (/^https?:\/\//.test(text)) return text;
  const guid = plain(first(block, ["guid", "id"]));
  return /^https?:\/\//.test(guid) ? guid : "";
}

function dateOf(block: string): Date | null {
  const s = plain(first(block, ["pubDate", "published", "dc:date", "updated"]));
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** An RSS or Atom document's items, in feed order; items with no link are dropped. */
export function parseFeed(xml: string): Feed {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (m) => m[2] ?? "",
  );
  const head = xml.split(/<(?:item|entry)\b/i)[0] ?? "";
  const found = blocks
    .map((b): FeedItem => {
      const texts = ["content:encoded", "content", "media:description", "description", "summary"]
        .map((t) => plain(first(b, [t])))
        .sort((x, y) => y.length - x.length);
      return {
        url: linkOf(b),
        title: plain(first(b, ["title"])) || "(untitled)",
        text: (texts[0] ?? "").slice(0, KEEP_TEXT),
        publishedAt: dateOf(b),
      };
    })
    .filter((i) => i.url);
  return { title: plain(first(head, ["title"])), items: found };
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchFeed(fetchFn: FetchFn, url: string): Promise<Feed> {
  const res = await fetchFn(url, {
    headers: {
      // Reddit refuses a bare client; say who reads.
      "user-agent": "wren-radar/1.0 (+https://wrenautomation.com)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const feed = parseFeed(await res.text());
  if (!feed.items.length && !feed.title) throw new Error(`${url}: not an RSS or Atom feed`);
  return feed;
}

/**
 * Follow a feed: read it once, so a bad URL fails here, not an hour later. Its current items are
 * kept as seen (dropped, unscored): following a feed scores what comes next, not its back catalog.
 */
export async function follow(
  db: Db,
  fetchFn: FetchFn,
  p: { url: string; name?: string | null; by?: string | null },
): Promise<{ id: number; name: string; items: number }> {
  const feed = await fetchFeed(fetchFn, p.url);
  const name = p.name?.trim() || feed.title || new URL(p.url).hostname;
  const [row] = await db
    .insert(feeds)
    .values({ url: p.url, name, by: p.by ?? null, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: feeds.url, set: { name, stoppedAt: null, failure: null } })
    .returning({ id: feeds.id });
  if (!row) throw new Error("insert returned no row");
  if (feed.items.length)
    await db
      .insert(items)
      .values(
        feed.items.map((i) => ({
          feedId: row.id,
          ...i,
          verdict: "drop" as const,
          why: "In the feed before you followed it.",
          scoredAt: new Date(),
        })),
      )
      .onConflictDoNothing({ target: items.url });
  return { id: row.id, name, items: feed.items.length };
}

export interface PullStats {
  /** New items, by id: each goes to scoring. */
  added: number[];
  failed: Array<{ feed: string; error: string }>;
}

/** Each followed feed due a read, its new items stored unscored. A failing feed keeps its error. */
export async function pullFeeds(db: Db, fetchFn: FetchFn, now: Date): Promise<PullStats> {
  const due = await db
    .select()
    .from(feeds)
    .where(
      and(
        isNull(feeds.stoppedAt),
        or(isNull(feeds.fetchedAt), lt(feeds.fetchedAt, new Date(now.getTime() - FEED_EVERY_MS))),
      ),
    )
    .orderBy(asc(feeds.id));
  const stats: PullStats = { added: [], failed: [] };
  for (const f of due) {
    try {
      const feed = await fetchFeed(fetchFn, f.url);
      if (feed.items.length) {
        const rows = await db
          .insert(items)
          .values(feed.items.map((i) => ({ feedId: f.id, ...i })))
          .onConflictDoNothing({ target: items.url })
          .returning({ id: items.id });
        stats.added.push(...rows.map((r) => r.id));
      }
      await db.update(feeds).set({ fetchedAt: now, failure: null }).where(eq(feeds.id, f.id));
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      stats.failed.push({ feed: f.name, error });
      await db.update(feeds).set({ failure: error }).where(eq(feeds.id, f.id));
    }
  }
  return stats;
}

/** One new feed item on the spine. */
export const itemEvent = (id: number): SpineEvent => ({
  subject: `item:${id}`,
  kind: "item",
  data: { itemId: id },
});

/** One SOP as the scorer sees it: its name, what it's for, its section headings. */
export interface Practice {
  name: string;
  about: string;
  headings: string[];
}

/** An SOP's text read down to a practice: its first paragraph and its `##` headings. */
export function practiceOf(name: string, sop: string): Practice {
  const lines = sop.split("\n").map((l) => l.trim());
  const about = lines.find((l) => l && !l.startsWith("#") && !l.startsWith("---")) ?? "";
  const headings = lines.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^#+\s*/, ""));
  return { name, about: about.slice(0, 300), headings: headings.slice(0, 12) };
}

export const scoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  summary: z.string().min(1),
  changes: z.array(z.string()).default([]),
  why: z.string().min(1),
});

/** 7 and up shows, 4 to 6 holds, the rest drops. */
export const verdictOf = (score: number): Verdict =>
  score >= 7 ? "show" : score >= 4 ? "hold" : "drop";

const SYSTEM = `You read the news for Wren, a small AI automation agency. Wren finds leads, writes cold email and DMs, builds landing pages, posts content and runs it all on browser automation and AI models. You judge one item at a time against how Wren works today. Most items change nothing; say so. Answer with JSON only.`;

export function scorePrompt(
  item: FeedItem & { feed: string },
  practices: readonly Practice[],
): string {
  const sops = practices
    .map(
      (p) =>
        `- ${p.name}: ${p.about}${p.headings.length ? ` Covers: ${p.headings.join("; ")}.` : ""}`,
    )
    .join("\n");
  return `How Wren works today, one SOP a line:
${sops || "- (no SOPs pushed yet)"}

Score how much this item should change what Wren does, 0 to 10:
0-3: nothing Wren can use, or news with no action in it.
4-6: worth knowing; no SOP changes.
7-8: a concrete better way to do a step an SOP covers, or a tool that replaces one.
9-10: urgent: a platform rule, ban, price or deliverability change that breaks what Wren runs now.

Answer {"score": n, "summary": "two plain sentences on what the item says", "changes": ["the SOP names it would change, from the list above"], "why": "one sentence: what Wren would do differently, or why nothing"}.

Item from ${item.feed}${item.publishedAt ? `, ${item.publishedAt.toISOString().slice(0, 10)}` : ""}:
Title: ${item.title}
URL: ${item.url}
${item.text.slice(0, PROMPT_TEXT)}`;
}

/**
 * Score one item; a second call answers the first's verdict. Null when there's no such row, or the
 * model's answer didn't read three times (it waits, unscored). A provider failure throws, so the
 * step tries again.
 */
export async function scoreItem(
  db: Db,
  llm: LlmClient | null,
  practices: readonly Practice[],
  id: number,
): Promise<Verdict | null> {
  const [row] = await db
    .select({ item: items, feed: feeds.name })
    .from(items)
    .innerJoin(feeds, eq(feeds.id, items.feedId))
    .where(eq(items.id, id));
  if (!row) return null;
  const { item, feed } = row;
  if (item.verdict) return item.verdict;
  if (item.tries >= MAX_TRIES) return null;
  if (!llm) {
    await db
      .update(items)
      .set({ verdict: "show", why: "No model is set, so it shows.", scoredAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.verdict)));
    return "show";
  }
  const out = await completeAndParse(llm, scorePrompt({ ...item, feed }, practices), scoreSchema, {
    maxTokens: 600,
    system: SYSTEM,
    name: "watch.score",
  });
  const v = out.parsed;
  if (!v) {
    await db
      .update(items)
      .set({ tries: item.tries + 1 })
      .where(eq(items.id, id));
    return null;
  }
  const names = new Set(practices.map((p) => p.name));
  const verdict = verdictOf(v.score);
  await db
    .update(items)
    .set({
      score: v.score,
      verdict,
      summary: v.summary,
      changes: v.changes.filter((c) => names.has(c)),
      why: v.why,
      tries: item.tries + 1,
      scoredAt: new Date(),
    })
    .where(and(eq(items.id, id), isNull(items.verdict)));
  return verdict;
}

/** `watch.score` on the spine: the item leaves by its verdict's port. Wren's own, in main. */
export const scoreStep =
  (db: Db, llm: LlmClient | null, practices: () => Promise<Practice[]>): Step =>
  async (_port, e) => {
    const id = Number(e.data.itemId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no feed item`);
    const verdict = await scoreItem(db, llm, await practices(), id);
    return verdict ? [{ port: verdict, event: e }] : [];
  };

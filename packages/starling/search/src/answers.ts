/**
 * Does an answer engine cite the site? Google's page (the AI Overview, the
 * organic results, "People also ask") and Perplexity, each through
 * autobrowse (`web` `/google`, `perplexity` `/chat/completions`). Both are
 * browser legs on the Mac's desk: Google bot-checks the box's IP. A keyword
 * is asked at most once a day per engine; the least recently asked go first.
 */
import type { SiteClient } from "@wren/core/content";
import type { Db } from "@wren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { addKeywords } from "./keywords.js";
import { type Engine, type SearchKeyword, searchAnswers, searchKeywords } from "./schema.js";

export interface Answer {
  cited: boolean;
  rank: number | null;
  overview: boolean | null;
  sources: string[];
  questions: string[];
}

/** autobrowse `web` `/google` (its `Serp`), the parts read here. */
interface Serp {
  overview: { text: string; sources: Array<{ url: string | null }> } | null;
  results: Array<{ position: number; url: string | null }>;
  questions: string[];
}
/** Perplexity's API shape (the web page answers in it too). */
interface Completion {
  citations?: string[];
  search_results?: Array<{ url: string }>;
}

/** `example.com` and every subdomain of it. */
export const isSite = (url: string | null | undefined, host: string) => {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === host || h.endsWith(`.${host}`);
  } catch {
    return false;
  }
};

export async function ask(
  sites: SiteClient,
  engine: Engine,
  phrase: string,
  host: string,
): Promise<Answer> {
  if (engine === "google") {
    const serp = await sites.call<Serp>("web", "GET", "/google", { q: phrase, n: 10 });
    const sources = (serp.overview?.sources ?? [])
      .map((s) => s.url)
      .filter((u): u is string => !!u);
    const hit = serp.results.find((r) => isSite(r.url, host));
    return {
      cited: sources.some((u) => isSite(u, host)),
      rank: hit?.position ?? null,
      overview: serp.overview !== null,
      sources,
      questions: serp.questions ?? [],
    };
  }
  const out = await sites.call<Completion>("perplexity", "POST", "/chat/completions", {
    messages: [{ role: "user", content: phrase }],
  });
  const sources = out.citations ?? (out.search_results ?? []).map((r) => r.url);
  const at = sources.findIndex((u) => isSite(u, host));
  return { cited: at >= 0, rank: at >= 0 ? at + 1 : null, overview: null, sources, questions: [] };
}

/** Keywords not asked of `engine` today, least recently asked first. */
export async function dueKeywords(
  db: Db,
  engine: Engine,
  today: string,
  limit: number,
): Promise<SearchKeyword[]> {
  const last = db
    .select({
      keywordId: searchAnswers.keywordId,
      at: sql<string>`max(${searchAnswers.askedOn})`.as("at"),
    })
    .from(searchAnswers)
    .where(eq(searchAnswers.engine, engine))
    .groupBy(searchAnswers.keywordId)
    .as("last");
  const rows = await db
    .select({ k: searchKeywords, at: last.at })
    .from(searchKeywords)
    .leftJoin(last, eq(last.keywordId, searchKeywords.id))
    .where(and(isNull(searchKeywords.retiredAt), sql`${last.at} is distinct from ${today}::date`))
    .orderBy(sql`${last.at} asc nulls first`, searchKeywords.id)
    .limit(limit);
  return rows.map((r) => r.k);
}

/** Stores the answer. Google's "People also ask" for a seed or a real query become its fan-out questions. */
export async function recordAnswer(
  db: Db,
  k: SearchKeyword,
  engine: Engine,
  a: Answer,
  o: { today: string; runId: string | null },
): Promise<number> {
  const row = {
    cited: a.cited,
    rank: a.rank,
    overview: a.overview,
    sources: a.sources,
    questions: a.questions,
    runId: o.runId,
  };
  await db
    .insert(searchAnswers)
    .values({ engine, keywordId: k.id, askedOn: o.today, ...row })
    .onConflictDoUpdate({
      target: [searchAnswers.engine, searchAnswers.keywordId, searchAnswers.askedOn],
      set: row,
    });
  if (k.source === "fanout") return 0; // a question's questions would grow the list without end
  return addKeywords(db, a.questions, {
    source: "fanout",
    page: k.page,
    parentId: k.parentId ?? k.id,
    runId: o.runId,
  });
}

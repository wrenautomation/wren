/**
 * The keywords: seeds a person adds, the questions each seed fans out into,
 * and the queries people already found the site with. Fan-out is how AI
 * search answers: it splits one question into many searches and cites the
 * pages that answer the pieces, so a page is written for the pieces too.
 */
import type { Db } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type KeywordSource, type SearchKeyword, searchDays, searchKeywords } from "./schema.js";

/** How a phrase is compared: lower case, single spaces, no end punctuation. */
export const phraseKey = (p: string) =>
  p
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!\s]+$/, "")
    .trim();

export async function activeKeywords(db: Db): Promise<SearchKeyword[]> {
  return db
    .select()
    .from(searchKeywords)
    .where(isNull(searchKeywords.retiredAt))
    .orderBy(searchKeywords.id);
}

/** Adds phrases not already there (a retired one stays retired). Returns how many were new. */
export async function addKeywords(
  db: Db,
  phrases: readonly string[],
  o: {
    source: KeywordSource;
    page?: string | null;
    parentId?: number | null;
    runId?: string | null;
  },
): Promise<number> {
  const rows = [...new Set(phrases.map(phraseKey).filter(Boolean))].map((phrase) => ({
    phrase,
    source: o.source,
    page: o.page ?? null,
    parentId: o.parentId ?? null,
    runId: o.runId ?? null,
  }));
  if (!rows.length) return 0;
  const added = await db
    .insert(searchKeywords)
    .values(rows)
    .onConflictDoNothing({ target: searchKeywords.phrase })
    .returning({ id: searchKeywords.id });
  return added.length;
}

export async function retireKeyword(db: Db, phrase: string): Promise<boolean> {
  const done = await db
    .update(searchKeywords)
    .set({ retiredAt: new Date() })
    .where(and(eq(searchKeywords.phrase, phraseKey(phrase)), isNull(searchKeywords.retiredAt)))
    .returning({ id: searchKeywords.id });
  return done.length > 0;
}

/**
 * Queries people already see the site for, not yet a keyword: `minImpressions`
 * over the last `days`. Each goes in with the page Google showed most for it.
 */
export async function discoverKeywords(
  db: Db,
  o: { today: string; days?: number; minImpressions?: number; runId: string | null },
): Promise<number> {
  const since = new Date(Date.parse(`${o.today}T00:00:00Z`) - (o.days ?? 28) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .select({
      query: searchDays.query,
      page: sql<string>`(array_agg(${searchDays.page} order by ${searchDays.impressions} desc))[1]`,
      impressions: sql<number>`sum(${searchDays.impressions})::int`,
    })
    .from(searchDays)
    .where(gte(searchDays.day, since))
    .groupBy(searchDays.query)
    .having(sql`sum(${searchDays.impressions}) >= ${o.minImpressions ?? 5}`);
  let added = 0;
  for (const r of rows)
    added += await addKeywords(db, [r.query], {
      source: "query",
      page: new URL(r.page).pathname,
      runId: o.runId,
    });
  return added;
}

const FanOut = z.object({ questions: z.array(z.string().min(3)).min(1).max(12) });

export function fanOutPrompt(seed: string, about: string): string {
  return [
    "An AI search engine (Google AI Mode, ChatGPT search, Perplexity) answers a question by splitting it into",
    "several narrower searches and citing the pages that answer those. List the searches it would run for the",
    "question below, as a buyer would type them: comparisons, costs to consider, how it works, risks, alternatives,",
    "who it is for. 6 to 8 of them. Plain words, no brand names.",
    "",
    `Question: ${seed}`,
    "",
    "The site that wants to be cited, for context only:",
    about.slice(0, 2_000),
    "",
    'Answer with JSON only: {"questions": ["..."]}',
  ].join("\n");
}

export interface FanOutStats {
  seeds: number;
  added: number;
  failed: string[];
}

/** Each seed with no fan-out yet gets one. Children never fan out again: the list stays bounded. */
export async function fanOut(
  db: Db,
  llm: LlmClient,
  o: { about: string; runId: string | null },
): Promise<FanOutStats> {
  const all = await activeKeywords(db);
  const parents = new Set(all.map((k) => k.parentId).filter((id) => id !== null));
  const seeds = all.filter((k) => k.source !== "fanout" && !parents.has(k.id));
  const stats: FanOutStats = { seeds: seeds.length, added: 0, failed: [] };
  for (const seed of seeds) {
    const out = await completeAndParse(llm, fanOutPrompt(seed.phrase, o.about), FanOut, {
      maxTokens: 600,
      runId: o.runId,
      name: "search fan-out",
    });
    if (!out.parsed) {
      stats.failed.push(
        `${seed.phrase} (${out.parseError ?? out.providerRejected ?? "no answer"})`,
      );
      continue;
    }
    stats.added += await addKeywords(db, out.parsed.questions, {
      source: "fanout",
      page: seed.page,
      parentId: seed.id,
      runId: o.runId,
    });
  }
  return stats;
}

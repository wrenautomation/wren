/**
 * The brief: every active keyword with what Google and the engines say about
 * it, plus the index state of each page. One read for a person (`wren search
 * brief`) and the model's whole view of the numbers when it proposes.
 */
import type { Db } from "@wren/db";
import { sql } from "drizzle-orm";

export interface KeywordLine {
  phrase: string;
  source: string;
  page: string | null;
  impressions: number;
  clicks: number;
  /** Average position over the window, impression-weighted; null = never shown. */
  position: number | null;
  /** Per engine, the latest answer: cited, and the site's rank. */
  engines: Record<
    string,
    { cited: boolean; rank: number | null; overview: boolean | null; on: string }
  >;
}

export type PageLine = {
  url: string;
  coverage: string | null;
  indexed: boolean;
  on: string;
};

export interface Brief {
  since: string;
  keywords: KeywordLine[];
  pages: PageLine[];
}

export async function brief(db: Db, o: { today: string; days?: number }): Promise<Brief> {
  const since = new Date(Date.parse(`${o.today}T00:00:00Z`) - (o.days ?? 28) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const keywords = await db.execute<{
    phrase: string;
    source: string;
    page: string | null;
    impressions: number;
    clicks: number;
    position: number | null;
    engines: KeywordLine["engines"] | null;
  }>(sql`
    select k.phrase, k.source, k.page,
      coalesce(sum(d.impressions), 0)::int as impressions,
      coalesce(sum(d.clicks), 0)::int as clicks,
      round((sum(d.position * d.impressions) / nullif(sum(d.impressions), 0))::numeric, 1)::float as position,
      (select jsonb_object_agg(a.engine, jsonb_build_object('cited', a.cited, 'rank', a.rank, 'overview', a.overview, 'on', a.asked_on))
         from (select distinct on (engine) * from search_answers where keyword_id = k.id order by engine, asked_on desc) a
      ) as engines
    from search_keywords k
    left join search_days d on d.query = k.phrase and d.day >= ${since}::date
    where k.retired_at is null
    group by k.id
    order by k.source, impressions desc, k.id`);
  const pages = await db.execute<PageLine>(sql`
    select distinct on (url) url, coverage, verdict = 'PASS' as indexed, checked_on::text as "on"
    from search_pages order by url, checked_on desc`);
  return {
    since,
    keywords: keywords.map((k) => ({ ...k, engines: k.engines ?? {} })),
    pages: [...pages],
  };
}

/** The brief as short lines: one per keyword, one per page. */
export function formatBrief(b: Brief): string[] {
  const engine = (k: KeywordLine) =>
    Object.entries(k.engines)
      .map(
        ([e, a]) =>
          `${e} ${a.cited ? "cites us" : "no cite"}${a.rank ? ` #${a.rank}` : ""}${a.overview === false ? " (no overview)" : ""}`,
      )
      .join(", ") || "not asked";
  return [
    `keywords since ${b.since} (impressions, clicks, avg position; engines):`,
    ...b.keywords.map(
      (k) =>
        `- [${k.source}] "${k.phrase}"${k.page ? ` → ${k.page}` : ""}: ${k.impressions} imp, ${k.clicks} clicks, ${k.position ?? "-"} pos; ${engine(k)}`,
    ),
    "pages:",
    ...b.pages.map(
      (p) => `- ${p.url}: ${p.indexed ? "indexed" : (p.coverage ?? "not indexed")} (${p.on})`,
    ),
  ];
}

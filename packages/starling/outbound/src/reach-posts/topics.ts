/** The pass's search words: his own by yield, rested when they find nothing, and the model's new ones. */

import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ReachPostPlatform } from "../schema.js";
import { PLATFORM_NAME } from "./settings.js";

/** A search word's yield is counted over this many days; older reads age out and it is tried again. */
const TOPIC_DAYS = 14;
/** A search word that read this many posts lately with none on target rests. */
export const REST_AFTER = 15;
/** Off-target reasons: rows that never reached the rank. */
const OFF_REASON = "^(a job|for job|not about|older than|ours$|too short)";

interface TopicYield {
  topic: string;
  /** Posts it found lately. */
  read: number;
  /** Of those, at or above the minimum fit and not off target. */
  onTarget: number;
}

/** Each search word's posts on one platform in the last `TOPIC_DAYS`, and how many were on target. */
export async function topicYields(
  db: Queryable,
  o: { platform: ReachPostPlatform; minFit: number; now: Date },
): Promise<TopicYield[]> {
  const since = new Date(o.now.getTime() - TOPIC_DAYS * 86_400_000).toISOString();
  const rows = (await db.execute(sql`
    SELECT substring(found_by from 8) topic, count(*)::int read,
      (count(*) FILTER (WHERE fit >= ${o.minFit}
        AND coalesce(state_reason, '') !~ ${OFF_REASON}))::int on_target
    FROM reach_posts
    WHERE platform = ${o.platform} AND found_by LIKE 'topic: %' AND created_at >= ${since}
    GROUP BY 1`)) as unknown as Array<{ topic: string; read: number; on_target: number }>;
  return rows.map((r) => ({ topic: r.topic, read: r.read, onTarget: r.on_target }));
}

const rateOf = (y: TopicYield | undefined) => (y?.read ? y.onTarget / y.read : 1);
const keyOf = (t: string) => t.trim().toLowerCase();
/** A model word must name the trade (one of the audience's words); with no audience, any word. */
const namesTrade = (t: string, audience: readonly string[] | undefined) =>
  !audience?.length || audience.some((a) => t.toLowerCase().includes(a.toLowerCase()));

/**
 * The pass's search words. His own (`topics`) first, best yield first, untried ones as best;
 * one that read `REST_AFTER` posts lately with none on target rests. Then up to `extra` more:
 * past model words that found the audience and name its trade (at most `extra - 1`, so one slot
 * always explores), then the model's new ones.
 */
export function planTopics(
  own: readonly string[],
  yields: readonly TopicYield[],
  fresh: readonly string[],
  extra: number,
  audience?: readonly string[],
): { topics: string[]; rested: string[] } {
  const by = new Map(yields.map((y) => [keyOf(y.topic), y]));
  const rests = (t: string) => {
    const y = by.get(keyOf(t));
    return !!y && y.read >= REST_AFTER && y.onTarget === 0;
  };
  const rested = own.filter(rests);
  const topics = own
    .filter((t) => !rests(t))
    .map((t, i) => ({ t, i, r: rateOf(by.get(keyOf(t))) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.t);
  const seen = new Set(own.map(keyOf));
  const proven = yields
    .filter((y) => !seen.has(keyOf(y.topic)) && y.onTarget >= 2 && namesTrade(y.topic, audience))
    .sort((a, b) => rateOf(b) - rateOf(a) || b.onTarget - a.onTarget)
    .slice(0, Math.max(0, extra - 1))
    .map((y) => y.topic);
  const more: string[] = [];
  for (const t of [...proven, ...fresh]) {
    if (more.length >= extra) break;
    if (seen.has(keyOf(t)) || rests(t)) continue;
    seen.add(keyOf(t));
    more.push(t);
  }
  return { topics: [...topics, ...more], rested };
}

const TOPICS = z.object({ topics: z.array(z.string()).max(12) });
/** Words that bring job ads, job seekers and career advice, not the buyers' own posts. */
const NOT_A_TOPIC =
  /\b(?:hiring|hire|jobs?|roles?|vacanc\w*|apply|careers?|open to work|salary|resumes?|cv)\b/i;

/**
 * New search words for the buyers' own posts: the model reads `about` and what past searches
 * found (good ones with their yield, rested ones), and code keeps 1 to 5 words that bring no job
 * ads and are not known yet.
 */
export async function proposeTopics(
  llm: LlmClient,
  o: {
    platform?: ReachPostPlatform;
    about: string;
    n: number;
    yields: readonly TopicYield[];
    known: readonly string[];
    /** The trade's words (`recruit`, `staffing`): each new phrase holds one, so a search finds the trade. */
    audience?: readonly string[];
  },
): Promise<string[]> {
  const on = PLATFORM_NAME[o.platform ?? "linkedin"];
  if (o.n <= 0) return [];
  const good = o.yields
    .filter((y) => y.onTarget > 0)
    .sort((a, b) => rateOf(b) - rateOf(a))
    .slice(0, 8);
  const bad = o.yields.filter((y) => y.read >= REST_AFTER && y.onTarget === 0).slice(0, 8);
  const out = await completeAndParse(
    llm,
    `Who we want to find on ${on}: ${o.about}
We search ${on} posts by keywords to find posts these people wrote themselves about running their business. Give ${o.n + 3} new search phrases, 2 to 4 words each, worded the way they write in their own posts: first person, about their clients, sales, pipeline and the firm.${o.audience?.length ? ` Each phrase names their trade with one of these words: ${o.audience.join(", ")} (a word may take an ending: recruit, recruiting).` : ""}
Leave out words that bring job ads, job seekers or career advice (hiring, job, role, apply, career), and phrases that vendors who sell to them put in their ads.
${good.length ? `Found their posts before (on target of read): ${good.map((y) => `"${y.topic}" ${y.onTarget}/${y.read}`).join(", ")}.\n` : ""}${bad.length ? `Found none of their posts: ${bad.map((y) => `"${y.topic}"`).join(", ")}.\n` : ""}Answer JSON only: {"topics": ["..."]}`,
    TOPICS,
    { maxTokens: 300, name: `${o.platform ?? "linkedin"}.post_topics` },
  );
  const known = new Set([...o.known, ...o.yields.map((y) => y.topic)].map(keyOf));
  const kept: string[] = [];
  for (const raw of out.parsed?.topics ?? []) {
    const t = raw
      .replace(/["\u201c\u201d]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const n = t.split(" ").length;
    if (!t || n > 5 || t.length > 60 || NOT_A_TOPIC.test(t) || known.has(keyOf(t))) continue;
    if (!namesTrade(t, o.audience)) continue;
    known.add(keyOf(t));
    kept.push(t);
  }
  return kept.slice(0, o.n);
}

/**
 * Podcasts and talks (S6): episodes and videos a firm's owner appears in. iTunes Search first
 * (free, no key); YouTube `search.list` only when iTunes finds nothing (100 units a call, at most
 * `youtubePerDay` a Pacific day). An episode is kept only when its title or description names the
 * person in full and their firm, so a same-name stranger is dropped and left in `tried`.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { YouTubeError } from "../enrichment/youtube.js";
import type { SignalDraft } from "../findings.js";
import { defineCollector, type Person, personOf, subjectOf, type Tried } from "./index.js";

const ITUNES = "https://itunes.apple.com/search";
/** Episodes iTunes returns a name; its maximum is 200. */
const ITUNES_LIMIT = 50;
const VIDEOS = 25;
const PACIFIC = "America/Los_Angeles";

/** Owner, founder, partner, CEO, president or managing titles. A vice president is not. */
const DECIDES =
  /\b(owner|co-?founder|founder|partner|ceo|chief executive|managing)\b|(?<!vice[\s-])\bpresident\b/i;
export const decides = (title: string | null) => !!title && DECIDES.test(title);

const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `phrase` as whole words in `text`, case and accents aside. */
const hasWords = (text: string, phrase: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${literal(fold(phrase)).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(fold(text));
const SUFFIX =
  /[\s,]+(llc|l\.l\.c\.|inc\.?|ltd\.?|co\.?|corp\.?|corporation|company|pc|p\.c\.|plc|lp|llp)$/i;
const firmNames = (p: Person): string[] => {
  const name = p.firm.name?.trim();
  const short = name?.replace(SUFFIX, "").trim();
  const domain = p.firm.domain?.toLowerCase().replace(/^www\./, "");
  return [...new Set([name, short, domain].filter((x): x is string => !!x && x.length >= 3))];
};

/** The keep rule: the full name and the firm's name or domain, in the same episode's text. */
export function namesBoth(text: string, p: Person): boolean {
  return hasWords(text, p.fullName) && firmNames(p).some((f) => hasWords(text, f));
}

/** The Pacific day `now` falls in: YouTube's units reset at its midnight. */
export function pacificDay(now: Date): { start: Date; next: Date } {
  const offsetAt = (t: Date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: PACIFIC,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
        .formatToParts(t)
        .map((x) => [x.type, Number(x.value)]),
    ) as Record<string, number>;
    const wall = Date.UTC(
      parts.year ?? 0,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour,
      parts.minute,
      parts.second,
    );
    return { parts, offset: wall - Math.floor(t.getTime() / 1000) * 1000 };
  };
  const { parts, offset } = offsetAt(now);
  // A midnight's own offset, so a DST change between now and then lands on the true midnight.
  const at = (dayShift: number) => {
    const wall = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, (parts.day ?? 1) + dayShift);
    return new Date(wall - offsetAt(new Date(wall - offset)).offset);
  };
  return { start: at(0), next: at(1) };
}

/** YouTube searches this collector made today, Pacific. */
async function youtubeSpent(deps: { db: Queryable }, now: Date): Promise<number> {
  const { start } = pacificDay(now);
  const [row] = await deps.db.execute<{ n: number }>(sql`
    select count(*)::int as n from signal_checks k, jsonb_array_elements(k.tried) t
    where k.collector = 'talks' and k.checked_at >= ${start.toISOString()}::timestamptz
      and t ->> 'step' = 'youtube' and t ->> 'outcome' not like 'quota%'`);
  return Number(row?.n ?? 0);
}

interface Episode {
  trackName?: string;
  collectionName?: string;
  description?: string;
  shortDescription?: string;
  releaseDate?: string;
  trackViewUrl?: string;
  episodeUrl?: string;
}

interface Video {
  id?: { videoId?: string };
  snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string };
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" };
const entities = (s: string) =>
  s.replace(/&(amp|quot|#39|lt|gt);/g, (_, e: string) => ENTITIES[e] ?? _);

function draft(
  p: Person,
  url: string,
  at: string | undefined,
  value: { title: string; topic: "podcast" | "video"; show: string | null; description: string },
  raw: unknown,
  via: string,
): SignalDraft | null {
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return null;
  return {
    personId: p.id,
    kind: "talk",
    factKey: `p${p.id}:talk:${url}`.slice(0, 400),
    value: { ...value, published_at: when.toISOString(), raw },
    confidence: 1,
    via,
    sourceUrl: url,
    document: null,
    signalAt: when,
    dated: "published",
  };
}

export const talks = defineCollector({
  name: "talks",
  subject: "person",
  built: true,
  settings: z.object({
    /** Search YouTube when iTunes finds nothing. Needs the `youtube` dep. */
    youtube: z.boolean().default(true),
    /** YouTube searches a Pacific day, 100 units each; the `youtube` stage keeps the rest. */
    youtubePerDay: z.number().int().min(0).default(20),
  }),
  bucket: { perDay: 200, burst: 20 },
  everyDays: 90,
  metered: false,
  async collect(deps, subject, s) {
    const key = subjectOf(subject);
    const p = key && "personId" in key ? await personOf(deps.db, key.personId) : null;
    if (!p)
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "person", what: subject, outcome: "no such person" }],
      };
    if (!decides(p.title))
      return {
        state: "none",
        signals: [],
        tried: [{ step: "title", what: p.title ?? "", outcome: "not an owner title" }],
      };
    const tried: Tried[] = [];
    const signals: SignalDraft[] = [];
    let asked = 0;

    if (deps.fetcher) {
      const term = `"${p.fullName}"`;
      const q = new URLSearchParams({
        media: "podcast",
        entity: "podcastEpisode",
        term,
        limit: String(ITUNES_LIMIT),
      });
      const r = await deps.fetcher.get(`${ITUNES}?${q}`);
      let results: Episode[] | null = null;
      try {
        if (r.status === 200)
          results = (JSON.parse(r.text) as { results?: Episode[] }).results ?? [];
      } catch {}
      if (r.status === 403 || r.status === 429) {
        // ponytail: iTunes allows about 20 calls a minute and the fetcher spaces 1s; a refusal parks the pass an hour.
        tried.push({ step: "itunes", what: term, outcome: `refused: HTTP ${r.status}` });
        return {
          state: "capped",
          signals,
          tried,
          retryAt: new Date(deps.now.getTime() + 3_600_000),
          stop: "iTunes refused: rate limit",
        };
      }
      if (!results) tried.push({ step: "itunes", what: term, outcome: `failed: HTTP ${r.status}` });
      else {
        asked += 1;
        let strangers = 0;
        for (const e of results) {
          const title = e.trackName ?? "";
          const description = e.description ?? e.shortDescription ?? "";
          const url = e.trackViewUrl ?? e.episodeUrl;
          if (!url || !namesBoth(`${title}\n${description}`, p)) {
            strangers += 1;
            continue;
          }
          const d = draft(
            p,
            url,
            e.releaseDate,
            { title, topic: "podcast", show: e.collectionName ?? null, description },
            e,
            "itunes",
          );
          if (d) signals.push(d);
        }
        tried.push({
          step: "itunes",
          what: term,
          outcome: `${results.length} episodes, ${signals.length} kept, ${strangers} dropped`,
        });
      }
    }

    if (signals.length === 0 && s.youtube && deps.youtube) {
      const firm = p.firm.name ?? p.firm.domain ?? "";
      const q = `"${p.fullName}" ${firm}`.trim();
      if ((await youtubeSpent(deps, deps.now)) >= s.youtubePerDay) {
        tried.push({ step: "youtube", what: q, outcome: "skipped: daily searches spent" });
        return { state: "capped", signals, tried, retryAt: pacificDay(deps.now).next };
      }
      let body: { items?: Video[] };
      try {
        body = (await deps.youtube("search", {
          part: "snippet",
          q,
          type: "video",
          maxResults: String(VIDEOS),
        })) as { items?: Video[] };
      } catch (err) {
        if (err instanceof YouTubeError && err.quota) {
          tried.push({ step: "youtube", what: q, outcome: `quota: ${err.message}` });
          return {
            state: "capped",
            signals,
            tried,
            retryAt: pacificDay(deps.now).next,
            stop: "YouTube's daily units are spent",
          };
        }
        throw err;
      }
      asked += 1;
      const items = body.items ?? [];
      let strangers = 0;
      for (const v of items) {
        const id = v.id?.videoId;
        const title = entities(v.snippet?.title ?? "");
        const description = entities(v.snippet?.description ?? "");
        if (!id || !namesBoth(`${title}\n${description}`, p)) {
          strangers += 1;
          continue;
        }
        const d = draft(
          p,
          `https://www.youtube.com/watch?v=${id}`,
          v.snippet?.publishedAt,
          { title, topic: "video", show: v.snippet?.channelTitle ?? null, description },
          v,
          "youtube",
        );
        if (d) signals.push(d);
      }
      tried.push({
        step: "youtube",
        what: q,
        outcome: `${items.length} videos, ${signals.length} kept, ${strangers} dropped`,
      });
    }

    const state = signals.length ? "found" : asked ? "none" : "unresolved";
    return { state, signals, tried };
  },
});

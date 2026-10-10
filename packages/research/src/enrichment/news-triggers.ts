/**
 * The `triggers` stage (designs/2026-10-10-triggers.md): news turns into leads. A niche's trigger
 * words ("staffing agency") are searched on Google News RSS for the last two weeks of
 * acquisitions, funding, new offices, expansions and new leaders. A model names the niche firm
 * each headline is about. A firm we hold gets the event as a dated `news` finding; a new one is
 * imported (source `news_trigger`, keyed `nt:<name>`) with the event as its first finding, so
 * discovery finds its site next and every brief shows why it came in. Free: RSS costs nothing
 * and the model reads 25 headlines a call.
 */
import { IDENTITY_KEY, type LeadSource, type RawRow, runImport } from "@wren/core";
import { atomic, type Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  type CompanyEvent,
  type EventHit,
  type EventKind,
  eventDate,
  eventDocument,
  eventFinding,
  eventKindOf,
  googleWords,
  NEWS_RSS,
  readRss,
} from "../companies/events.js";
import { FetchError, type Fetcher } from "../fetch/fetcher.js";
import { keepDocument, keepSignal } from "../findings.js";
import { type Bucket, bucketRoom } from "../pacing.js";
import { bareCompanyName, plain } from "../people/names.js";

export const TRIGGERS_COMMAND = "enrich triggers";
export const TRIGGERS_SOURCE = "news_trigger";
/** The kinds that say a firm is changing now: each one is a reason to write. */
export const TRIGGER_KINDS: readonly EventKind[] = [
  "acquisition",
  "merger",
  "funding",
  "office",
  "expansion",
  "leader",
];
/** A headline older than this is no trigger. */
export const TRIGGER_DAYS = 14;
/** A word is searched again after this: the window overlaps, so nothing falls between. */
export const TRIGGERS_EVERY_DAYS = 7;
/** Searches a day. RSS is free; this only spaces the reads. */
export const TRIGGERS_BUCKET: Bucket = { perDay: 20, burst: 20 };
/** Headlines one model call reads. */
const PER_CALL = 25;
/** A named firm's key: `nt:` and its bare name. */
export const TRIGGER_KEY_PREFIX = "nt:";

/** One search's text: the word as a phrase, any kind's words, the window. */
export function triggerQuery(word: string, kinds: readonly EventKind[] = TRIGGER_KINDS): string {
  const any = [...new Set(kinds.flatMap(googleWords))].join(" OR ");
  return `"${word}" (${any}) when:${TRIGGER_DAYS}d`;
}

/** `news/rss?q=...`: one word's reads share it, so its last read is findable. */
export const triggerRef = (q: string): string => `news/rss?${new URLSearchParams({ q })}`;

/** A firm's key from its name: "The Acme Staffing Group, Inc." is `nt:acme-staffing-group`. */
export const triggerKey = (name: string): string | null => {
  const slug = plain(bareCompanyName(name)).replace(/ /g, "-");
  return slug.length >= 3 ? `${TRIGGER_KEY_PREFIX}${slug}`.slice(0, 64) : null;
};

/** The feed's dated hits in the window, each read as one kind; one per link. Pure. */
export function triggerHits(
  hits: readonly EventHit[],
  now: Date,
  kinds: readonly EventKind[] = TRIGGER_KINDS,
): CompanyEvent[] {
  const from = new Date(now.getTime() - TRIGGER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const out: CompanyEvent[] = [];
  for (const h of hits) {
    const date = eventDate(h.date, now);
    if (!date || date < from || date > to || out.some((e) => e.url === h.url)) continue;
    const kind = eventKindOf(`${h.title} ${h.snippet ?? ""}`, kinds);
    if (!kind) continue;
    out.push({
      kind,
      date,
      title: h.title,
      snippet: h.snippet ?? null,
      url: h.url,
      source: "rss",
      raw: h.raw ?? h,
    });
  }
  return out;
}

const SYSTEM = `You read news headlines for one kind of business. For each, name the business the \
news is about, only when it is that kind of business and the news is its own: it bought, merged, \
raised money, opened an office, grew or named a leader. Give the name as the business writes it, \
without "Inc." or "LLC". Answer null when the business is another kind, a public company, a \
government body, a person alone, or when the headline names no business. JSON only.`;

export function triggerPrompt(word: string, events: readonly CompanyEvent[]): string {
  const lines = events.map((e, i) => `${i}. ${e.title}${e.snippet ? ` | ${e.snippet}` : ""}`);
  return `Kind of business: ${word}

Headlines:
${lines.join("\n")}

Answer {"items": [{"i": <number>, "firm": <name or null>}]} with one item per headline.`;
}

const ITEMS = z.object({ items: z.array(z.unknown()) });
const ITEM = z.object({ i: z.number().int(), firm: z.string().trim().min(2).max(120).nullable() });

/** Each headline's firm by index; a call that fails names nobody and says why. */
async function nameFirms(
  llm: LlmClient,
  word: string,
  events: readonly CompanyEvent[],
): Promise<{ named: Map<number, string>; error: string | null }> {
  const named = new Map<number, string>();
  for (let at = 0; at < events.length; at += PER_CALL) {
    const part = events.slice(at, at + PER_CALL);
    const out = await completeAndParse(llm, triggerPrompt(word, part), ITEMS, {
      maxTokens: 2_000,
      system: SYSTEM,
      name: "triggers_name",
      metadata: { word, urls: part.map((e) => e.url) },
    });
    if (!out.parsed) return { named, error: out.parseError ?? out.providerRejected ?? "no answer" };
    for (const x of out.parsed.items) {
      const r = ITEM.safeParse(x);
      if (r.success && r.data.firm && part[r.data.i] && !named.has(at + r.data.i))
        named.set(at + r.data.i, r.data.firm);
    }
  }
  return { named, error: null };
}

/**
 * The niche's firm by bare name, when exactly one holds it. The cap is wide: a common first word
 * cut short would miss the firm and import it twice.
 */
async function firmNamed(db: Queryable, niche: string, name: string): Promise<number | null> {
  const want = plain(bareCompanyName(name));
  const first = want.split(" ")[0];
  if (!first || want.length < 3) return null;
  const rows = await db.execute<{ id: number; name: string }>(sql`
    select id, name from companies
    where niche = ${niche} and name ilike ${`%${first}%`}
    limit 5000`);
  const same = rows.filter((r) => plain(bareCompanyName(r.name)) === want);
  return same.length === 1 ? Number((same[0] as { id: number }).id) : null;
}

/** Headlines already read: every one is kept as a document, named or not. */
async function seenLinks(db: Queryable, urls: readonly string[]): Promise<Set<string>> {
  if (!urls.length) return new Set();
  const rows = await db.execute<{ url: string }>(sql`
    select distinct url from documents where url in (${sql.join(
      urls.map((u) => sql`${u}`),
      sql`, `,
    )})`);
  return new Set(rows.map((r) => r.url));
}

/** Searches left in the bucket now, and how long until the next when none. */
export async function triggersRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = TRIGGERS_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  const rows = await db.execute<{ at: string }>(sql`
    select imported_at as at from imports
    where source_type = ${TRIGGERS_SOURCE}
      and imported_at > ${now.toISOString()}::timestamptz - interval '2 days'
    order by imported_at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
}

/** The words due a read: never read first (in list order), then the longest ago. */
export async function triggersDue(
  db: Queryable,
  words: readonly string[],
  opts: { now: Date; limit: number },
): Promise<string[]> {
  if (words.length === 0 || opts.limit <= 0) return [];
  const refs = words.map((w) => triggerRef(triggerQuery(w)));
  const rows = await db.execute<{ ref: string; at: string }>(sql`
    select source_ref as ref, max(imported_at) as at from imports
    where source_type = ${TRIGGERS_SOURCE}
      and source_ref in (${sql.join(
        refs.map((r) => sql`${r}`),
        sql`, `,
      )})
    group by source_ref`);
  const last = new Map(rows.map((r) => [r.ref, new Date(r.at).getTime()]));
  const due = opts.now.getTime() - TRIGGERS_EVERY_DAYS * 86_400_000;
  return words
    .map((w, i) => ({ w, at: last.get(refs[i] as string) ?? 0 }))
    .filter((s) => s.at <= due)
    .sort((a, b) => a.at - b.at)
    .slice(0, opts.limit)
    .map((s) => s.w);
}

export type TriggerOutcome = "read" | "error";

export interface TriggerUnit {
  word: string;
  outcome: TriggerOutcome;
  /** Dated headlines of a trigger kind, new to us. */
  hits: number;
  /** Of those, the ones the model named a niche firm in. */
  named: number;
  /** Named firms we already held. */
  matched: number;
  created: number;
  /** News findings kept: one per named headline. */
  kept: number;
  batch: number | null;
  error: string | null;
}

/**
 * One word's search: read the feed, name each new headline's firm, then in one transaction import
 * the new firms and keep every named headline as a news finding on its firm. The import is made
 * even when nothing is new, so the read counts in the bucket and the word waits its week.
 */
export async function triggerUnit(
  db: Queryable,
  deps: { fetcher: Fetcher; llm: LlmClient },
  w: { word: string; niche: string; now: Date },
): Promise<TriggerUnit> {
  const q = triggerQuery(w.word);
  const none = { word: w.word, hits: 0, named: 0, matched: 0, created: 0, kept: 0, batch: null };
  const url = `${NEWS_RSS}?${new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" })}`;
  let feed: EventHit[] | null;
  try {
    const res = await deps.fetcher.get(url);
    feed = res.status === 200 ? readRss(res.text) : null;
    if (!feed)
      return {
        ...none,
        outcome: "error",
        error: res.status === 200 ? "not a feed" : `HTTP ${res.status}`,
      };
  } catch (err) {
    if (!(err instanceof FetchError)) throw err;
    return { ...none, outcome: "error", error: err.message };
  }
  const read = triggerHits(feed, w.now);
  const seen = await seenLinks(
    db,
    read.map((e) => e.url),
  );
  const fresh = read.filter((e) => !seen.has(e.url));
  const { named, error } = fresh.length
    ? await nameFirms(deps.llm, w.word, fresh)
    : { named: new Map<number, string>(), error: null };
  if (error) return { ...none, hits: fresh.length, outcome: "error", error };

  const found: { event: CompanyEvent; name: string; id: number | null; key: string | null }[] = [];
  for (const [i, name] of named) {
    const event = fresh[i] as CompanyEvent;
    found.push({ event, name, id: await firmNamed(db, w.niche, name), key: triggerKey(name) });
  }
  const rows: RawRow[] = [];
  for (const f of found) {
    if (f.id !== null || !f.key || rows.some((r) => r.trigger_key === f.key)) continue;
    rows.push({
      company_name: f.name,
      trigger_key: f.key,
      query: q,
      trigger: { kind: f.event.kind, date: f.event.date, title: f.event.title, url: f.event.url },
      news: f.event.raw,
      [IDENTITY_KEY]: { source_key: f.key },
    });
  }
  const source: LeadSource = {
    sourceType: TRIGGERS_SOURCE,
    sourceRef: triggerRef(q),
    rows: () => rows,
  };
  return atomic(db, async (tx) => {
    const { batch, stats } = await runImport(tx, source, { niche: w.niche });
    const keys = found.flatMap((f) => (f.id === null && f.key ? [f.key] : []));
    const byKey = new Map<string, number>();
    if (keys.length) {
      const made = await tx.execute<{ id: number; key: string }>(sql`
        select id, source_key as key from companies where source_key in (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`);
      for (const r of made) byKey.set(r.key, Number(r.id));
    }
    // Every headline read is kept, so none is asked about twice; a named one's finding shares it.
    for (const e of fresh) await keepDocument(tx, eventDocument(e));
    let kept = 0;
    for (const f of found) {
      const id = f.id ?? (f.key ? byKey.get(f.key) : undefined);
      if (id === undefined) continue;
      if ((await keepSignal(tx, eventFinding(id, f.event))).ok) kept++;
    }
    return {
      word: w.word,
      outcome: "read" as const,
      hits: fresh.length,
      named: found.length,
      matched: found.filter((f) => f.id !== null).length,
      created: stats.companies_created,
      kept,
      batch: batch.id,
      error: null,
    };
  });
}

export interface TriggersStats {
  selected: number;
  read: number;
  hits: number;
  named: number;
  matched: number;
  created: number;
  kept: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of words. */
  stopped: string | null;
}

export const emptyTriggersStats = (): TriggersStats => ({
  selected: 0,
  read: 0,
  hits: 0,
  named: 0,
  matched: 0,
  created: 0,
  kept: 0,
  errors: 0,
  stopped: null,
});

/** Count a unit. An error is counted and the pass goes on: the next word may read. */
export function countTriggerUnit(s: TriggersStats, u: TriggerUnit): void {
  s.hits += u.hits;
  if (u.outcome === "error") {
    s.errors++;
    return;
  }
  s.read++;
  s.named += u.named;
  s.matched += u.matched;
  s.created += u.created;
  s.kept += u.kept;
}

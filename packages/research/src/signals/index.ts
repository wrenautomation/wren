/**
 * Signals (designs/2026-10-06-signal-collectors.md): specific, timely, citable facts that make a
 * message relevant now, kept as dated findings. Each collector reads one source. The runner picks
 * the subjects that are due and fit the collector's bucket, calls `collect` (reads only), then
 * writes what came back: signals through `keepSignal`, the answer to `signal_checks`.
 *
 * The registry is `collectors.ts`; it re-exports this file, so a collector imports from here.
 */
import type { SiteClient } from "@wren/core/content";
import { atomic, type Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { googleLeft } from "../enrichment/profiles.js";
import type { YouTubeGet } from "../enrichment/youtube.js";
import type { Fetcher } from "../fetch/fetcher.js";
import { keepSignal, type SignalDraft } from "../findings.js";
import { type Bucket, bucketRoom } from "../pacing.js";
import type { PageStore } from "../pages.js";
import {
  researchSignals,
  type SignalCheckState,
  type SignalKind,
  signalChecks,
} from "../schema.js";

export type { SignalDraft } from "../findings.js";

export const SIGNALS_COMMAND = "enrich signals";
export const SIGNALS_COMPONENT = "research.signals";
/** `unit_holds.stage` for a unit out of retries; its subject is `<collector>:<subject>`. */
export const SIGNALS_HELD = "research.signals";
/** Google searches the collectors may spend a local day, of the 200 shared with profiles. */
export const SIGNALS_GOOGLE_PER_DAY = 50;
/** An unresolved subject is asked again after this long. */
export const UNRESOLVED_DAYS = 30;
/** A cap with no `retryAt` parks a subject this long. */
const CAPPED_HOURS = 24;
/** Subjects per collector a call, when the caller names none: one batch of free units. */
export const SIGNALS_LIMIT = 20;
/** `everyDays` for a collector that reads a subject once. */
export const ONCE = 36_500;

/** Who a collector reads about. `post`: a post key (`reddit:t3_…`), mapped to a firm or person later. */
export type SignalSubject = "company" | "person" | "post";

/** One read a collector made. `step: "google"` counts in Google's daily budget. */
export interface Tried {
  step: string;
  what: string;
  outcome: string;
  [more: string]: unknown;
}

/** What one `collect` returns; the runner writes it. */
export interface Collected {
  state: SignalCheckState;
  signals: SignalDraft[];
  tried: Tried[];
  /** A read's summary with no subject of its own (an unmapped demand post's score). */
  answer?: unknown;
  /** With `capped`: when to ask again. */
  retryAt?: Date | null;
  /** Stop this collector for the rest of the pass (a failed metered read, a cap). */
  stop?: string;
}

/** What a collector may read with. `db` is for reads only: the runner writes. */
export interface SignalDeps {
  db: Queryable;
  /** autobrowse's `sites`, every GET kept whole as a document (`keepingAnswers`). */
  sites: SiteClient | null;
  /** autobrowse on the Mac (`desk`), kept the same way. */
  desk: SiteClient | null;
  fetcher: Fetcher | null;
  /** Archived page HTML (`htmlOf`). */
  pages: PageStore | null;
  youtube: YouTubeGet | null;
  llm: LlmClient | null;
  /** The LinkedIn account to read as: `readAccount`'s answer, else null. */
  linkedin: string | null;
  /** Main's database when `db` is a client's: its reads count against the same budgets. */
  also?: Queryable | null;
  /** Google searches this unit may still spend. */
  googleLeft: number;
  now: Date;
}

/** The subjects of one pass: compose's next people, one per firm, and those firms. */
export interface Pass {
  niche: string | null;
  personIds: number[];
  companyIds: number[];
}

/**
 * One source of signals. `settings` is its own knobs (an object schema with defaults); the
 * component adds `on`, which defaults to `built`. A stub is `built: false`, so it never runs.
 */
export interface Collector<S extends z.ZodObject = z.ZodObject> {
  name: string;
  subject: SignalSubject;
  built: boolean;
  settings: S;
  /** Subjects a day, and how many at once. */
  bucket: Bucket;
  /** A found or none answer is asked again after this many days. */
  everyDays: number;
  /** True: each unit is its own journaled step and never retried (Exa, a model, LinkedIn). */
  metered: boolean;
  /** Subject keys to consider, in order; default: the pass's firms (`c<id>`) or people (`p<id>`). */
  subjects?(db: Queryable, pass: Pass, s: z.infer<S>): Promise<string[]>;
  /** Read one subject. Reads only. A metered collector returns errors as data. */
  collect(deps: SignalDeps, subject: string, s: z.infer<S>): Promise<Collected>;
}

export function defineCollector<S extends z.ZodObject>(c: Collector<S>): Collector<S> {
  return c;
}

/** A collector's settings as the component holds them. */
export type CollectorSettings = { on: boolean } & Record<string, unknown>;
export type SignalsSettings = Record<string, CollectorSettings>;

export const firmKey = (id: number) => `c${id}`;
export const personKey = (id: number) => `p${id}`;
/** A subject key as an id; null for a post key. */
export function subjectOf(key: string): { companyId: number } | { personId: number } | null {
  const m = /^([cp])(\d+)$/.exec(key);
  if (!m) return null;
  return m[1] === "c" ? { companyId: Number(m[2]) } : { personId: Number(m[2]) };
}

export interface Firm {
  id: number;
  name: string | null;
  domain: string | null;
  niche: string | null;
  country: string | null;
  linkedinUrl: string | null;
}
export interface Person {
  id: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  firm: Firm;
}

const FIRM_COLUMNS = sql`c.id, c.name, c.domain, c.niche, c.country, c.linkedin_url`;
type FirmRow = {
  id: number;
  name: string | null;
  domain: string | null;
  niche: string | null;
  country: string | null;
  linkedin_url: string | null;
};
const firmOfRow = (r: FirmRow): Firm => ({
  id: Number(r.id),
  name: r.name,
  domain: r.domain,
  niche: r.niche,
  country: r.country,
  linkedinUrl: r.linkedin_url,
});

/** The firm a `c<id>` names. */
export async function firmOf(db: Queryable, id: number): Promise<Firm | null> {
  const [r] = await db.execute<FirmRow>(
    sql`select ${FIRM_COLUMNS} from companies c where c.id = ${id}`,
  );
  return r ? firmOfRow(r) : null;
}

/** The person a `p<id>` names, with their firm. */
export async function personOf(db: Queryable, id: number): Promise<Person | null> {
  const [r] = await db.execute<
    FirmRow & {
      person_id: number;
      full_name: string;
      first_name: string | null;
      last_name: string | null;
      title: string | null;
      person_linkedin: string | null;
    }
  >(sql`
    select p.id person_id, p.full_name, p.first_name, p.last_name, p.title,
      p.linkedin_url person_linkedin, ${FIRM_COLUMNS}
    from people p join companies c on c.id = p.company_id where p.id = ${id}`);
  if (!r) return null;
  return {
    id: Number(r.person_id),
    fullName: r.full_name,
    firstName: r.first_name,
    lastName: r.last_name,
    title: r.title,
    linkedinUrl: r.person_linkedin,
    firm: firmOfRow(r),
  };
}

/**
 * A client's signal queue: its firms with a lead it can still mail, least recently checked
 * first. Wren's comes from compose's next people per niche instead.
 */
export async function queuedFirms(db: Queryable, limit: number): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    select c.id from companies c
    where c.decline_reason is null
      and exists (select 1 from leads l where l.company_id = c.id
        and l.status in ('imported', 'verified'))
    order by (select max(k.checked_at) from signal_checks k where k.subject = 'c' || c.id)
      asc nulls first, c.id
    limit ${limit}`);
  return rows.map((r) => Number(r.id));
}

/** A pass over these people: they, then their firms, in that order, each once. */
export async function passOf(
  db: Queryable,
  niche: string | null,
  personIds: readonly number[],
  companyIds: readonly number[] = [],
): Promise<Pass> {
  const firms = [...companyIds];
  if (personIds.length) {
    const rows = await db.execute<{ company_id: number }>(sql`
      select p.company_id from unnest(array[${sql.join(
        personIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::int[]) with ordinality q(id, ord) join people p on p.id = q.id order by q.ord`);
    firms.push(...rows.map((r) => Number(r.company_id)));
  }
  return { niche, personIds: [...new Set(personIds)], companyIds: [...new Set(firms)] };
}

/**
 * The account a collector reads LinkedIn as, by credential name (autobrowse resolves it to its
 * address), from the pool account (`WREN_POOL_LINKEDIN`). `linkedin` is William's main: research
 * reads since 2026-10-06, when the alt was restricted. Any other value (the alt's name or its
 * address) is `linkedin@alt`. Never `linkedin@wren`, Wren's outreach account.
 */
export const readAccount = (pool: string | null | undefined): string | null => {
  const p = pool?.trim();
  if (!p || p === "linkedin@wren") return null;
  return p === "linkedin" ? "linkedin" : "linkedin@alt";
};

/**
 * The due ones of `subjects`, in order: never checked, a found or none answer older than
 * `everyDays`, unresolved older than 30 days, or capped past `retry_at`.
 */
export async function dueSubjects(
  db: Queryable,
  c: Pick<Collector, "name" | "everyDays">,
  subjects: readonly string[],
  now: Date,
): Promise<string[]> {
  if (subjects.length === 0) return [];
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await db.execute<{ subject: string }>(sql`
    select q.subject from unnest(array[${sql.join(
      subjects.map((s) => sql`${s}`),
      sql`, `,
    )}]::text[]) with ordinality q(subject, ord)
    left join signal_checks k on k.collector = ${c.name} and k.subject = q.subject
    where k.subject is null
      or (k.state in ('found', 'none') and k.checked_at <= ${at} - make_interval(days => ${c.everyDays}))
      or (k.state = 'unresolved' and k.checked_at <= ${at} - make_interval(days => ${UNRESOLVED_DAYS}))
      or (k.state = 'capped'
        and coalesce(k.retry_at, k.checked_at + make_interval(hours => ${CAPPED_HOURS})) <= ${at})
    order by q.ord`);
  return [...new Set(rows.map((r) => r.subject))];
}

/**
 * How many subjects the collector's bucket allows now: its checks in the last two days. A
 * client's room also counts main's checks (`also`): one bucket per source.
 */
export async function collectorRoom(
  db: Queryable,
  c: Pick<Collector, "name" | "bucket">,
  now: Date,
  also: Queryable | null = null,
): Promise<{ room: number; nextInMs: number }> {
  const checks = async (on: Queryable) =>
    (
      await on.execute<{ at: string }>(sql`
        select checked_at as at from signal_checks
        where collector = ${c.name} and checked_at > ${now.toISOString()}::timestamptz - interval '2 days'`)
    ).map((r) => new Date(r.at).getTime());
  const at = [...(await checks(db)), ...(also ? await checks(also) : [])].sort((a, b) => a - b);
  return bucketRoom(at, now.getTime(), c.bucket);
}

/** One collector's share of a call: its due subjects with room, or why none. */
export interface CollectorPlan {
  name: string;
  subjects: string[];
  settings: CollectorSettings;
  why: string | null;
}

/**
 * Each collector's work this call. Only collectors that are on. A collector waits until its room
 * reaches a batch (`limit`, or its burst when smaller), so a busy pool doesn't spend a step on
 * one unit a minute.
 */
export async function signalPlan(
  db: Queryable,
  collectors: readonly Collector[],
  settings: SignalsSettings,
  pass: Pass,
  opts: {
    now: Date;
    limit?: number | undefined;
    only?: string | null | undefined;
    /** Main's database when `db` is a client's (`collectorRoom`). */
    also?: Queryable | null;
    /** A client's pass: metered collectors (they spend) stay Wren's. */
    free?: boolean;
  },
): Promise<CollectorPlan[]> {
  const limit = opts.limit ?? SIGNALS_LIMIT;
  const out: CollectorPlan[] = [];
  for (const c of collectors) {
    if (opts.only && c.name !== opts.only) continue;
    const s = settings[c.name] ?? { on: c.built };
    const plan = (subjects: string[], why: string | null) =>
      out.push({ name: c.name, subjects, settings: s, why });
    if (!s.on) {
      plan([], c.built ? "off in settings" : "not built");
      continue;
    }
    if (opts.free && c.metered) {
      plan([], "metered: Wren's only");
      continue;
    }
    const { room, nextInMs } = await collectorRoom(db, c, opts.now, opts.also ?? null);
    if (room < Math.min(limit, c.bucket.burst)) {
      plan([], `bucket low (${room}): next in ${Math.ceil(nextInMs / 1000)}s`);
      continue;
    }
    const candidates = c.subjects
      ? await c.subjects(db, pass, s)
      : c.subject === "company"
        ? pass.companyIds.map(firmKey)
        : c.subject === "person"
          ? pass.personIds.map(personKey)
          : [];
    const due = await dueSubjects(db, c, candidates, opts.now);
    plan(due.slice(0, Math.min(limit, room)), null);
  }
  return out;
}

/** One subject read by one collector, as journaled. */
export interface SignalUnit {
  collector: string;
  subject: string;
  /** `error`: a metered read failed and nothing was written. */
  state: SignalCheckState | "error";
  kept: number;
  refused: number;
  stop: string | null;
  /** `dry` only: what would have been kept. */
  drafts?: SignalDraft[];
}

/** What a unit reads with, past Google's room and the clock, which it reads itself. */
export type BaseDeps = Omit<SignalDeps, "googleLeft" | "now">;

/**
 * Read one subject and write what came back in one transaction. A free collector's error throws
 * (the unit is retried, then held). A metered one's is returned as `error`, unwritten, and
 * stops the collector: a read is never bought twice. `dry` writes nothing.
 */
export async function signalUnit(
  c: Collector,
  subject: string,
  s: CollectorSettings,
  base: BaseDeps,
  opts: { timezone: string; runId?: string | null; dry?: boolean },
): Promise<SignalUnit> {
  const now = new Date();
  const left = await googleLeft(base.db, {
    now,
    timezone: opts.timezone,
    signals: SIGNALS_GOOGLE_PER_DAY,
    also: base.also ?? null,
  });
  const deps: SignalDeps = { ...base, googleLeft: left, now };
  const { on: _on, ...own } = s;
  let got: Collected;
  try {
    got = await c.collect(deps, subject, c.settings.parse(own));
  } catch (err) {
    if (!c.metered) throw err;
    const why = err instanceof Error ? err.message : String(err);
    return { collector: c.name, subject, state: "error", kept: 0, refused: 0, stop: why };
  }
  const unit = { collector: c.name, subject, stop: got.stop ?? null };
  if (opts.dry) return { ...unit, state: got.state, kept: 0, refused: 0, drafts: got.signals };
  return atomic(base.db, async (tx) => {
    const tried = [...got.tried];
    let kept = 0;
    for (const d of got.signals) {
      const r = await keepSignal(tx, d);
      if (r.ok) kept += 1;
      else tried.push({ step: "keep", what: d.factKey, outcome: `refused: ${r.reason}` });
    }
    const state = got.state === "found" && kept === 0 ? "none" : got.state;
    const row = {
      state,
      found: kept,
      tried,
      answer: got.answer ?? null,
      retryAt: state === "capped" ? (got.retryAt ?? null) : null,
      runId: opts.runId ?? null,
      checkedAt: now,
    };
    await tx
      .insert(signalChecks)
      .values({ collector: c.name, subject, ...row })
      .onConflictDoUpdate({ target: [signalChecks.collector, signalChecks.subject], set: row });
    return { ...unit, state, kept, refused: got.signals.length - kept };
  });
}

export interface CollectorStats {
  selected: number;
  found: number;
  none: number;
  unresolved: number;
  capped: number;
  errors: number;
  kept: number;
  refused: number;
  stopped: string | null;
}
export interface SignalsStats {
  /** Subjects with a new answer written (capped ones excluded): the pool's progress. */
  checked: number;
  kept: number;
  collectors: Record<string, CollectorStats>;
}

export const emptySignalsStats = (): SignalsStats => ({ checked: 0, kept: 0, collectors: {} });

/** Start a collector's line from its plan. */
export function planStats(stats: SignalsStats, p: CollectorPlan): CollectorStats {
  const c: CollectorStats = {
    selected: p.subjects.length,
    found: 0,
    none: 0,
    unresolved: 0,
    capped: 0,
    errors: 0,
    kept: 0,
    refused: 0,
    stopped: p.why,
  };
  stats.collectors[p.name] = c;
  return c;
}

/** Count one unit; returns why its collector stops, or null. */
export function countSignalUnit(
  stats: SignalsStats,
  c: CollectorStats,
  u: SignalUnit | { ok: false; reason: string },
): string | null {
  if ("ok" in u) {
    c.errors += 1;
    return null;
  }
  if (u.state === "error") c.errors += 1;
  else c[u.state] += 1;
  if (u.state !== "error" && u.state !== "capped") stats.checked += 1;
  c.kept += u.kept;
  c.refused += u.refused;
  stats.kept += u.kept;
  if (u.stop) c.stopped = u.stop;
  return u.stop;
}

/**
 * Every collector over one pass, unit by unit, outside Restate (`wren enrich signals`). Each unit
 * is written as it finishes, so a rerun resumes. A unit's error is printed and passed over.
 */
export async function runSignals(
  collectors: readonly Collector[],
  settings: SignalsSettings,
  base: BaseDeps,
  opts: {
    pass: Pass;
    timezone: string;
    limit?: number;
    only?: string | null;
    dry?: boolean;
    runId?: string | null;
    onUnit?: (u: SignalUnit | { collector: string; subject: string; error: string }) => void;
  },
): Promise<SignalsStats> {
  const stats = emptySignalsStats();
  const plans = await signalPlan(base.db, collectors, settings, opts.pass, {
    now: new Date(),
    limit: opts.limit,
    only: opts.only,
  });
  for (const p of plans) {
    const line = planStats(stats, p);
    const c = collectors.find((x) => x.name === p.name) as Collector;
    for (const subject of p.subjects) {
      let u: SignalUnit | { ok: false; reason: string };
      try {
        u = await signalUnit(c, subject, p.settings, base, opts);
        opts.onUnit?.(u);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        u = { ok: false, reason };
        opts.onUnit?.({ collector: c.name, subject, error: reason });
      }
      if (countSignalUnit(stats, line, u)) break;
    }
  }
  return stats;
}

export type Signal = typeof researchSignals.$inferSelect;

/**
 * Signals about a firm or a person, newest first. A person's include their firm's. Copy and
 * briefs read through here; nothing is merged into `factsFor`.
 */
export async function signalsFor(
  db: Queryable,
  q: {
    companyId?: number;
    personId?: number;
    since?: Date;
    kinds?: readonly SignalKind[];
    limit?: number;
  },
): Promise<Signal[]> {
  const r = researchSignals;
  const who =
    q.personId !== undefined
      ? sql`(${r.personId} = ${q.personId} or (${r.personId} is null and ${r.companyId} = (select company_id from people where id = ${q.personId})))`
      : q.companyId !== undefined
        ? eq(r.companyId, q.companyId)
        : undefined;
  return db
    .select()
    .from(r)
    .where(
      and(
        who,
        q.since ? gte(r.at, q.since) : undefined,
        q.kinds?.length ? inArray(r.kind, [...q.kinds]) : undefined,
      ),
    )
    .orderBy(desc(r.at), desc(r.id))
    .limit(q.limit ?? 200);
}

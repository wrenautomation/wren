/**
 * The `profiles` stage: the lead sheet's LinkedIn columns for the people next in
 * line to be emailed, read from Exa's cache (nothing reaches linkedin.com). One
 * unit is one person: their profile (`lookUpPerson`), then their firm's page
 * (`lookUpCompany`) unless the firm was looked up already. Each unit writes
 * before the next starts, and a person or firm looked up is never picked again
 * unless a cap parked it, so a stop is a pause and a rerun resumes.
 *
 * Who is next is the caller's call (the email queue's order); this stage takes
 * person ids in that order and keeps the ones still due.
 *
 * Google is the free finder but a shared, signed-out browser leg: at most
 * `GOOGLE_PER_DAY` searches a local day across this stage, daytime only, none
 * for the rest of the day once one was stopped (a CAPTCHA). An Exa cap parks
 * the stage until it lifts; a failed Exa read stops the run.
 */
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import {
  linkedinCompany,
  lookUpCompany,
  type ProfileSubject,
  recordCompanyLookup,
} from "../companies/profile.js";
import { failedRead } from "../pacing.js";
import { htmlOf, type PageStore } from "../pages.js";
import { type LookupSubject, lookUpPerson } from "../people/lookup.js";
import { linkedinProfile } from "../people/profile-link.js";
import { recordLookup } from "../people/store.js";
import type { LookupState } from "../schema.js";

export const PROFILES_COMMAND = "enrich profiles";
/** Google searches this stage may spend a local day; the `web` site's cap (300) is shared. */
export const GOOGLE_PER_DAY = 200;
/** Local hours Google is asked in: [from, to). */
export const GOOGLE_HOURS = [8, 20] as const;
/** Errors in a row that stop the run: something is down, not one odd person. */
const ERROR_STREAK = 5;
/** Raw characters at most between a person's name and their profile link. */
const NAME_WINDOW = 600;

export interface ProfileWork {
  person: LookupSubject;
  company: ProfileSubject;
}

export interface ProfileUnit {
  personId: number;
  person: LookupState | "error";
  /** `done` = looked up before; `skipped` = the person's read was capped or failed. */
  company: LookupState | "done" | "skipped" | "error";
  /** Google searches this unit spent, stopped ones too. */
  google: number;
  googleStopped: boolean;
  /** An Exa cap parked the stage. */
  capped: boolean;
  /** A metered read failed: stop asking for the run. */
  failedRead: boolean;
  error: string | null;
}

export interface ProfileStats {
  selected: number;
  people_matched: number;
  people_unresolved: number;
  companies_matched: number;
  companies_unresolved: number;
  google: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of people. */
  stopped: string | null;
}

export const emptyProfileStats = (): ProfileStats => ({
  selected: 0,
  people_matched: 0,
  people_unresolved: 0,
  companies_matched: 0,
  companies_unresolved: 0,
  google: 0,
  errors: 0,
  stopped: null,
});

const due = (table: "person_lookups" | "company_lookups", column: string, id: SQL) =>
  sql`not exists (select 1 from ${sql.raw(table)} l where l.${sql.raw(column)} = ${id}
    and (l.state <> 'capped' or l.retry_at > now()))`;
const personDue = (id: SQL) => due("person_lookups", "person_id", id);
const companyDue = (id: SQL) => due("company_lookups", "company_id", id);

/**
 * When a cap parked this stage, until when: the latest cap one of its runs hit
 * that has not lifted. null = not parked.
 */
export async function profilesParkedUntil(db: Queryable): Promise<Date | null> {
  const [row] = await db.execute<{ until: string | null }>(sql`
    select max(l.retry_at) as until from (
      select retry_at, run_id from person_lookups where state = 'capped' and retry_at > now()
      union all
      select retry_at, run_id from company_lookups where state = 'capped' and retry_at > now()
    ) l join runs r on r.id = l.run_id
    where r.command = ${PROFILES_COMMAND}`);
  return row?.until ? new Date(row.until) : null;
}

/** The local hour in an IANA zone. */
const localHour = (now: Date, timezone: string): number =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .find((p) => p.type === "hour")?.value ?? 0,
  );

/**
 * Google searches this stage may still spend today: none outside daytime or
 * once a search was stopped today, else what is left of `perDay`.
 */
export async function googleLeft(
  db: Queryable,
  opts: { now: Date; timezone: string; perDay?: number },
): Promise<number> {
  const hour = localHour(opts.now, opts.timezone);
  if (hour < GOOGLE_HOURS[0] || hour >= GOOGLE_HOURS[1]) return 0;
  const midnight = sql`(date_trunc('day', ${opts.now.toISOString()}::timestamptz at time zone ${opts.timezone}) at time zone ${opts.timezone})`;
  const [row] = await db.execute<{ spent: number; stopped: boolean }>(sql`
    with today as (
      select t from person_lookups l, jsonb_array_elements(l.tried) t where l.looked_up_at >= ${midnight}
      union all
      select t from company_lookups l, jsonb_array_elements(l.tried) t where l.looked_up_at >= ${midnight}
    )
    select count(*)::int as spent, coalesce(bool_or(t ->> 'outcome' like 'stopped%'), false) as stopped
    from today where t ->> 'step' = 'google'`);
  if (!row || row.stopped) return 0;
  return Math.max(0, (opts.perDay ?? GOOGLE_PER_DAY) - row.spent);
}

const HREF = /href\s*=\s*["']([^"']*linkedin\.com\/(?:in|company)\/[^"']*)["']/gi;
const letters = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
/** A vanity that spells the first or last name, or says nothing (a member id). */
function couldBe(vanity: string, who: { first: string | null; last: string | null }): boolean {
  if (/^ACo[\w-]{8,}$/.test(vanity)) return true;
  const v = letters(decodeURIComponent(vanity));
  return [who.first, who.last].some((n) => {
    const l = letters(n ?? "");
    return l.length >= 2 && v.includes(l);
  });
}
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Markup that may sit between a first and last name in a card. */
const GAP = String.raw`(?:\s|&nbsp;|&#160;|<[^>]*>)+`;

/**
 * LinkedIn links on a firm's own page: company pages anywhere (footers), and,
 * for each place the page spells this person's full name, the nearest profile
 * link that could be theirs (a team page's card). Cards sit side by side and
 * some have no link, so a link whose vanity spells another name is never taken
 * for this person; an opaque member id may be.
 */
export function linkedinLinks(
  html: string,
  who: { first: string | null; last: string | null },
): { people: string[]; companies: string[] } {
  const firms = new Set<string>();
  const profiles: { at: number; url: string }[] = [];
  for (const m of html.matchAll(HREF)) {
    const href = (m[1] as string).replace(/&amp;/gi, "&");
    if (linkedinCompany(href)) {
      firms.add(href);
      continue;
    }
    const profile = linkedinProfile(href);
    if (profile && couldBe(profile.vanity, who))
      profiles.push({ at: m.index ?? 0, url: profile.url });
  }
  const people = new Set<string>();
  const first = who.first?.trim();
  const last = who.last?.trim();
  if (first && last && profiles.length > 0) {
    // A middle name or initial may sit between; word edges keep "Jane" out of "Janet".
    const name = new RegExp(
      String.raw`(?<![\p{L}\p{N}])${literal(first)}${GAP}(?:[\p{L}.'-]+${GAP})?${literal(last)}(?![\p{L}\p{N}])`,
      "giu",
    );
    for (const m of html.matchAll(name)) {
      const at = m.index ?? 0;
      const nearest = profiles.reduce((a, b) =>
        Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a,
      );
      if (Math.abs(nearest.at - at) <= NAME_WINDOW) people.add(nearest.url);
    }
  }
  return { people: [...people], companies: [...firms] };
}

interface WorkRow extends Record<string, unknown> {
  person_id: number;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  company_id: number;
  firm_name: string | null;
  firm_domain: string | null;
  company_linkedin: string | null;
}
interface PageRow extends Record<string, unknown> {
  company_id: number;
  html: string | null;
  html_key: string | null;
}

/**
 * The due people among `personIds`, in that order, at most `limit`, each with
 * their firm and the LinkedIn links on the firm's own pages. `again` takes
 * people looked up before too.
 */
export async function profileWork(
  db: Queryable,
  personIds: readonly number[],
  opts: { limit?: number; again?: boolean; pages?: PageStore | null } = {},
): Promise<ProfileWork[]> {
  if (personIds.length === 0) return [];
  const ids = sql.join(
    personIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<WorkRow>(sql`
    select p.id person_id, p.first_name, p.last_name, p.linkedin_url,
      c.id company_id, c.name firm_name, c.domain firm_domain, c.linkedin_url company_linkedin
    from unnest(array[${ids}]::int[]) with ordinality as q(id, ord)
    join people p on p.id = q.id
    join companies c on c.id = p.company_id
    where ${opts.again ? sql`true` : personDue(sql`p.id`)}
    order by q.ord
    limit ${opts.limit ?? 1_000_000}`);
  if (rows.length === 0) return [];
  const companyIds = sql.join(
    [...new Set(rows.map((r) => r.company_id))].map((id) => sql`${id}`),
    sql`, `,
  );
  const pages = await db.execute<PageRow>(sql`
    select company_id, html, html_key from documents
    where company_id in (${companyIds}) and kind <> 'profile'
      and (html is not null or html_key is not null)
    order by id`);
  const html = new Map<number, string[]>();
  for (const p of pages) {
    // An archived page with no store to read it from is a page we cannot see, not a failure.
    const text = await htmlOf({ html: p.html, htmlKey: p.html_key }, opts.pages).catch(() => null);
    if (text) html.set(p.company_id, [...(html.get(p.company_id) ?? []), text]);
  }
  return rows.map((r) => {
    const found = (html.get(r.company_id) ?? []).map((h) =>
      linkedinLinks(h, { first: r.first_name, last: r.last_name }),
    );
    const firm = { name: r.firm_name, domain: r.firm_domain };
    return {
      person: {
        personId: r.person_id,
        firstName: r.first_name,
        lastName: r.last_name,
        firm,
        linkedinUrl: r.linkedin_url,
        pageLinks: [...new Set(found.flatMap((f) => f.people))],
        email: null,
      },
      company: {
        companyId: r.company_id,
        firm,
        linkedinUrl: r.company_linkedin,
        pageLinks: [...new Set(found.flatMap((f) => f.companies))],
      },
    };
  });
}

const googleSpent = (tried: { step: string }[]) => tried.filter((t) => t.step === "google").length;

/**
 * One person, then their firm. Never throws: a site error is the unit's result,
 * so a durable runner never retries a metered read.
 */
export async function profileUnit(
  db: Queryable,
  sites: SiteClient,
  work: ProfileWork,
  opts: {
    googleLeft: number;
    runId?: string | null;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<ProfileUnit> {
  const unit: ProfileUnit = {
    personId: work.person.personId,
    person: "error",
    company: "skipped",
    google: 0,
    googleStopped: false,
    capped: false,
    failedRead: false,
    error: null,
  };
  const timing = {
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };
  const runId = opts.runId ?? null;
  try {
    const person = await lookUpPerson(sites, work.person, {
      linkedin: null,
      google: opts.googleLeft > 0,
      ...timing,
    });
    await recordLookup(db, work.person.personId, person, runId);
    unit.person = person.state;
    unit.google += googleSpent(person.tried);
    unit.googleStopped = person.googleStopped !== null;
    if (person.state === "capped") {
      unit.capped = true;
      return unit;
    }
    const [open] = await db.execute<{ due: boolean }>(
      sql`select ${companyDue(sql`${work.company.companyId}`)} as due`,
    );
    if (!open?.due) {
      unit.company = "done";
      return unit;
    }
    unit.company = "error";
    // The matched role's own page link comes free with the person's read.
    const there = person.findings.find((f) => f.kind === "still_there");
    const companyUrl = (there?.value as { companyUrl?: string | null } | undefined)?.companyUrl;
    const company = await lookUpCompany(
      sites,
      { ...work.company, personCompanyUrl: companyUrl ?? null },
      { google: !unit.googleStopped && opts.googleLeft - unit.google > 0, ...timing },
    );
    await recordCompanyLookup(db, work.company.companyId, company, runId);
    unit.company = company.state;
    unit.google += googleSpent(company.tried);
    unit.googleStopped ||= company.googleStopped !== null;
    unit.capped = company.state === "capped";
    return unit;
  } catch (err) {
    unit.error = (err as Error).message;
    unit.failedRead = failedRead(err, "web");
    return unit;
  }
}

/** Fold one unit into the run's stats; the reason to stop, or null to go on. */
export function countProfileUnit(
  stats: ProfileStats,
  u: ProfileUnit,
  streak: { errors: number },
): string | null {
  stats.google += u.google;
  if (u.person === "matched") stats.people_matched += 1;
  if (u.person === "unresolved") stats.people_unresolved += 1;
  if (u.company === "matched") stats.companies_matched += 1;
  if (u.company === "unresolved") stats.companies_unresolved += 1;
  if (u.error === null) streak.errors = 0;
  else {
    stats.errors += 1;
    streak.errors += 1;
  }
  if (u.failedRead) return `web failed a read, so stopped asking it: ${u.error}`;
  if (u.capped) return "Exa's daily cap: parked until it lifts";
  if (streak.errors >= ERROR_STREAK) return `${ERROR_STREAK} errors in a row: ${u.error}`;
  return null;
}

export interface RunProfilesOptions {
  /** People in the order they will be emailed; the due ones are looked up. */
  personIds: readonly number[];
  limit?: number;
  /** The zone Google's day and hours are kept in. */
  timezone: string;
  googlePerDay?: number;
  again?: boolean;
  pages?: PageStore | null;
  runId?: string | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** One line per person, for an operator watching. */
  onUnit?: (u: ProfileUnit) => void;
  /** Recompute the firm's lead cross-checks after each person (channel-email's `recheckLeads`). */
  recheck?: (companyIds: number[]) => Promise<unknown>;
}

/** The stage as a plain loop, for the CLI; the Restate handler journals the same steps. */
export async function runProfiles(
  db: Queryable,
  sites: SiteClient,
  opts: RunProfilesOptions,
): Promise<ProfileStats> {
  const stats = emptyProfileStats();
  const clock = opts.now ?? (() => new Date());
  const parked = await profilesParkedUntil(db);
  if (parked) {
    stats.stopped = `parked by a cap until ${parked.toISOString()}`;
    return stats;
  }
  const work = await profileWork(db, opts.personIds, opts);
  stats.selected = work.length;
  let left = await googleLeft(db, {
    now: clock(),
    timezone: opts.timezone,
    ...(opts.googlePerDay !== undefined ? { perDay: opts.googlePerDay } : {}),
  });
  const streak = { errors: 0 };
  for (const w of work) {
    const u = await profileUnit(db, sites, w, {
      googleLeft: left,
      runId: opts.runId ?? null,
      now: clock,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
    await opts.recheck?.([w.company.companyId]);
    opts.onUnit?.(u);
    left = u.googleStopped ? 0 : Math.max(0, left - u.google);
    stats.stopped = countProfileUnit(stats, u, streak);
    if (stats.stopped) break;
  }
  return stats;
}

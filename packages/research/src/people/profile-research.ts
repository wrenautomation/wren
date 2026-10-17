/**
 * "Research this person" on a profile: who to look for (`subjectOf`), what a lookup found as
 * findings on the profile (`findingsOf`), and the rows that carry a run (`profile_lookups`,
 * `profile_findings`). A finding is one ref per thing: found again, it updates its confidence
 * and link but never its `state`, so a dropped finding stays dropped.
 * Pure over the database; the run itself is `restate/profile-research.ts`.
 */
import { isFreemail, parseName } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import {
  type ProfileFindingKind,
  profileFindings,
  profileLookups,
} from "@wren/core/profiles-schema";
import { atomic, type Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { googleLeft, linkedinParkedUntil } from "../enrichment/profiles.js";
import { pgSafe } from "../findings.js";
import type { ReadLedger } from "../linkedin-reads.js";
import { failedRead } from "../pacing.js";
import { type LookupResult, type LookupSubject, lookUpPerson, searched } from "./lookup.js";
import { companyPhrase, type Firm } from "./names.js";
import { linkedinProfile } from "./profile-link.js";

/** What a profile holds that a lookup can use: read once, mapped by `subjectOf`. */
export interface ProfileFacts {
  name: string | null;
  emails: string[];
  handles: { platform: string; handle: string; url: string | null }[];
  /** The research row its `person` key names, with its firm. */
  person: {
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
  } | null;
  /** Kept `employer` findings ("Title at Firm"), newest first. */
  employers: string[];
}

/** The firm in "Title at Firm". */
export function firmOfRole(role: string): string | null {
  const at = role.search(/\s+at\s+(?!.*\s+at\s+)/i);
  const firm = (at < 0 ? role : role.slice(at).replace(/^\s+at\s+/i, "")).trim();
  return firm || null;
}

/** The firm to match on: the research person's company, else a work email's domain, else a kept role. */
export function firmOf(f: ProfileFacts): Firm {
  if (f.person && (f.person.company || f.person.domain))
    return { name: f.person.company, domain: f.person.domain };
  for (const email of f.emails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !isFreemail(domain)) return { name: null, domain };
  }
  for (const role of f.employers) {
    const name = firmOfRole(role);
    if (name) return { name, domain: null };
  }
  return { name: null, domain: null };
}

/** The profile's LinkedIn page, when a key or the research row holds one. */
function linkedinUrlOf(f: ProfileFacts): string | null {
  for (const h of f.handles) {
    if (h.platform !== "linkedin") continue;
    const link = h.url ? linkedinProfile(h.url) : null;
    if (link) return link.url;
    if (/^[a-z0-9_%-]{2,100}$/.test(h.handle) && !h.handle.startsWith("company:"))
      return `https://www.linkedin.com/in/${h.handle}/`;
  }
  const own = f.person?.linkedinUrl ? linkedinProfile(f.person.linkedinUrl) : null;
  return own?.url ?? null;
}

/** Who to look for. A one-word name has no last name, so no layer matches on it by name. */
export function subjectOf(f: ProfileFacts): LookupSubject {
  const name = f.name?.trim() || f.person?.fullName || null;
  const parsed = name ? parseName(name) : null;
  const first = parsed ? parsed[1] : (f.person?.firstName ?? null);
  const last = parsed ? parsed[2] : (f.person?.lastName ?? null);
  return {
    personId: null,
    firstName: first,
    lastName: last,
    firm: firmOf(f),
    linkedinUrl: linkedinUrlOf(f),
    email: null,
    handles: f.handles.map((h) => ({ platform: h.platform, handle: h.handle })),
  };
}

type Rows<T> = T[];

/** Read what a profile holds. */
export async function readProfileFacts(db: Queryable, profileId: number): Promise<ProfileFacts> {
  const [profile] = (await db.execute(
    sql`select name from profiles where id = ${profileId}`,
  )) as unknown as Rows<{ name: string | null }>;
  const keys = (await db.execute(sql`
    select kind, value from profile_keys
    where profile_id = ${profileId} and (kind in ('email', 'person') or kind like 'handle:%')
    order by first_seen, id`)) as unknown as Rows<{ kind: string; value: string }>;
  const handleKeys = keys.filter((k) => k.kind.startsWith("handle:"));
  const stored = handleKeys.length
    ? ((await db.execute(sql`
        select platform, handle, url, person_id from social_handles
        where (platform, handle) in (${sql.join(
          handleKeys.map((k) => sql`(${k.kind.slice(7)}, ${k.value})`),
          sql`, `,
        )})`)) as unknown as Rows<{
        platform: string;
        handle: string;
        url: string | null;
        person_id: number | null;
      }>)
    : [];
  const personId =
    Number(keys.find((k) => k.kind === "person")?.value) ||
    stored.find((h) => h.person_id)?.person_id ||
    null;
  const [person] = personId
    ? ((await db.execute(sql`
        select p.full_name, p.first_name, p.last_name, p.title, p.linkedin_url,
          co.name company, co.domain
        from people p left join companies co on co.id = p.company_id
        where p.id = ${personId}`)) as unknown as Rows<{
        full_name: string;
        first_name: string | null;
        last_name: string | null;
        title: string | null;
        linkedin_url: string | null;
        company: string | null;
        domain: string | null;
      }>)
    : [];
  const employers = (await db.execute(sql`
    select value from profile_findings
    where profile_id = ${profileId} and kind = 'employer' and state = 'kept'
    order by decided_at desc nulls last, id desc`)) as unknown as Rows<{ value: string }>;
  return {
    name: profile?.name ?? null,
    emails: keys.filter((k) => k.kind === "email").map((k) => k.value),
    handles: handleKeys.map((k) => {
      const platform = k.kind.slice(7);
      const got = stored.find((h) => h.platform === platform && h.handle === k.value);
      return { platform, handle: k.value, url: got?.url ?? null };
    }),
    person: person
      ? {
          fullName: person.full_name,
          firstName: person.first_name,
          lastName: person.last_name,
          title: person.title,
          company: person.company,
          domain: person.domain,
          linkedinUrl: person.linkedin_url,
        }
      : null,
    employers: employers.map((e) => e.value),
  };
}

// ---- findings --------------------------------------------------------------------------

/** One finding to store; `ref` is its identity on the profile. */
export interface FindingRow {
  kind: ProfileFindingKind;
  platform: string | null;
  value: string;
  url: string | null;
  source: "cache" | "google" | "search" | "linkedin" | "elsewhere";
  confidence: number;
  detail: Record<string, unknown>;
  ref: string;
}

const REF_MAX = 400;
const refOf = (kind: string, platform: string | null, value: string) =>
  `${kind}:${platform ?? ""}:${value}`.slice(0, REF_MAX);

/** Which lookup step settled the profile match: the account, a Google hit, the cache, search. */
function sourceOfMatch(r: LookupResult): FindingRow["source"] {
  const vanity = r.profile?.vanity ?? "";
  const lines = r.tried.filter(
    (t) => t.outcome === "matched" || t.outcome.includes(`${vanity}: matched`),
  );
  const last = lines.at(-1);
  if (last?.step === "profile") return "linkedin";
  if (last?.step === "search") return "search";
  if (last?.what.endsWith("(google)")) return "google";
  return "cache";
}

/** The role a reading says they hold now: "Title at Firm". */
function roleOf(
  r: LookupResult,
): { text: string; firm: string; detail: Record<string, unknown> } | null {
  for (const f of r.findings) {
    if (f.kind !== "still_there" && f.kind !== "job_change") continue;
    const v = f.value as { company?: string; to?: string; title?: string; dates?: string | null };
    const firm = (f.kind === "still_there" ? v.company : v.to)?.trim();
    if (!firm) continue;
    const title = v.title?.trim();
    return {
      text: title ? `${title} at ${firm}` : firm,
      firm,
      detail: { ...v, kind: f.kind, via: f.via },
    };
  }
  return null;
}

/**
 * The findings a lookup gives a profile: the LinkedIn page it matched, the role read there, and
 * every page found elsewhere. A handle the profile already holds is no finding. The same page
 * found twice keeps the surer reading.
 */
export function findingsOf(
  r: LookupResult,
  held: { platform: string; handle: string }[] = [],
): FindingRow[] {
  const have = new Set(held.map((h) => `${h.platform}:${h.handle}`));
  const out = new Map<string, FindingRow>();
  const add = (row: FindingRow) => {
    const had = out.get(row.ref);
    if (!had || had.confidence < row.confidence) out.set(row.ref, row);
  };
  const source = sourceOfMatch(r);
  if (r.profile && !have.has(`linkedin:${r.profile.vanity}`))
    add({
      kind: "handle",
      platform: "linkedin",
      value: r.profile.vanity,
      url: r.profile.url,
      source,
      confidence: source === "linkedin" ? 0.9 : 0.8,
      detail: { matchedBy: source },
      ref: refOf("handle", "linkedin", r.profile.vanity),
    });
  const role = r.profile ? roleOf(r) : null;
  if (role)
    add({
      kind: "employer",
      platform: null,
      value: role.text.slice(0, 300),
      url: r.profile?.url ?? null,
      source,
      confidence: source === "linkedin" ? 0.9 : 0.8,
      detail: role.detail,
      ref: refOf("employer", null, companyPhrase(role.firm) || role.firm.toLowerCase()),
    });
  for (const h of r.elsewhere ?? []) {
    if (h.kind === "handle" && have.has(`${h.platform}:${h.value}`)) continue;
    add({
      kind: h.kind,
      platform: h.platform,
      value: h.kind === "handle" ? h.value : (h.title || h.value).slice(0, 300),
      url: h.url,
      source: "elsewhere",
      confidence: h.confidence,
      detail: { title: h.title, matched: h.matched, query: h.query },
      ref: refOf(h.kind, h.platform, h.value),
    });
  }
  return [...out.values()].sort((a, b) => b.confidence - a.confidence);
}

// ---- rows ------------------------------------------------------------------------------

/** The words for a failure on a run's page: what stopped, not a stack. */
export function errorWords(err: unknown): string {
  if (err instanceof SiteCallError) {
    const why = err.message.replace(/\s+/g, " ").slice(0, 160);
    return err.status >= 500
      ? `The ${err.site} site failed (${err.status}): ${why}`
      : `The ${err.site} site refused the request (${err.status}): ${why}`;
  }
  const text = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ");
  return text.slice(0, 300) || "The run failed.";
}

/**
 * A queued run starts: marked running with what it searches by. Null when the row is gone or
 * already finished (a stale send), so nothing runs twice.
 */
export async function beginProfileResearch(
  db: Queryable,
  lookupId: number,
): Promise<{ profileId: number; subject: LookupSubject } | null> {
  const [row] = await db
    .select({ profileId: profileLookups.profileId, state: profileLookups.state })
    .from(profileLookups)
    .where(eq(profileLookups.id, lookupId));
  if (!row || (row.state !== "queued" && row.state !== "running")) return null;
  const subject = subjectOf(await readProfileFacts(db, row.profileId));
  await db
    .update(profileLookups)
    .set({
      state: "running",
      startedAt: sql`coalesce(${profileLookups.startedAt}, now())`,
      subject: pgSafe(subject),
      tried: [],
      error: null,
    })
    .where(eq(profileLookups.id, lookupId));
  return { profileId: row.profileId, subject };
}

/** Write a finished lookup: its findings (state kept), then the run's row. */
export async function recordProfileResearch(
  db: Queryable,
  lookupId: number,
  profileId: number,
  r: LookupResult,
  held: { platform: string; handle: string }[] = [],
): Promise<{ findings: number }> {
  const rows = findingsOf(r, held);
  await atomic(db, async (tx) => {
    for (const f of rows) {
      const fresh = {
        lookupId,
        platform: f.platform,
        value: f.value,
        url: f.url,
        source: f.source,
        confidence: f.confidence,
        detail: pgSafe(f.detail),
        at: sql`now()`,
      };
      // On a repeat: what was found moves; what was decided (state, decidedBy, decidedAt) stays.
      await tx
        .insert(profileFindings)
        .values({ profileId, kind: f.kind, ref: f.ref, ...fresh })
        .onConflictDoUpdate({
          target: [profileFindings.profileId, profileFindings.ref],
          set: fresh,
        });
    }
    await tx
      .update(profileLookups)
      .set({
        state: "done",
        tried: pgSafe(r.tried),
        outcome: r.state,
        error: null,
        retryAt: r.retryAt,
        finishedAt: sql`now()`,
      })
      .where(eq(profileLookups.id, lookupId));
  });
  return { findings: rows.length };
}

/** A run that could not finish: failed, with the reason in words. */
export async function failProfileResearch(
  db: Queryable,
  lookupId: number,
  error: string,
): Promise<void> {
  await db
    .update(profileLookups)
    .set({ state: "failed", error: error.slice(0, 1000), finishedAt: sql`now()` })
    .where(
      and(eq(profileLookups.id, lookupId), inArray(profileLookups.state, ["queued", "running"])),
    );
}

// ---- the run ---------------------------------------------------------------------------

/** What the day leaves for a run: Google searches, and until when LinkedIn's account is capped. */
export async function researchPlan(
  db: Queryable,
  o: { now: Date; timezone: string },
): Promise<{ google: number; linkedinUntil: string | null }> {
  return {
    google: await googleLeft(db, o),
    linkedinUntil: (await linkedinParkedUntil(db))?.toISOString() ?? null,
  };
}

export type ProfileResearchResult =
  | {
      ok: true;
      /** Null: nothing to run (the row is gone or already finished). */
      state: LookupResult["state"] | null;
      findings: number;
      google: number;
    }
  | { ok: false; error: string; failedRead: boolean };

/**
 * One run: who to look for, the lookup with the elsewhere layer on, the findings. Never throws:
 * a site error ends the run as `failed` with the reason in words and comes back as data, so a
 * durable runner never retries a metered read.
 */
export async function researchProfile(
  db: Queryable,
  sites: SiteClient,
  lookupId: number,
  opts: {
    /** Google searches the day still allows. */
    googleLeft: number;
    /** The LinkedIn account for logged-in reads; null or still capped = never log in. */
    linkedin?: string | null;
    linkedinCappedUntil?: Date | null;
    ledger?: ReadLedger | null;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<ProfileResearchResult> {
  try {
    const begun = await beginProfileResearch(db, lookupId);
    if (!begun) return { ok: true, state: null, findings: 0, google: 0 };
    try {
      const now = opts.now?.() ?? new Date();
      const linkedinOpen = !opts.linkedinCappedUntil || opts.linkedinCappedUntil <= now;
      const account = linkedinOpen ? (opts.linkedin ?? null) : null;
      const room = account && opts.ledger ? await opts.ledger.room() : null;
      const result = await lookUpPerson(sites, begun.subject, {
        linkedin: account,
        google: opts.googleLeft > 0,
        elsewhere: true,
        ...(room === null ? {} : { accountReads: room }),
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
      });
      // Who served this LinkedIn read: the account when it was asked, else search when it ran.
      if (result.accountReads > 0) await opts.ledger?.served("account", result.accountReads);
      else if (result.tried.some(searched)) await opts.ledger?.served("search");
      const { findings } = await recordProfileResearch(
        db,
        lookupId,
        begun.profileId,
        result,
        begun.subject.handles ?? [],
      );
      return {
        ok: true,
        state: result.state,
        findings,
        google: result.tried.filter((t) => t.step === "google").length,
      };
    } catch (err) {
      const error = errorWords(err);
      await failProfileResearch(db, lookupId, error);
      return { ok: false, error, failedRead: failedRead(err, "web") };
    }
  } catch (err) {
    // The rows themselves failed: nothing to mark. The caller keeps the words.
    return { ok: false, error: errorWords(err), failedRead: false };
  }
}

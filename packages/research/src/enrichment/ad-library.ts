/**
 * The `adLibrary` stage (designs/2026-10-05-social-reads.md): firms running Facebook ads now, by
 * niche keyword. autobrowse reads Meta's Ad Library signed out on the Mac (`fb-public` `GET /ads`,
 * a built walk), and each read is one import of source `ad_library`: one row per ad, so every ad is
 * a sighting kept whole. A firm is its ad's link domain; an advertiser whose ads link nowhere of
 * its own is keyed by its Facebook page (`fb:<page>`), never dropped. Each keyword is read again
 * every AD_KEYWORD_EVERY_DAYS, paced by a bucket over the imports. $0: a browser on the Mac.
 */
import {
  companies,
  extractDomain,
  IDENTITY_KEY,
  isPlatformDomain,
  type LeadSource,
  type RawRow,
  registrableDomain,
  runImport,
  sightings,
} from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { atomic, type Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { type Bucket, bucketRoom, refusedBy, retryAfter } from "../pacing.js";

export const AD_LIBRARY_COMMAND = "enrich ad-library";
export const AD_LIBRARY_SOURCE = "ad_library";
/**
 * Keyword reads a day; autobrowse caps `fb-public` at 200 and spaces each 20 to 40s. The burst is
 * the daily amount: an idle pool sleeps to the next local day, so it only ever gets a burst a day.
 */
export const AD_LIBRARY_BUCKET: Bucket = { perDay: 48, burst: 48 };
/** Ads come and go; a keyword's advertisers are read again after this. */
export const AD_KEYWORD_EVERY_DAYS = 7;
export const AD_COUNTRY = "US";
/** Where an ad links that is a form, a chat or a funnel builder, never the advertiser's own site. */
export const AD_HOSTS = [
  "fb.me",
  "m.me",
  "messenger.com",
  "wa.me",
  "whatsapp.com",
  "leadconnectorhq.com",
  "msgsndr.com",
  "typeform.com",
  "jotform.com",
  "forms.gle",
  "eventbrite.com",
  "apps.apple.com",
  "clickfunnels.com",
  "myclickfunnels.com",
  "hs-sites.com",
] as const;

/** One ad as `fb-public` `GET /ads` answers it: every field the walk read, kept whole. */
export interface Ad {
  libraryId: string;
  advertiser: string | null;
  page?: string | null;
  url?: string | null;
  caption?: string | null;
  [field: string]: unknown;
}

/** `fb-public/ads?q=...&country=US`: one keyword's reads share it, so its last read is findable. */
export const adRef = (q: string, country = AD_COUNTRY): string =>
  `fb-public/ads?${new URLSearchParams({ q, country })}`;

/** The advertiser's own site from an ad's link or shown caption; null for a platform or form. */
export function adDomain(ad: Ad, platforms: Iterable<string> = []): string | null {
  const extra = [...AD_HOSTS, ...platforms];
  for (const raw of [ad.url, ad.caption]) {
    const host = typeof raw === "string" && raw.trim() ? extractDomain(raw) : null;
    if (host && !isPlatformDomain(host, extra)) return registrableDomain(host);
  }
  return null;
}

/** `fb:<page>` from the advertiser's page link (`facebook.com/DryHome/` is `fb:dryhome`). */
export function pageKey(ad: Ad): string {
  const path = ad.page ? new URL(ad.page, "https://www.facebook.com").pathname : "";
  const slug = path.replace(/^\/+|\/+$/g, "").toLowerCase();
  return `fb:${slug || `ad-${ad.libraryId}`}`.slice(0, 64);
}

/**
 * One row per ad, the ad whole under `ad`. An advertiser's ads share its domain: one ad that
 * links home is enough for all of them, so the page key is only for one that never does.
 */
export function adRows(ads: readonly Ad[], q: string, platforms: Iterable<string> = []): RawRow[] {
  const homes = adHomes(ads, platforms);
  return ads.map((ad) => {
    const domain = homes.get(pageKey(ad)) ?? null;
    return {
      company_name: ad.advertiser,
      website: domain ?? ad.page ?? null,
      keyword: q,
      ad,
      ...(domain ? {} : { [IDENTITY_KEY]: { source_key: pageKey(ad) } }),
    };
  });
}

/** Each page's home: the first domain any of its ads links. */
export function adHomes(ads: Iterable<Ad>, platforms: Iterable<string> = []): Map<string, string> {
  const extra = [...platforms];
  const homes = new Map<string, string>();
  for (const ad of ads) {
    const d = adDomain(ad, extra);
    if (d && !homes.has(pageKey(ad))) homes.set(pageKey(ad), d);
  }
  return homes;
}

export type PageMerge = "none" | "took-domain" | "folded";

/**
 * A page-keyed firm whose page now links `domain` is that domain's firm. With no firm on the
 * domain it takes the domain and keeps its key. Else it folds in: every row with a company FK
 * moves to the domain firm, the old firm is kept whole as a sighting there, and its key becomes
 * the domain firm's when that has none. One transaction; a second run finds nothing to do.
 */
export async function mergePageFirm(
  db: Queryable,
  key: string,
  domain: string,
): Promise<PageMerge> {
  return atomic(db, async (tx) => {
    const [from] = await tx.select().from(companies).where(eq(companies.sourceKey, key)).limit(1);
    if (!from || from.domain !== null) return "none";
    const [to] = await tx.select().from(companies).where(eq(companies.domain, domain)).limit(1);
    if (!to) {
      await tx.update(companies).set({ domain }).where(eq(companies.id, from.id));
      return "took-domain";
    }
    // Every FK to companies, from the catalog, so a table added later moves too.
    const refs = await tx.execute<{ tbl: string; col: string }>(sql`
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'companies'::regclass`);
    for (const r of refs)
      await tx.execute(
        sql`update ${sql.raw(r.tbl)} set ${sql.identifier(r.col)} = ${to.id} where ${sql.identifier(r.col)} = ${from.id}`,
      );
    await tx.insert(sightings).values({
      companyId: to.id,
      // ponytail: a firm with no import of its own borrows the survivor's; both null rolls back.
      importId: (from.importId ?? to.importId) as number,
      rowNumber: 0,
      raw: { merged_from: from },
    });
    await tx.delete(companies).where(eq(companies.id, from.id));
    // Fill blanks, never overwrite; the page key stays the alias later page-only ads match on.
    // ponytail: a survivor with its own key keeps only the sighting; the next linking ad re-merges.
    await tx
      .update(companies)
      .set({
        sourceKey: to.sourceKey ?? key,
        name: to.name ?? from.name,
        socialUrl: to.socialUrl ?? from.socialUrl,
        linkedinUrl: to.linkedinUrl ?? from.linkedinUrl,
        country: to.country ?? from.country,
        niche: to.niche ?? from.niche,
        timezone: to.timezone ?? from.timezone,
      })
      .where(eq(companies.id, to.id));
    return "folded";
  });
}

/** Page-keyed firms on file whose page a held Ad Library ad links to a domain firm. */
export async function pageFirmPairs(db: Queryable): Promise<{ key: string; domain: string }[]> {
  const rows = await db.execute<{ domain: string; ad: Ad }>(sql`
    select c.domain, x.raw->'ad' as ad
    from (
      select s.company_id, s.raw from sightings s join imports i on i.id = s.import_id
      where i.source_type = ${AD_LIBRARY_SOURCE}
      union all
      select c.id, c.raw from companies c join imports i on i.id = c.import_id
      where i.source_type = ${AD_LIBRARY_SOURCE}
    ) x
    join companies c on c.id = x.company_id
    where c.domain is not null and x.raw ? 'ad'
    order by c.id`);
  const homes = new Map<string, string>();
  for (const r of rows) if (!homes.has(pageKey(r.ad))) homes.set(pageKey(r.ad), r.domain);
  const keyed = await db.execute<{ key: string }>(sql`
    select source_key as key from companies where source_key like 'fb:%' and domain is null`);
  return keyed.flatMap(({ key }) => {
    const domain = homes.get(key);
    return domain ? [{ key, domain }] : [];
  });
}

/** Keyword reads left in the bucket now, and how long until the next when none. */
export async function adLibraryRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = AD_LIBRARY_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  const rows = await db.execute<{ at: string }>(sql`
    select imported_at as at from imports
    where source_type = ${AD_LIBRARY_SOURCE}
      and imported_at > ${now.toISOString()}::timestamptz - interval '2 days'
    order by imported_at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
}

/** The niche's keywords due a read: never read first, then the longest ago. */
export async function adKeywordsDue(
  db: Queryable,
  keywords: readonly string[],
  opts: { now: Date; limit: number; country?: string },
): Promise<string[]> {
  if (keywords.length === 0 || opts.limit <= 0) return [];
  const refs = keywords.map((q) => adRef(q, opts.country));
  const rows = await db.execute<{ ref: string; at: string }>(sql`
    select source_ref as ref, max(imported_at) as at from imports
    where source_type = ${AD_LIBRARY_SOURCE}
      and source_ref in (${sql.join(
        refs.map((r) => sql`${r}`),
        sql`, `,
      )})
    group by source_ref`);
  const last = new Map(rows.map((r) => [r.ref, new Date(r.at).getTime()]));
  const due = opts.now.getTime() - AD_KEYWORD_EVERY_DAYS * 86_400_000;
  return keywords
    .map((q, i) => ({ q, at: last.get(refs[i] as string) ?? 0 }))
    .filter((k) => k.at <= due)
    .sort((a, b) => a.at - b.at)
    .slice(0, opts.limit)
    .map((k) => k.q);
}

export type AdLibraryOutcome = "read" | "capped" | "error";

export interface AdLibraryUnit {
  q: string;
  outcome: AdLibraryOutcome;
  ads: number;
  created: number;
  seen: number;
  batch: number | null;
  error: string | null;
}

/** Read one keyword's ads and import them; a site error comes back as data, never thrown. */
export async function adLibraryUnit(
  db: Queryable,
  sites: SiteClient,
  w: { q: string; niche: string; country?: string; platforms?: Iterable<string> },
): Promise<AdLibraryUnit> {
  const country = w.country ?? AD_COUNTRY;
  const none = { q: w.q, ads: 0, created: 0, seen: 0, batch: null };
  let ads: Ad[];
  try {
    ads = (await sites.call<{ ads: Ad[] }>("fb-public", "GET", "/ads", { q: w.q, country })).ads;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // A 429 is autobrowse's daily cap or pace: stop the pass, the bucket tries later.
    if (retryAfter(err) !== null) return { ...none, outcome: "capped", error: why };
    if (refusedBy(err) === null) throw err;
    return { ...none, outcome: "error", error: why };
  }
  const platforms = [...AD_HOSTS, ...(w.platforms ?? [])];
  const source: LeadSource = {
    sourceType: AD_LIBRARY_SOURCE,
    sourceRef: adRef(w.q, country),
    rows: () => adRows(ads, w.q, platforms),
  };
  const { batch, stats } = await atomic(db, async (tx) => {
    // A page held by its key that now links home merges first, so its ads land on one firm.
    // A failed merge leaves both firms as they were; `enrich merge-pages` retries and says why.
    for (const [key, domain] of adHomes(ads, platforms))
      await mergePageFirm(tx, key, domain).catch(() => "none");
    return runImport(tx, source, { niche: w.niche, extraPlatformDomains: platforms });
  });
  return {
    q: w.q,
    outcome: "read",
    ads: ads.length,
    created: stats.companies_created,
    seen: stats.companies_seen,
    batch: batch.id,
    error: null,
  };
}

export interface AdLibraryStats {
  selected: number;
  read: number;
  ads: number;
  created: number;
  seen: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of keywords. */
  stopped: string | null;
}

export const emptyAdLibraryStats = (): AdLibraryStats => ({
  selected: 0,
  read: 0,
  ads: 0,
  created: 0,
  seen: 0,
  errors: 0,
  stopped: null,
});

/** Count a unit; the reason to stop, or null. */
export function countAdLibraryUnit(s: AdLibraryStats, u: AdLibraryUnit): string | null {
  if (u.outcome === "capped") return `fb-public said wait: ${u.error}`;
  if (u.outcome === "error") {
    s.errors++;
    return null;
  }
  s.read++;
  s.ads += u.ads;
  s.created += u.created;
  s.seen += u.seen;
  return null;
}

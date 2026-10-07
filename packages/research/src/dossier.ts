/**
 * Everything we know about a company and its people, in one shape. A fact is
 * what we know, how sure, where it came from, how, and when we last saw it.
 * Read only: the runners (the pool scheduler, `crm run`, studies) write the
 * tables; a person, an export or a video script reads them back through here.
 * A batch of companies costs the same handful of queries as one.
 */
import { companies, people } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { companyChecks, enrichments, findings, personLookups } from "./schema.js";

export interface Fact {
  /** A finding kind (`hiring`, `job_change`, …), an enrichment kind (`opener`), `hiring_check`, `profile_lookup`, `email`. */
  what: string;
  value: unknown;
  /** 0..1 when the reading says how sure; null when it doesn't. */
  confidence: number | null;
  /** The page it came from, when there is one. */
  source: string | null;
  /** How we know: a finding's channel, an enrichment's model, a verifier. */
  via: string;
  /** The last time a read showed it. */
  seenAt: Date;
}

export interface PersonDossier {
  id: number;
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  /** Where we found them: an import, the website, a people search. */
  origin: string;
  facts: Fact[];
}

export interface Dossier {
  company: {
    id: number;
    name: string | null;
    domain: string | null;
    niche: string | null;
    country: string | null;
    timezone: string | null;
  };
  facts: Fact[];
  people: PersonDossier[];
}

const newestFirst = (a: Fact, b: Fact) => b.seenAt.getTime() - a.seenAt.getTime();

/** The model call's trail on an enrichment (envelope, raw reply, parse): the ledger's, not a fact. */
const CALL_KEYS = new Set([
  "api",
  "call",
  "raw_text",
  "parsed",
  "parse_error",
  "provider_rejected",
]);

const withoutCall = (output: unknown): unknown =>
  output && typeof output === "object" && !Array.isArray(output)
    ? Object.fromEntries(Object.entries(output).filter(([k]) => !CALL_KEYS.has(k)))
    : output;

function push<K>(map: Map<K, Fact[]>, key: K, fact: Fact): void {
  const list = map.get(key);
  if (list) list.push(fact);
  else map.set(key, [fact]);
}

/** Dossiers for these companies, in the order given; ids with no company are skipped. */
export async function dossiers(db: Queryable, companyIds: readonly number[]): Promise<Dossier[]> {
  const ids = [...new Set(companyIds)];
  if (!ids.length) return [];
  const firms = await db
    .select({
      id: companies.id,
      name: companies.name,
      domain: companies.domain,
      niche: companies.niche,
      country: companies.country,
      timezone: companies.timezone,
    })
    .from(companies)
    .where(inArray(companies.id, ids));
  const staff = await db
    .select({
      id: people.id,
      companyId: people.companyId,
      name: people.fullName,
      title: people.title,
      linkedinUrl: people.linkedinUrl,
      origin: people.origin,
    })
    .from(people)
    .where(inArray(people.companyId, ids))
    .orderBy(asc(people.id));
  const personIds = staff.map((p) => p.id);

  const byCompany = new Map<number, Fact[]>();
  const byPerson = new Map<number, Fact[]>();

  const found = await db
    .select()
    .from(findings)
    .where(
      personIds.length
        ? or(inArray(findings.companyId, ids), inArray(findings.personId, personIds))
        : inArray(findings.companyId, ids),
    );
  for (const f of found) {
    const fact: Fact = {
      what: f.kind,
      value: f.value,
      confidence: f.confidence,
      source: f.sourceUrl,
      via: f.via,
      seenAt: f.observedAt,
    };
    if (f.companyId !== null) push(byCompany, f.companyId, fact);
    else if (f.personId !== null) push(byPerson, f.personId, fact);
  }

  // The newest reading per kind and model: an old prompt's output is history, not a fact.
  const enriched = await db
    .selectDistinctOn([enrichments.companyId, enrichments.kind, enrichments.model])
    .from(enrichments)
    .where(and(isNotNull(enrichments.companyId), inArray(enrichments.companyId, ids)))
    .orderBy(
      enrichments.companyId,
      enrichments.kind,
      enrichments.model,
      desc(enrichments.createdAt),
    );
  for (const e of enriched) {
    if (e.companyId === null) continue;
    push(byCompany, e.companyId, {
      what: e.kind,
      value: withoutCall(e.output),
      confidence: null,
      source: null,
      via: e.model,
      seenAt: e.createdAt,
    });
  }

  const checks = await db.select().from(companyChecks).where(inArray(companyChecks.companyId, ids));
  for (const c of checks) {
    push(byCompany, c.companyId, {
      what: "hiring_check",
      value: { state: c.state, retryAt: c.retryAt },
      confidence: null,
      source: null,
      via: "check",
      seenAt: c.checkedAt,
    });
  }

  if (personIds.length) {
    const lookups = await db
      .select()
      .from(personLookups)
      .where(inArray(personLookups.personId, personIds));
    for (const l of lookups) {
      push(byPerson, l.personId, {
        what: "profile_lookup",
        value: { state: l.state, retryAt: l.retryAt },
        confidence: null,
        source: null,
        via: "lookup",
        seenAt: l.lookedUpAt,
      });
    }
  }

  const firmById = new Map(firms.map((f) => [f.id, f]));
  return ids.flatMap((id) => {
    const company = firmById.get(id);
    if (!company) return [];
    return [
      {
        company,
        facts: (byCompany.get(id) ?? []).sort(newestFirst),
        people: staff
          .filter((p) => p.companyId === id)
          .map(({ companyId: _, ...p }) => ({
            ...p,
            facts: (byPerson.get(p.id) ?? []).sort(newestFirst),
          })),
      },
    ];
  });
}

/** Facts another layer holds (email addresses live with the email channel), by company and person id. */
export interface MoreFacts {
  byCompany: ReadonlyMap<number, readonly Fact[]>;
  byPerson: ReadonlyMap<number, readonly Fact[]>;
}

/** Dossiers with more facts merged in, newest first. */
export function withFacts(list: readonly Dossier[], more: MoreFacts): Dossier[] {
  return list.map((d) => ({
    ...d,
    facts: [...d.facts, ...(more.byCompany.get(d.company.id) ?? [])].sort(newestFirst),
    people: d.people.map((p) => ({
      ...p,
      facts: [...p.facts, ...(more.byPerson.get(p.id) ?? [])].sort(newestFirst),
    })),
  }));
}

/** Companies matching an id, a domain, or a name fragment; at most `limit`. */
export async function findCompanyIds(db: Queryable, query: string, limit = 10): Promise<number[]> {
  const q = query.trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) return [Number(q)];
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(or(eq(companies.domain, q.toLowerCase()), ilike(companies.name, `%${likeSafe(q)}%`)))
    .orderBy(asc(companies.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

const likeSafe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** One page of a niche's companies, by id: pass the last id back as `afterId` for the next. */
export async function nicheCompanyIds(
  db: Queryable,
  niche: string,
  limit: number,
  afterId = 0,
): Promise<number[]> {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.niche, niche), gt(companies.id, afterId)))
    .orderBy(asc(companies.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** One public post the firm made, whatever the network: what a brief or a person reads. */
export interface RecentPost {
  site: string;
  /** `video`, `photo`, `carousel`, … */
  kind: string;
  /** A video's title, else the caption; whole. */
  text: string;
  url: string | null;
  publishedAt: Date | null;
  likes: number | null;
  comments: number | null;
}

/** What a dossier shows of each network's posts. */
export const POSTS_PER_SITE = 5;

const postOf = (f: Fact): RecentPost | null => {
  if (f.what !== "post" || !f.value || typeof f.value !== "object") return null;
  const v = f.value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  const num = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  const at = str("published_at");
  const ms = at ? Date.parse(at) : Number.NaN;
  return {
    site: str("site") ?? f.via,
    kind: str("kind") ?? "post",
    text: str("title") ?? str("caption") ?? "",
    url: f.source,
    publishedAt: Number.isNaN(ms) ? null : new Date(ms),
    likes: num("likes"),
    comments: num("comments"),
  };
};

/**
 * The firm's newest public posts (YouTube, Instagram, any `post` finding), newest first by when
 * they went up, at most `perSite` per network. Posts with no date go last.
 */
export function recentPosts(d: Dossier, perSite = POSTS_PER_SITE): RecentPost[] {
  const all = d.facts
    .map(postOf)
    .filter((p): p is RecentPost => p !== null)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const seen = new Map<string, number>();
  return all.filter((p) => {
    const n = seen.get(p.site) ?? 0;
    seen.set(p.site, n + 1);
    return n < perSite;
  });
}

const short = (v: unknown, max = 160): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const factLine = (f: Fact): string =>
  [
    `${f.what}: ${short(f.value)}`,
    ` (${f.via}`,
    f.confidence === null ? "" : `, ${Math.round(f.confidence * 100)}% sure`,
    `, ${f.seenAt.toISOString().slice(0, 10)})`,
    f.source ? ` ${f.source}` : "",
  ].join("");

/** A dossier as lines a person reads. */
export function dossierText(d: Dossier): string {
  const c = d.company;
  const head = [c.name ?? "(no name)", c.domain, c.niche, c.country].filter(Boolean).join(" · ");
  const out = [`#${c.id} ${head}`];
  // Posts read as one block, newest first, not a line of raw JSON each.
  const rest = d.facts.filter((f) => f.what !== "post");
  for (const f of rest) out.push(`  ${factLine(f)}`);
  const posts = recentPosts(d);
  if (posts.length) out.push("  recent posts:");
  for (const p of posts)
    out.push(
      [
        `    ${p.publishedAt?.toISOString().slice(0, 10) ?? "undated"} ${p.site} ${p.kind}: `,
        short(p.text.replace(/\s+/g, " ").trim() || "(no text)", 120),
        p.likes === null ? "" : ` · ${p.likes} likes`,
        p.url ? ` ${p.url}` : "",
      ].join(""),
    );
  if (!d.facts.length) out.push("  no company facts yet");
  for (const p of d.people) {
    out.push(`  ${p.name}${p.title ? `, ${p.title}` : ""} [${p.origin}]`);
    if (p.linkedinUrl) out.push(`    ${p.linkedinUrl}`);
    for (const f of p.facts) out.push(`    ${factLine(f)}`);
  }
  return out.join("\n");
}

/** One fact as a page shows it: what, a short value, its source, how, and when. */
export interface BriefFact {
  what: string;
  text: string;
  source: string | null;
  via: string;
  seen: string;
}

/** A dossier as a page shows it: the firm's facts, its newest posts, its people. JSON-safe. */
export interface DossierBrief {
  facts: BriefFact[];
  posts: {
    site: string;
    kind: string;
    text: string;
    url: string | null;
    published: string | null;
  }[];
  people: {
    name: string;
    title: string | null;
    linkedinUrl: string | null;
    origin: string;
    facts: BriefFact[];
  }[];
}

const briefFact = (f: Fact): BriefFact => ({
  what: f.what.replaceAll("_", " "),
  text: short(f.value),
  source: f.source,
  via: f.via,
  seen: f.seenAt.toISOString().slice(0, 10),
});

/** The same facts `dossierText` prints, shaped for the firm page. */
export function dossierBrief(d: Dossier): DossierBrief {
  return {
    facts: d.facts.filter((f) => f.what !== "post").map(briefFact),
    posts: recentPosts(d).map((p) => ({
      site: p.site,
      kind: p.kind,
      text: short(p.text.replace(/\s+/g, " ").trim(), 160),
      url: p.url,
      published: p.publishedAt?.toISOString().slice(0, 10) ?? null,
    })),
    people: d.people.map((p) => ({
      name: p.name,
      title: p.title,
      linkedinUrl: p.linkedinUrl,
      origin: p.origin,
      facts: p.facts.map(briefFact),
    })),
  };
}

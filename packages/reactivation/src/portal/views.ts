/**
 * What the portal shows (R14), read from one client's database: the overview,
 * the people list, one person with their brief and its sources, and every
 * finding. Plain reads, bounded pages; the service decides who may see which
 * client and masks the demo on the way out.
 */
import type { Client } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { type RankedContact, rankedContacts } from "../ranked.js";
import { hiringFinding, type Reason, whereFinding } from "../score.js";
import { type Pipeline, portalPipeline } from "./pipeline.js";

export const PAGE = 50;

/** Where the person works now, as the lookup read it. */
export type Now =
  | { kind: "still_there"; company: string | null; title: string | null }
  | { kind: "job_change"; company: string | null; title: string | null; from: string | null }
  | { kind: "left"; from: string | null };

export interface Overview {
  people: number;
  companies: number;
  lookedUp: number;
  moved: number;
  stillThere: number;
  left: number;
  hiringCompanies: number;
  /** People whose company is hiring now. */
  atHiring: number;
  briefs: number;
  top: RankedContact[];
  /** Every step from the list to the replies, and what each waits on. */
  pipeline: Pipeline;
}

export interface PersonRow {
  personId: number;
  name: string;
  title: string | null;
  firm: string;
  domain: string | null;
  now: Now | null;
  hiring: { count: number } | null;
  score: number | null;
  reasons: Reason[];
  brief: boolean;
  owner: string | null;
  lastContactedOn: string | null;
  lastPlacementOn: string | null;
  /** The latest verdict on the CRM address; null = no address or not checked. */
  email: { address: string; verdict: string | null } | null;
}

export const PEOPLE_FILTERS = ["all", "moved", "hiring", "there", "left", "unknown"] as const;
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number];

export interface PeoplePage {
  rows: PersonRow[];
  total: number;
  offset: number;
  counts: Record<PeopleFilter, number>;
}

export interface Source {
  /** `f<id>` or `c<id>`: the mark the brief cites. */
  mark: string;
  kind: string;
  via: string;
  url: string | null;
  title: string | null;
  /** How sure the reading is, 0 to 1; null for your CRM's own rows. */
  confidence: number | null;
  observedAt: string | null;
  value: Record<string, unknown>;
}

export interface PersonView {
  row: PersonRow;
  /** Sentences with `[f<id>]` / `[c<id>]` marks; null until one is written. */
  brief: { text: string; writtenAt: string } | null;
  /** Everything known about them and their firm, cited or not, newest first. */
  sources: Source[];
  crm: {
    id: number;
    status: string | null;
    owner: string | null;
    addedOn: string | null;
    lastContactedOn: string | null;
    lastPlacementOn: string | null;
  }[];
}

export interface RawFinding {
  id: number;
  kind: string;
  /** The person's name or the company's. */
  subject: string;
  personId: number | null;
  via: string;
  url: string | null;
  title: string | null;
  confidence: number;
  observedAt: string;
  value: Record<string, unknown>;
}

export interface RawPage {
  rows: RawFinding[];
  total: number;
  offset: number;
  /** Findings per `via`, for the platform tabs. */
  vias: { via: string; count: number }[];
}

/** Each CRM person with their latest row, where they are now and whether their firm hires. */
export const SUBJECTS = sql`
  latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.id crm_id, c.email,
      c.owner, c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, ${whereFinding(sql`l.person_id`)} where_id, ${hiringFinding(sql`l.company_id`)} hiring_id
    from latest l)`;

const FILTER_SQL: Record<PeopleFilter, SQL> = {
  all: sql`true`,
  moved: sql`w.kind = 'job_change'`,
  hiring: sql`s.hiring_id is not null`,
  there: sql`w.kind = 'still_there'`,
  left: sql`w.kind = 'left'`,
  unknown: sql`s.where_id is null`,
};

const day = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : null;
export const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function nowOf(kind: string | null, v: Record<string, unknown> | null): Now | null {
  if (!kind || !v) return null;
  if (kind === "still_there") return { kind, company: str(v.company), title: str(v.title) };
  if (kind === "job_change")
    return { kind, company: str(v.to), title: str(v.title), from: str(v.from) };
  if (kind === "left") return { kind, from: str(v.from) };
  return null;
}

interface PersonSqlRow extends Record<string, unknown> {
  person_id: number;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  firm: string;
  domain: string | null;
  where_kind: string | null;
  where_value: Record<string, unknown> | null;
  hiring_count: number | null;
  score: number | null;
  reasons: Reason[] | null;
  brief: boolean;
  owner: string | null;
  last_contacted_on: unknown;
  last_placement_on: unknown;
  email: string | null;
  verdict: string | null;
}

const PERSON_COLUMNS = sql`
  s.person_id, p.first_name, p.last_name, p.full_name, p.title,
  coalesce(co.name, co.domain, '?') firm, co.domain,
  w.kind where_kind, w.value where_value,
  (h.value->>'count')::int hiring_count,
  sc.score, sc.reasons,
  coalesce(b.state = 'written' and sc.score > 0, false) brief,
  s.owner, s.last_contacted_on, s.last_placement_on, s.email,
  (select v.result from contact_candidates cc join verifications v on v.contact_candidate_id = cc.id
    where cc.evidence = 'crm' and lower(cc.email) = lower(s.email)
    order by v.checked_at desc, v.id desc limit 1) verdict`;

const PERSON_JOINS = sql`
  from subjects s
  join people p on p.id = s.person_id
  join companies co on co.id = s.company_id
  left join findings w on w.id = s.where_id
  left join findings h on h.id = s.hiring_id
  left join contact_scores sc on sc.person_id = s.person_id
  left join briefs b on b.person_id = s.person_id`;

function toRow(r: PersonSqlRow): PersonRow {
  return {
    personId: r.person_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.full_name || "(no name)",
    title: r.title,
    firm: r.firm,
    domain: r.domain,
    now: nowOf(r.where_kind, r.where_value),
    hiring: r.hiring_count === null ? null : { count: r.hiring_count },
    score: r.score,
    reasons: r.reasons ?? [],
    brief: r.brief,
    owner: r.owner,
    lastContactedOn: day(r.last_contacted_on),
    lastPlacementOn: day(r.last_placement_on),
    email: r.email ? { address: r.email, verdict: r.verdict } : null,
  };
}

export async function portalOverview(db: Queryable, client: Client): Promise<Overview> {
  const [c] = await db.execute<{
    people: number;
    companies: number;
    looked_up: number;
    moved: number;
    still_there: number;
    left: number;
    hiring_companies: number;
    at_hiring: number;
    briefs: number;
  }>(sql`
    with ${SUBJECTS}
    select count(*)::int people,
      count(distinct s.company_id)::int companies,
      count(w.id)::int looked_up,
      count(*) filter (where w.kind = 'job_change')::int moved,
      count(*) filter (where w.kind = 'still_there')::int still_there,
      count(*) filter (where w.kind = 'left')::int "left",
      count(distinct s.company_id) filter (where s.hiring_id is not null)::int hiring_companies,
      count(*) filter (where s.hiring_id is not null)::int at_hiring,
      (select count(*)::int from briefs b join contact_scores sc on sc.person_id = b.person_id
        where b.state = 'written' and sc.score > 0
          and b.person_id in (select person_id from latest)) briefs
    from subjects s left join findings w on w.id = s.where_id`);
  return {
    people: c?.people ?? 0,
    companies: c?.companies ?? 0,
    lookedUp: c?.looked_up ?? 0,
    moved: c?.moved ?? 0,
    stillThere: c?.still_there ?? 0,
    left: c?.left ?? 0,
    hiringCompanies: c?.hiring_companies ?? 0,
    atHiring: c?.at_hiring ?? 0,
    briefs: c?.briefs ?? 0,
    top: await rankedContacts(db, { limit: 5 }),
    pipeline: await portalPipeline(db, client),
  };
}

export interface PeopleQuery {
  filter?: PeopleFilter;
  offset?: number;
  /** Matches the firm, and the name when `searchNames`. */
  q?: string;
  /** Off for the demo: a hit on a name would say a real person is on the list. */
  searchNames?: boolean;
}

export async function portalPeople(db: Queryable, query: PeopleQuery = {}): Promise<PeoplePage> {
  const filter = PEOPLE_FILTERS.includes(query.filter as PeopleFilter)
    ? (query.filter as PeopleFilter)
    : "all";
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset ?? 0)) : 0;
  const q = query.q?.trim() ? `%${query.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const search = q
    ? query.searchNames
      ? sql`(coalesce(co.name, co.domain, '') ilike ${q} or p.full_name ilike ${q})`
      : sql`coalesce(co.name, co.domain, '') ilike ${q}`
    : sql`true`;
  const rows = await db.execute<PersonSqlRow>(sql`
    with ${SUBJECTS}
    select ${PERSON_COLUMNS}
    ${PERSON_JOINS}
    where ${FILTER_SQL[filter]} and ${search}
    order by sc.score desc nulls last, s.person_id
    limit ${PAGE} offset ${offset}`);
  const [n] = await db.execute<Record<PeopleFilter, number> & { total: number }>(sql`
    with ${SUBJECTS}
    select count(*) filter (where ${FILTER_SQL[filter]})::int total,
      ${sql.join(
        PEOPLE_FILTERS.map(
          (f) => sql`count(*) filter (where ${FILTER_SQL[f]})::int ${sql.identifier(f)}`,
        ),
        sql`, `,
      )}
    ${PERSON_JOINS}
    where ${search}`);
  const counts = Object.fromEntries(PEOPLE_FILTERS.map((f) => [f, n?.[f] ?? 0])) as Record<
    PeopleFilter,
    number
  >;
  return { rows: rows.map(toRow), total: n?.total ?? 0, offset, counts };
}

interface CrmSqlRow extends Record<string, unknown> {
  id: number;
  status: string | null;
  owner: string | null;
  added_on: unknown;
  last_contacted_on: unknown;
  last_placement_on: unknown;
}

const crmSource = (c: CrmSqlRow): Source => ({
  mark: `c${c.id}`,
  kind: "crm",
  via: "crm",
  url: null,
  title: null,
  confidence: null,
  observedAt: null,
  value: {
    status: c.status,
    owner: c.owner,
    lastContactedOn: day(c.last_contacted_on),
    lastPlacementOn: day(c.last_placement_on),
  },
});

/** Findings as sources, newest first, at most `limit`. */
async function findingSources(db: Queryable, where: SQL, limit = 100): Promise<Source[]> {
  const found = await db.execute<{
    id: number;
    kind: string;
    via: string;
    source_url: string | null;
    title: string | null;
    confidence: number | null;
    observed_at: unknown;
    value: Record<string, unknown>;
  }>(sql`
    select f.id, f.kind, f.via, f.source_url, d.title, f.confidence, f.observed_at, f.value
    from findings f left join documents d on d.id = f.document_id
    where ${where}
    order by f.observed_at desc, f.id desc
    limit ${limit}`);
  return found.map((f) => ({
    mark: `f${f.id}`,
    kind: f.kind,
    via: f.via,
    url: f.source_url,
    title: f.title,
    confidence: f.confidence === null ? null : Number(f.confidence),
    observedAt: iso(f.observed_at),
    value: f.value,
  }));
}

/** Enough for a full page of emails, each citing a brief's worth of marks. */
const MAX_MARKS = PAGE * 40;

/** The sources behind these marks (`f12`, `c3`), in no set order; unknown marks drop. */
export async function sourcesOf(db: Queryable, marks: Iterable<string>): Promise<Source[]> {
  const all = [...new Set([...marks].map((m) => m.toLowerCase()))];
  const ids = (p: string) =>
    all
      .filter((m) => m.startsWith(p) && /^\d{1,9}$/.test(m.slice(1)))
      .map((m) => Number(m.slice(1)))
      .slice(0, MAX_MARKS);
  const f = ids("f");
  const c = ids("c");
  const list = (xs: number[]) =>
    sql.join(
      xs.map((x) => sql`${x}`),
      sql`, `,
    );
  return [
    ...(f.length ? await findingSources(db, sql`f.id in (${list(f)})`, MAX_MARKS) : []),
    ...(c.length
      ? (
          await db.execute<CrmSqlRow>(sql`
            select id, status, owner, added_on, last_contacted_on, last_placement_on
            from crm_contacts where id in (${list(c)})`)
        ).map(crmSource)
      : []),
  ];
}

export async function portalPerson(db: Queryable, personId: number): Promise<PersonView | null> {
  const [r] = await db.execute<PersonSqlRow & { company_id: number }>(sql`
    with ${SUBJECTS}
    select ${PERSON_COLUMNS}, s.company_id
    ${PERSON_JOINS}
    where s.person_id = ${personId}`);
  if (!r) return null;
  const [b] = await db.execute<{ text: string; created_at: unknown }>(sql`
    select b.text, b.created_at from briefs b join contact_scores sc on sc.person_id = b.person_id
    where b.person_id = ${personId} and b.state = 'written' and sc.score > 0`);
  const found = await findingSources(
    db,
    sql`f.person_id = ${personId} or f.company_id = ${r.company_id}`,
  );
  const crm = await db.execute<CrmSqlRow>(sql`
    select id, status, owner, added_on, last_contacted_on, last_placement_on
    from crm_contacts where person_id = ${personId} order by id desc`);
  return {
    row: toRow(r),
    brief: b ? { text: b.text, writtenAt: iso(b.created_at) ?? "" } : null,
    sources: [...found, ...crm.map(crmSource)],
    crm: crm.map((c) => ({
      id: c.id,
      status: c.status,
      owner: c.owner,
      addedOn: day(c.added_on),
      lastContactedOn: day(c.last_contacted_on),
      lastPlacementOn: day(c.last_placement_on),
    })),
  };
}

export interface RawQuery {
  via?: string;
  kind?: string;
  offset?: number;
}

export async function portalRaw(db: Queryable, query: RawQuery = {}): Promise<RawPage> {
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset ?? 0)) : 0;
  const where = sql.join(
    [
      query.via ? sql`f.via = ${query.via}` : sql`true`,
      query.kind ? sql`f.kind = ${query.kind}` : sql`true`,
    ],
    sql` and `,
  );
  // Only facts about this client's list: its people and their firms.
  const scope = sql`(f.person_id in (select person_id from crm_contacts)
    or f.company_id in (select company_id from crm_contacts))`;
  const rows = await db.execute<{
    id: number;
    kind: string;
    person_id: number | null;
    subject: string;
    via: string;
    source_url: string | null;
    title: string | null;
    confidence: number;
    observed_at: unknown;
    value: Record<string, unknown>;
  }>(sql`
    select f.id, f.kind, f.person_id,
      coalesce(nullif(concat_ws(' ', p.first_name, p.last_name), ''), p.full_name, co.name, co.domain, '?') subject,
      f.via, f.source_url, d.title, f.confidence, f.observed_at, f.value
    from findings f
    left join people p on p.id = f.person_id
    left join companies co on co.id = f.company_id
    left join documents d on d.id = f.document_id
    where ${scope} and ${where}
    order by f.observed_at desc, f.id desc
    limit ${PAGE} offset ${offset}`);
  const [n] = await db.execute<{ total: number }>(
    sql`select count(*)::int total from findings f where ${scope} and ${where}`,
  );
  const vias = await db.execute<{ via: string; count: number }>(sql`
    select f.via, count(*)::int count from findings f where ${scope}
    group by f.via order by count desc, f.via`);
  return {
    rows: rows.map((f) => ({
      id: f.id,
      kind: f.kind,
      subject: f.subject,
      personId: f.person_id,
      via: f.via,
      url: f.source_url,
      title: f.title,
      confidence: f.confidence,
      observedAt: iso(f.observed_at) ?? "",
      value: f.value,
    })),
    total: n?.total ?? 0,
    offset,
    vias: [...vias],
  };
}

/** Every name on the client's list, for the demo mask. */
export async function listNames(
  db: Queryable,
): Promise<{ first: string | null; last: string | null; full: string | null }[]> {
  const rows = await db.execute<{ first: string | null; last: string | null; full: string | null }>(
    sql`select first_name "first", last_name "last", full_name "full" from people`,
  );
  return [...rows];
}

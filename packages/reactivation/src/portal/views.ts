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
  /**
   * The address to write to, with its latest verdict: a mover's at the new firm (null until one
   * checks out), anyone else's from the CRM.
   */
  email: { address: string; verdict: string | null } | null;
  /** A mover's CRM address, at the firm they left. */
  oldEmail: { address: string; verdict: string | null } | null;
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

/** Each CRM person with their latest row, where they are now and whether their firm hires. */
export const SUBJECTS = sql`
  latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.id crm_id, c.email,
      c.owner, c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, ${whereFinding(sql`l.person_id`)} where_id, ${hiringFinding(sql`l.company_id`)} hiring_id
    from latest l)`;

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
  new_email: string | null;
  new_verdict: string | null;
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
    order by v.checked_at desc, v.id desc limit 1) verdict,
  (select cc.email from mover_addresses m join contact_candidates cc on cc.id = m.candidate_id
    where m.finding_id = s.where_id and m.outcome = 'found') new_email,
  (select v.result from mover_addresses m join verifications v on v.contact_candidate_id = m.candidate_id
    where m.finding_id = s.where_id and m.outcome = 'found'
    order by v.checked_at desc, v.id desc limit 1) new_verdict`;

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
    ...emailsOf(r),
  };
}

function emailsOf(r: PersonSqlRow): Pick<PersonRow, "email" | "oldEmail"> {
  const crm = r.email ? { address: r.email, verdict: r.verdict } : null;
  if (r.where_kind !== "job_change") return { email: crm, oldEmail: null };
  const found = r.new_email ? { address: r.new_email, verdict: r.new_verdict } : null;
  return { email: found, oldEmail: crm };
}

/** `approves`: this login says yes to the client's emails (`mayApprove`). */
export async function portalOverview(
  db: Queryable,
  client: Client,
  approves = true,
): Promise<Overview> {
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
    pipeline: await portalPipeline(db, client, approves),
  };
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

/** Every name on the client's list, for the demo mask. */
export async function listNames(
  db: Queryable,
): Promise<{ first: string | null; last: string | null; full: string | null }[]> {
  const rows = await db.execute<{ first: string | null; last: string | null; full: string | null }>(
    sql`select first_name "first", last_name "last", full_name "full" from people`,
  );
  return [...rows];
}

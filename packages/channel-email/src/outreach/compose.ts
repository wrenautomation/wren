/**
 * Compose: turn eligible recipients into enrollments full of pinned drafts.
 *
 * Pure assembly over stored facts — no network, no sending. Everything is passed in
 * (sequence, templates, facts view name, the roster addresses this niche may send from);
 * this module never imports niche registries. One enrollment per company.
 *
 * Two passes, in this order: every company whose best-ranked person has a live address
 * gets a PERSON enrollment; then every company still without an enrollment whose email
 * pick named a send-to address on the company's own site gets a ROLE_INBOX enrollment.
 *
 * `audience` picks the companies: `first_contact` (never enrolled) or `returning` (enrolled
 * before, rested, and this sequence+offer new to it; src/recontact.ts). An address whose
 * enrollment ended wrong_person, referral, bounced or opted_out is never used again.
 *
 * The whole sequence renders up front and every step is stored before anything can send.
 * Each enroll runs in its own transaction (a savepoint when compose itself runs inside
 * one), so a lost race on the partial unique indexes costs one company, not the run.
 */
import { randomBytes } from "node:crypto";
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { activeSuppression, activeSuppressions } from "../guards.js";
import {
  type Audience,
  audienceGate,
  DEFAULT_RECONTACT,
  doneAddresses,
  type RecontactPolicy,
} from "../recontact.js";
import {
  type ApprovalSource,
  type EnrollmentKind,
  enrollments,
  messages,
  templateVersions,
} from "../schema.js";
import { CALL_TIMES } from "../send/call-times.js";
import { transitionMessage } from "../state.js";
import { toSource } from "./authoring.js";
import { type FactRow, type Facts, factsFor, factsForCompany } from "./facts.js";
import type { FactValues } from "./pickers.js";
import {
  type AddressRecord,
  peopleWithAddress,
  personAddressIn,
  roleInboxAddress,
} from "./provenance.js";
import type { Sequence } from "./sequences.js";
import { MissingFactError, type Rendered, render, type Template } from "./templates.js";

export type ComposeKind = "person" | "role_inbox" | "all";

export interface ComposeOptions {
  readonly niche: string;
  readonly sequence: Sequence;
  /** The offer this sequence pitches, stamped on every enrollment (an @wren/offers id). */
  readonly offer: string;
  /** That offer's terms as `offer.*` facts (`offerFacts` in @wren/offers), beside every facts row. */
  readonly offerFacts?: Readonly<Record<string, string>>;
  /** The site's origin ("https://wrenautomation.com"). With it every draft gets `link.*` facts (`linkFacts`). */
  readonly site?: string | null;
  readonly templates: ReadonlyMap<string, Template>;
  /** A person whose only VALID check has aged past this is treated as having no address. */
  readonly verificationHorizonDays: number;
  /** The niche's ACTIVE roster addresses in roster order. */
  readonly senders: readonly string[];
  /** Sign-off block per sender, appended to every body HERE, never at send time. */
  readonly signatures?: Readonly<Record<string, string>>;
  /** Mint a pixel token on each draft. */
  readonly trackOpens?: boolean;
  readonly factsView?: string | null;
  readonly limit?: number | null;
  readonly autoApprove?: boolean;
  readonly runId?: string | null;
  readonly kind?: ComposeKind;
  /** Fact gate: every `key=value` must hold on the facts row the templates see, as text. */
  readonly where?: Readonly<Record<string, string>>;
  /**
   * A role inbox needs a valid or catch_all verdict before it is enrolled. On when
   * verdicts are free (the pool-feeder makes them); off, an unchecked inbox may go.
   */
  readonly roleInboxNeedsVerdict?: boolean;
  /** Companies never enrolled (default), or companies coming back for a new sequence. */
  readonly audience?: Audience;
  /** When a company may come back: the niche's rest periods and yearly cap. */
  readonly recontact?: RecontactPolicy;
}

export interface ComposeStats {
  enrolled: number;
  enrolled_person: number;
  enrolled_role_inbox: number;
  messages_drafted: number;
  auto_approved: number;
  /** Enrollments whose drafts pin at least one fact `readable` refused to state. */
  facts_refused: number;
  skipped_no_address: number;
  skipped_suppressed: number;
  skipped_missing_facts: number;
  skipped_where: number;
  /** The address ended wrong_person, referral, bounced or opted_out before. */
  skipped_address_done: number;
  /** Lost the race for a company/address/person against another compose run. */
  skipped_already_enrolled: number;
  flagged_possible_duplicate: number;
}

const newStats = (): ComposeStats => ({
  enrolled: 0,
  enrolled_person: 0,
  enrolled_role_inbox: 0,
  messages_drafted: 0,
  auto_approved: 0,
  facts_refused: 0,
  skipped_no_address: 0,
  skipped_suppressed: 0,
  skipped_missing_facts: 0,
  skipped_where: 0,
  skipped_address_done: 0,
  skipped_already_enrolled: 0,
  flagged_possible_duplicate: 0,
});

interface EligibleRow {
  person_id: number;
  company_id: number;
  full_name: string | null;
  title: string | null;
  role_rank: number;
  company_name: string | null;
  company_domain: string | null;
}
interface RoleInboxRow {
  company_id: number;
  company_name: string | null;
  company_domain: string | null;
  lead_id: number;
  email: string;
  pick_enrichment_id: number;
  pick_method: string | null;
}

/** A lookup this sure the person moved on keeps them out of compose. */
const MOVED_ON_CONFIDENCE = 0.8;

// One row per (company, person) whose company passes the audience gate, best rank first
// within each company. First contact: a company with ANY enrollment is out. A person whose
// newest lookup finding says they moved on (job_change or left, sure enough) is out; the
// firm falls to its next person.
const eligibleSql = (niche: string, companyMatch: string | null, gate: Gate) => sql`
  SELECT pf.person_id, pf.company_id, pf.full_name, pf.title, pf.role_rank,
         pf.company_name, pf.company_domain
  FROM person_facts pf
  WHERE pf.company_niche = ${niche}
    AND NOT EXISTS (SELECT 1 FROM companies dc WHERE dc.id = pf.company_id AND dc.decline_reason IS NOT NULL)
    AND NOT pf.avoid_emailing_first
    AND pf.role_rank IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT f.kind, f.confidence FROM findings f
        WHERE f.person_id = pf.person_id AND f.kind IN ('still_there', 'job_change', 'left')
        ORDER BY f.observed_at DESC, f.id DESC LIMIT 1
      ) newest
      WHERE newest.kind IN ('job_change', 'left') AND newest.confidence >= ${MOVED_ON_CONFIDENCE}
    )
    AND ${gate(sql`pf.company_id`)}
    ${
      companyMatch === null
        ? sql``
        : sql`AND (pf.company_name ILIKE ${companyMatch} OR pf.company_domain ILIKE ${companyMatch})`
    }
  ORDER BY pf.company_id, pf.role_rank, pf.person_id`;

// One row per company passing the audience gate whose NEWEST email pick named a send-to
// address: the pick's `best_send_to`, held as a lead on the company's own record. The newest
// pick is chosen first and gated second, on purpose. Gates: the lead is not
// suppressed/undeliverable (status), no verdict ever called the address invalid, and no
// contact candidate holds it. A valid or catch_all verdict is required when `verdict` says:
// ever (`any`), or within the last N days (a returning company's address is re-checked).
const roleInboxSql = (
  niche: string,
  companyMatch: string | null,
  gate: Gate,
  verdict: "none" | "any" | number,
) => sql`
  WITH newest_pick AS (
    SELECT DISTINCT ON (e.company_id)
           e.company_id, e.id,
           e.output -> 'pick' ->> 'best_send_to' AS best_send_to,
           e.output -> 'pick' ->> 'method' AS method
    FROM enrichments e
    WHERE e.kind = 'email_pick'
    ORDER BY e.company_id, e.id DESC
  )
  SELECT c.id AS company_id, c.name AS company_name, c.domain AS company_domain,
         l.id AS lead_id, l.email, p.id AS pick_enrichment_id, p.method AS pick_method
  FROM companies c
  JOIN newest_pick p ON p.company_id = c.id AND p.best_send_to IS NOT NULL
  JOIN leads l ON l.company_id = c.id AND lower(l.email) = lower(p.best_send_to)
  WHERE c.niche = ${niche}
    AND c.decline_reason IS NULL
    AND l.status IN ('imported', 'verified')
    AND NOT EXISTS (SELECT 1 FROM verifications v WHERE v.lead_id = l.id AND v.result = 'invalid')
    AND NOT EXISTS (SELECT 1 FROM contact_candidates cc WHERE lower(cc.email) = lower(l.email))
    AND ${gate(sql`c.id`)}
    ${
      verdict === "none"
        ? sql``
        : sql`AND EXISTS (SELECT 1 FROM verifications v WHERE v.lead_id = l.id AND v.result IN ('valid', 'catch_all')
                ${verdict === "any" ? sql`` : sql`AND v.checked_at > now() - make_interval(days => ${verdict}::int)`})`
    }
    ${
      companyMatch === null
        ? sql``
        : sql`AND (c.name ILIKE ${companyMatch} OR c.domain ILIKE ${companyMatch})`
    }
  ORDER BY c.id`;

/** The audience condition on a company id expression. */
type Gate = (company: SQL) => SQL;

const gateFor =
  (
    audience: Audience,
    policy: RecontactPolicy,
    pitch: { sequence: string; offer: string } | null,
  ) =>
  (company: SQL) =>
    audienceGate(company, audience, policy, pitch);

/** Returning role inboxes need a verdict inside the horizon; first contact keeps the old rule. */
const roleInboxVerdict = (
  audience: Audience,
  needsVerdict: boolean,
  horizonDays: number,
): "none" | "any" | number =>
  audience === "returning" ? horizonDays : needsVerdict ? "any" : "none";

/** The listings below show first contact only. */
const firstContact: Gate = (company) => audienceGate(company, "first_contact", DEFAULT_RECONTACT);

/** Raw rows come back untyped; the SQL above fixes their shape. */
const rowsAs = <R>(rows: unknown) => rows as R[];

/** Group consecutive rows by company (the SQL orders by company_id). */
function* byCompany<R extends { company_id: number }>(rows: readonly R[]): Generator<R[]> {
  let group: R[] = [];
  for (const row of rows) {
    if (group.length > 0 && (group[0] as R).company_id !== row.company_id) {
      yield group;
      group = [];
    }
    group.push(row);
  }
  if (group.length > 0) yield group;
}

/**
 * Companies whose best addressable person ranks highest go first, so a limited day
 * spends its slots on owners before untitled contacts. Ties keep company order.
 */
export function bestReachableFirst<R extends { person_id: number; role_rank: number }>(
  groups: Iterable<R[]>,
  addressable: ReadonlySet<number>,
): R[][] {
  const best = (group: R[]) =>
    Math.min(...group.filter((r) => addressable.has(r.person_id)).map((r) => r.role_rank));
  return [...groups]
    .map((group, order) => ({ group, order, rank: best(group) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((g) => g.group);
}

export interface EligiblePerson {
  readonly personId: number;
  readonly companyId: number;
  readonly fullName: string | null;
  readonly title: string | null;
  readonly roleRank: number;
  readonly companyName: string | null;
  readonly companyDomain: string | null;
  readonly email: string | null;
  readonly suppressed: boolean;
  readonly wouldEnroll: boolean;
}

export interface EligibleRoleInbox {
  readonly companyId: number;
  readonly companyName: string | null;
  readonly companyDomain: string | null;
  readonly email: string;
  readonly pickMethod: string | null;
  readonly suppressed: boolean;
  readonly wouldEnroll: boolean;
}

export interface ListingOptions {
  readonly niche: string;
  /** Narrows to firms whose name or domain contains it. */
  readonly companyMatch?: string | null;
  readonly maxCompanies?: number | null;
}

/**
 * Everyone compose would consider, in compose's own order, with the address and
 * suppression gates pre-applied. A missing fact can still skip a person at compose time.
 */
export async function eligiblePeople(
  db: Queryable,
  opts: ListingOptions & { verificationHorizonDays: number },
): Promise<EligiblePerson[]> {
  const match = opts.companyMatch ? `%${opts.companyMatch}%` : null;
  const rows = rowsAs<EligibleRow>(await db.execute(eligibleSql(opts.niche, match, firstContact)));
  const addressable = await peopleWithAddress(
    db,
    rows.map((r) => r.person_id),
    opts.verificationHorizonDays,
  );
  const out: EligiblePerson[] = [];
  let companyIndex = 0;
  for (const group of byCompany(rows)) {
    if (opts.maxCompanies != null && companyIndex >= opts.maxCompanies) break;
    companyIndex++;
    let picked = false;
    for (const row of group) {
      const { record } = await personAddressIn(
        db,
        addressable,
        row.person_id,
        opts.verificationHorizonDays,
      );
      const email = record?.email ?? null;
      const suppressed = email !== null && (await activeSuppression(db, email)) !== null;
      const wouldEnroll: boolean = !picked && email !== null && !suppressed;
      picked = picked || wouldEnroll;
      out.push({
        personId: row.person_id,
        companyId: row.company_id,
        fullName: row.full_name,
        title: row.title,
        roleRank: row.role_rank,
        companyName: row.company_name,
        companyDomain: row.company_domain,
        email,
        suppressed,
        wouldEnroll,
      });
    }
  }
  return out;
}

/**
 * The person compose would enroll at each of the next `companies` firms, in
 * compose's own order (best reachable first): research reads ahead of the queue
 * from this. Suppression and missing facts are compose's to find.
 */
export async function nextToEnroll(
  db: Queryable,
  opts: { niche: string; verificationHorizonDays: number; companies?: number | null },
): Promise<number[]> {
  const rows = rowsAs<EligibleRow>(await db.execute(eligibleSql(opts.niche, null, firstContact)));
  const addressable = await peopleWithAddress(
    db,
    rows.map((r) => r.person_id),
    opts.verificationHorizonDays,
  );
  const out: number[] = [];
  for (const group of bestReachableFirst(byCompany(rows), addressable)) {
    if (opts.companies != null && out.length >= opts.companies) break;
    const first = group.find((r) => addressable.has(r.person_id));
    if (first) out.push(first.person_id);
  }
  return out;
}

/** Every company the role-inbox pass would consider today, with the suppression gate pre-applied. */
export async function eligibleRoleInboxes(
  db: Queryable,
  opts: ListingOptions & {
    excludeCompanies?: ReadonlySet<number>;
    needsVerdict?: boolean;
  },
): Promise<EligibleRoleInbox[]> {
  const match = opts.companyMatch ? `%${opts.companyMatch}%` : null;
  const verdict = opts.needsVerdict ? "any" : "none";
  const rows = rowsAs<RoleInboxRow>(
    await db.execute(roleInboxSql(opts.niche, match, firstContact, verdict)),
  );
  const exclude = opts.excludeCompanies ?? new Set<number>();
  const isSuppressed = await activeSuppressions(
    db,
    rows.map((r) => r.email),
  );
  const out: EligibleRoleInbox[] = [];
  for (const row of rows) {
    if (exclude.has(row.company_id)) continue;
    if (opts.maxCompanies != null && out.length >= opts.maxCompanies) break;
    const suppressed = isSuppressed(row.email) !== null;
    out.push({
      companyId: row.company_id,
      companyName: row.company_name,
      companyDomain: row.company_domain,
      email: row.email,
      pickMethod: row.pick_method,
      suppressed,
      wouldEnroll: !suppressed,
    });
  }
  return out;
}

interface Shared {
  readonly niche: string;
  readonly sequence: Sequence;
  readonly offer: string;
  readonly offerFacts: Readonly<Record<string, string>>;
  readonly site: string | null;
  readonly templates: ReadonlyMap<string, Template>;
  readonly factsView: string | null;
  readonly senders: readonly string[];
  readonly signatures: Readonly<Record<string, string>>;
  readonly trackOpens: boolean;
  readonly livePerSender: Map<string, number>;
  readonly recordedVersions: Set<string>;
  readonly autoApprove: boolean;
  readonly runId: string | null;
  readonly stats: ComposeStats;
  readonly where: Readonly<Record<string, string>>;
  readonly roleInboxVerdict: "none" | "any" | number;
  readonly gate: Gate;
  /** Addresses never written to again (lowercased). */
  readonly done: ReadonlySet<string>;
}

/**
 * Enroll up to `limit` companies and render their full sequence as messages (draft, or
 * approved when `autoApprove`). Runs people first, then role inboxes, sharing `limit`.
 */
export async function compose(db: Queryable, opts: ComposeOptions): Promise<ComposeStats> {
  const missing = [...new Set(opts.sequence.steps.map((s) => s.template))]
    .filter((t) => !opts.templates.has(t))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `sequence '${opts.sequence.name}' needs unknown templates: [${missing.map((m) => `'${m}'`).join(", ")}]`,
    );
  }
  if (opts.senders.length === 0) {
    // An unpinned enrollment is a thread with no home.
    throw new Error("compose needs at least one sending address; none was passed");
  }
  const audience = opts.audience ?? "first_contact";
  const shared: Shared = {
    niche: opts.niche,
    sequence: opts.sequence,
    offer: opts.offer,
    offerFacts: opts.offerFacts ?? {},
    site: opts.site ?? null,
    templates: opts.templates,
    factsView: opts.factsView ?? null,
    senders: opts.senders,
    signatures: opts.signatures ?? {},
    trackOpens: opts.trackOpens ?? false,
    livePerSender: await livePerSender(db, opts.senders),
    recordedVersions: new Set(),
    autoApprove: opts.autoApprove ?? false,
    runId: opts.runId ?? null,
    stats: newStats(),
    where: opts.where ?? {},
    roleInboxVerdict: roleInboxVerdict(
      audience,
      opts.roleInboxNeedsVerdict ?? false,
      opts.verificationHorizonDays,
    ),
    gate: gateFor(audience, opts.recontact ?? DEFAULT_RECONTACT, {
      sequence: opts.sequence.name,
      offer: opts.offer,
    }),
    done: await doneAddresses(db),
  };
  const kind = opts.kind ?? "all";
  const limit = opts.limit ?? null;
  if (kind === "person" || kind === "all") {
    await personPass(db, shared, opts.verificationHorizonDays, limit);
  }
  if (kind === "role_inbox" || kind === "all") await roleInboxPass(db, shared, limit);
  return shared.stats;
}

/** Every gate key must be present on the facts row and equal its value as text. */
function passesWhere(facts: FactValues, where: Readonly<Record<string, string>>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const fact = facts[key];
    return fact !== null && fact !== undefined && String(fact) === value;
  });
}

async function personPass(
  db: Queryable,
  shared: Shared,
  horizonDays: number,
  limit: number | null,
) {
  const stats = shared.stats;
  const rows = rowsAs<EligibleRow>(await db.execute(eligibleSql(shared.niche, null, shared.gate)));
  const addressable = await peopleWithAddress(
    db,
    rows.map((r) => r.person_id),
    horizonDays,
  );
  for (const group of bestReachableFirst(byCompany(rows), addressable)) {
    if (limit !== null && stats.enrolled >= limit) break;
    for (const row of group) {
      const { record, alternates } = await personAddressIn(
        db,
        addressable,
        row.person_id,
        horizonDays,
      );
      if (record === null) {
        stats.skipped_no_address++;
        continue;
      }
      if (shared.done.has(record.email.toLowerCase())) {
        stats.skipped_address_done++;
        continue;
      }
      if ((await activeSuppression(db, record.email)) !== null) {
        stats.skipped_suppressed++;
        continue;
      }
      const facts = await factsFor(db, row.person_id, shared.factsView);
      if (!passesWhere(facts.values, shared.where)) {
        stats.skipped_where++;
        break; // the company, not the person, is outside the gate
      }
      const drafts = renderAll(shared, facts, `person:${row.person_id}`);
      if (drafts === null) {
        stats.skipped_missing_facts++;
        continue;
      }
      const duplicate = await possibleDuplicateCompany(db, row);
      const enrolled = await enrollCompany(db, shared, {
        kind: "person",
        personId: row.person_id,
        companyId: row.company_id,
        address: record,
        alternates,
        duplicate,
        drafts,
        refused: facts.refused,
      });
      if (enrolled) {
        stats.enrolled_person++;
        if (duplicate !== null) stats.flagged_possible_duplicate++;
      }
      break; // one person per company, enrolled or lost
    }
  }
}

/** The companies the person pass left without an enrollment, through the address their pick chose. */
async function roleInboxPass(db: Queryable, shared: Shared, limit: number | null) {
  const stats = shared.stats;
  const rows = rowsAs<RoleInboxRow>(
    await db.execute(roleInboxSql(shared.niche, null, shared.gate, shared.roleInboxVerdict)),
  );
  const suppressed = await activeSuppressions(
    db,
    rows.map((r) => r.email),
  );
  for (const row of rows) {
    if (limit !== null && stats.enrolled >= limit) break;
    if (shared.done.has(row.email.toLowerCase())) {
      stats.skipped_address_done++;
      continue;
    }
    if (suppressed(row.email) !== null) {
      stats.skipped_suppressed++;
      continue;
    }
    const facts = await factsForCompany(db, row.company_id, shared.factsView);
    if (!passesWhere(facts.values, shared.where)) {
      stats.skipped_where++;
      continue;
    }
    const drafts = renderAll(shared, facts, `company:${row.company_id}`);
    if (drafts === null) {
      stats.skipped_missing_facts++;
      continue;
    }
    const record = await roleInboxAddress(db, {
      companyId: row.company_id,
      leadId: row.lead_id,
      email: row.email,
      pickEnrichmentId: row.pick_enrichment_id,
      pickMethod: row.pick_method,
    });
    const enrolled = await enrollCompany(db, shared, {
      kind: "role_inbox",
      personId: null,
      companyId: row.company_id,
      address: record,
      alternates: [],
      duplicate: null,
      drafts,
      refused: facts.refused,
    });
    if (enrolled) stats.enrolled_role_inbox++;
  }
}

/**
 * The links one draft may carry, each with that draft's own code (`?r=`), so a click or a
 * booking names the email. `link.book` books the offer's call (the site's /book/<offer>);
 * `link.page` is the offer's page; `link.watch` is the company's own demo (a facts view's
 * `video_url`), else the offer's video (/watch/<offer>). Only the site's own links carry a
 * code. A link the row can't fill is absent, so copy that needs it skips the company.
 */
export function linkFacts(
  site: string | null,
  offer: string,
  values: Readonly<FactRow>,
  offerFacts: Readonly<Record<string, string>>,
  code: string,
): Record<string, string> {
  if (!site) return {};
  const origin = new URL(site).origin;
  const tagged = (to: string): string | null => {
    const url = new URL(to, origin);
    if (url.origin !== origin) return null;
    url.searchParams.set("r", code);
    return url.toString();
  };
  const out: Record<string, string> = {};
  const add = (key: string, url: string | null) => {
    if (url) out[key] = url;
  };
  add("link.book", tagged(`/book/${encodeURIComponent(offer)}`));
  if (offerFacts["offer.page"]) add("link.page", tagged(offerFacts["offer.page"]));
  const own = values["company.video_url"];
  const demo = typeof own === "string" && own ? tagged(own) : null;
  const vsl = offerFacts["offer.video"] ? tagged(`/watch/${encodeURIComponent(offer)}`) : null;
  add("link.watch", demo ?? vsl);
  return out;
}

/** One draft per step and the link code each carries. */
interface Drafts {
  readonly rendered: readonly Rendered[];
  readonly linkCodes: readonly string[];
}

/** Every step rendered against one facts row, or null when a bare fact the copy needs is absent. */
function renderAll(shared: Shared, facts: Facts, seed: string): Drafts | null {
  const linkCodes = shared.sequence.steps.map(() => mintLinkCode());
  try {
    const rendered = shared.sequence.steps.map((step, i) =>
      render(
        shared.templates.get(step.template) as Template,
        {
          ...facts.values,
          ...shared.offerFacts,
          // Said at send, never here: a queued email must not offer a time that passed.
          "call.times": CALL_TIMES,
          ...linkFacts(
            shared.site,
            shared.offer,
            facts.values,
            shared.offerFacts,
            linkCodes[i] as string,
          ),
        },
        seed,
      ),
    );
    return { rendered, linkCodes };
  } catch (err) {
    if (err instanceof MissingFactError) return null;
    throw err;
  }
}

export interface PossibleDuplicate {
  readonly enrollment_id: number;
  readonly company_id: number;
  readonly domain: string;
}

interface EnrollInput {
  readonly kind: EnrollmentKind;
  readonly personId: number | null;
  readonly companyId: number;
  readonly address: AddressRecord;
  readonly alternates: readonly AddressRecord[];
  readonly duplicate: PossibleDuplicate | null;
  readonly drafts: Drafts;
  readonly refused: Readonly<FactRow>;
}

/** Postgres unique_violation, whether raw or wrapped by drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
}

/**
 * One transaction per company: a unique violation from the partial unique indexes must
 * cost this company and nothing else. Returns whether the enrollment landed.
 */
async function enrollCompany(db: Queryable, shared: Shared, input: EnrollInput): Promise<boolean> {
  // Outside the unit on purpose: the authored source behind a version we really rendered
  // is worth keeping even if this company's enroll loses its race.
  for (const step of shared.sequence.steps) {
    await recordTemplateVersion(db, shared, shared.templates.get(step.template) as Template);
  }
  const sender = pinSender(shared.senders, shared.livePerSender);
  let counted: Pick<ComposeStats, "messages_drafted" | "auto_approved">;
  try {
    counted = await db.transaction((tx) =>
      enroll(tx, shared, { ...input, sender, signature: shared.signatures[sender] ?? "" }),
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    shared.stats.skipped_already_enrolled++;
    return false;
  }
  shared.stats.messages_drafted += counted.messages_drafted;
  shared.stats.auto_approved += counted.auto_approved;
  shared.stats.enrolled++;
  if (Object.keys(input.refused).length > 0) shared.stats.facts_refused++;
  shared.livePerSender.set(sender, (shared.livePerSender.get(sender) ?? 0) + 1);
  return true;
}

/** ACTIVE enrollments per roster address, counted once per run; retired inboxes are ignored. */
async function livePerSender(
  db: Queryable,
  senders: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map(senders.map((s) => [s, 0]));
  const rows = (await db.execute(
    sql`SELECT sender, count(*) AS live FROM enrollments WHERE state = 'active' GROUP BY sender`,
  )) as { sender: string; live: string | number }[];
  for (const row of rows) if (counts.has(row.sender)) counts.set(row.sender, Number(row.live));
  return counts;
}

/** The roster inbox carrying the fewest live threads; ties go to roster order. */
function pinSender(senders: readonly string[], live: ReadonlyMap<string, number>): string {
  let best = senders[0] as string;
  for (const s of senders) if ((live.get(s) ?? 0) < (live.get(best) ?? 0)) best = s;
  return best;
}

/** Is this human already enrolled at a company we hold under a sibling domain? A flag, never a refusal. */
async function possibleDuplicateCompany(
  db: Queryable,
  row: EligibleRow,
): Promise<PossibleDuplicate | null> {
  if (!row.full_name || !row.company_domain) return null;
  const normalized = row.full_name.trim().split(/\s+/).join(" ").toLowerCase();
  const rows = (await db.execute(sql`
    SELECT e.id AS enrollment_id, e.company_id, c.domain
    FROM enrollments e
    JOIN people p ON p.id = e.person_id
    JOIN companies c ON c.id = e.company_id
    WHERE e.company_id <> ${row.company_id}
      AND lower(regexp_replace(btrim(p.full_name), '\\s+', ' ', 'g')) = ${normalized}
      AND split_part(c.domain, '.', 1) = split_part(${row.company_domain}, '.', 1)
    ORDER BY e.id
    LIMIT 1`)) as unknown as PossibleDuplicate[];
  const match = rows[0];
  return match === undefined
    ? null
    : { enrollment_id: match.enrollment_id, company_id: match.company_id, domain: match.domain };
}

/** The body exactly as it will ship: template output, one blank line, then the sign-off. */
export const signed = (body: string, signature: string) =>
  signature ? `${body}\n\n${signature}` : body;

/** A Python `secrets.token_urlsafe(24)`-shaped open token. */
export const mintOpenToken = () => randomBytes(24).toString("base64url");

/** The short code a message's site link carries (`?r=`), so a visit names the message. */
export const mintLinkCode = () => randomBytes(9).toString("base64url");

async function enroll(
  tx: Queryable,
  shared: Shared,
  input: EnrollInput & { sender: string; signature: string },
): Promise<Pick<ComposeStats, "messages_drafted" | "auto_approved">> {
  const [row] = await tx
    .insert(enrollments)
    .values({
      personId: input.personId,
      companyId: input.companyId,
      kind: input.kind,
      toEmail: input.address.email,
      sender: input.sender,
      niche: shared.niche,
      sequenceName: shared.sequence.name,
      sequenceSnapshot: {
        name: shared.sequence.name,
        arm: shared.sequence.arm,
        steps: shared.sequence.steps.map((s) => ({ template: s.template, day: s.day })),
      },
      offer: shared.offer,
      state: "active",
      runId: shared.runId,
      contactRound: sql`(SELECT count(*) + 1 FROM enrollments WHERE company_id = ${input.companyId})`,
    })
    .returning({ id: enrollments.id });
  const enrollmentId = (row as { id: number }).id;
  const counted = { messages_drafted: 0, auto_approved: 0 };
  const now = new Date();
  const values = shared.sequence.steps.map((step, index) => {
    const rendered = input.drafts.rendered[index] as Rendered;
    const provenance: Record<string, unknown> = {
      ...rendered.provenance,
      // The chain of ids behind the address on every draft.
      address: input.address,
      // The address of record is the only one written to; the others are recorded.
      address_alternates: input.alternates.map((a) => a.email),
    };
    if (input.duplicate !== null) provenance.possible_duplicate_company = input.duplicate;
    if (Object.keys(input.refused).length > 0) provenance.facts_refused = { ...input.refused };
    let state: "draft" | "approved" = "draft";
    let approvedAt: Date | null = null;
    let approvedBy: ApprovalSource | null = null;
    if (shared.autoApprove) {
      state = transitionMessage(state, "approved") as "approved";
      approvedAt = now;
      approvedBy = "auto";
      counted.auto_approved++;
    }
    counted.messages_drafted++;
    return {
      enrollmentId,
      step: index,
      template: step.template,
      templateVersion: rendered.provenance.version,
      toEmail: input.address.email,
      subject: rendered.subject,
      body: signed(rendered.body, input.signature),
      provenance,
      state,
      runId: shared.runId,
      // Tracking on today; a refresh (refreshQueue) clears it if tracking is off by send day.
      openToken: shared.trackOpens ? mintOpenToken() : null,
      // Minted before render: the draft's `link.*` facts already carry it.
      linkCode: input.drafts.linkCodes[index] as string,
      approvedAt,
      approvedBy,
    };
  });
  await tx.insert(messages).values(values);
  return counted;
}

/** Once per distinct (niche, template, version) rendered this run: store the authored source. */
async function recordTemplateVersion(db: Queryable, shared: Shared, tpl: Template): Promise<void> {
  const key = `${shared.niche}\x00${tpl.name}\x00${tpl.version}`;
  if (shared.recordedVersions.has(key)) return;
  shared.recordedVersions.add(key);
  await db
    .insert(templateVersions)
    .values({
      niche: shared.niche,
      template: tpl.name,
      version: tpl.version,
      source: toSource(tpl),
    })
    .onConflictDoNothing({
      target: [templateVersions.niche, templateVersions.template, templateVersions.version],
    });
}

/**
 * The database side of the email pick: assemble PickState, walk companies under
 * the cache, persist verdicts, fold them into the funnel.
 *
 * Verdicts persist as company-keyed enrichments under (company, kind, model,
 * prompt_version), in the same envelope every LLM stage writes; with no model (`null`)
 * the picks are byRules, under model "deterministic". applyPicks folds them through
 * the EXISTING write paths only: person-associated emails ride the people importer
 * (sighting → SCRAPED candidate), as does a personal address nobody named whose local
 * part reads as a name (jane.doe → Jane Doe); every other grounded role/person address
 * becomes an ordinary lead import. Each keeps the page it was printed on. best_send_to
 * stays in the pick as the send-priority marker, never as a storage gate.
 */
import {
  type Company,
  companies,
  inPlay,
  type LeadSource,
  matchKey,
  nameFromLocalPart,
  type Person,
  type PersonItem,
  type PersonSource,
  people,
  personRow,
  type RawRow,
  runImport,
  runPeopleImport,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { type LlmClient, LlmError, type Tracer, wellFormed } from "@wren/llm";
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { documents, type Enrichment, enrichments } from "../../schema.js";
import { type EmailSignal, SCAN_MODEL, SCAN_VERSION } from "../email-scan.js";
import type { Shard } from "../shard.js";
import { upsertEnrichment } from "../store.js";
import {
  PICK_VERSION,
  type Pick,
  type PickOutcome,
  type PickState,
  RULES_PICKER,
  runPickGraph,
} from "./graph.js";

/** The enrichment `model` a picker writes under. */
const pickerName = (llm: LlmClient | null) => llm?.name ?? RULES_PICKER;

const SNIPPET_CHARS = 500;

/** Deterministic context assembly (DB reads stay outside the graph). */
export async function gatherState(db: Queryable, company: Company): Promise<PickState> {
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, company.id), eq(documents.isShell, false)))
    .orderBy(asc(documents.id));
  let snippet = "";
  const pages: string[] = [];
  for (const doc of docs) {
    if (doc.text) pages.push(doc.url);
    if (!snippet && doc.text)
      snippet = wellFormed(doc.text.slice(0, SNIPPET_CHARS)).split(/\s+/).filter(Boolean).join(" ");
  }
  const signals: EmailSignal[] = [];
  const seen = new Set<string>();
  const scans = docs.length
    ? await db
        .select()
        .from(enrichments)
        .where(
          and(
            inArray(
              enrichments.documentId,
              docs.map((d) => d.id),
            ),
            eq(enrichments.kind, "email_scan"),
            eq(enrichments.model, SCAN_MODEL),
            eq(enrichments.promptVersion, SCAN_VERSION),
          ),
        )
        .orderBy(asc(enrichments.id))
    : [];
  for (const scan of scans) {
    const output = (scan.output ?? {}) as { signals?: EmailSignal[] };
    for (const signal of output.signals ?? []) {
      if (seen.has(signal.email)) continue;
      seen.add(signal.email);
      signals.push(signal);
    }
  }
  // WEBSITE-origin only: registry-fed people were never on the crawled site.
  const known = await db
    .select({
      full_name: people.fullName,
      title: people.title,
      first_name: people.firstName,
      last_name: people.lastName,
    })
    .from(people)
    .where(and(eq(people.companyId, company.id), eq(people.origin, "website")))
    .orderBy(asc(people.id));
  return {
    company: { name: company.name, domain: company.domain, pages, snippet },
    signals,
    people: known,
    no_scannable: !pages.length,
  };
}

export interface PickSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
  shard?: Shard | null | undefined;
}

/**
 * Companies with scanned documents, plus crawled companies with nothing
 * scannable (they get a free no_scannable_content pick), minus companies
 * already successfully picked by this model under the current version.
 */
export async function selectPickTargets(
  db: Queryable,
  llm: LlmClient | null,
  opts: PickSelectOptions = {},
): Promise<Company[]> {
  const scannedCompanies = db
    .select({ id: documents.companyId })
    .from(documents)
    .innerJoin(enrichments, eq(enrichments.documentId, documents.id))
    .where(and(eq(enrichments.kind, "email_scan"), isNotNull(documents.companyId)));
  const scannableCompanies = db
    .select({ id: documents.companyId })
    .from(documents)
    .where(
      and(isNotNull(documents.companyId), ne(documents.text, ""), eq(documents.isShell, false)),
    );
  const crawledCompanies = db
    .select({ id: documents.companyId })
    .from(documents)
    .where(isNotNull(documents.companyId));
  // Successes only: a parse-failed pick stays for provenance but is retried.
  const alreadyPicked = db
    .select({ id: enrichments.companyId })
    .from(enrichments)
    .where(
      and(
        eq(enrichments.kind, "email_pick"),
        eq(enrichments.model, pickerName(llm)),
        eq(enrichments.promptVersion, PICK_VERSION),
        isNotNull(enrichments.companyId),
        sql`${enrichments.output}->>'parse_error' IS NULL`,
      ),
    );
  const conditions = [
    or(
      inArray(companies.id, scannedCompanies),
      and(inArray(companies.id, crawledCompanies), notInArray(companies.id, scannableCompanies)),
    ),
    notInArray(companies.id, alreadyPicked),
    inPlay,
  ];
  if (opts.niche != null) conditions.push(eq(companies.niche, opts.niche));
  if (opts.shard) conditions.push(opts.shard.where(companies.id));
  const q = db
    .select()
    .from(companies)
    .where(and(...conditions))
    .orderBy(asc(companies.id));
  return opts.limit === undefined ? q : q.limit(opts.limit);
}

export interface PickUnitOptions {
  runId?: string | null | undefined;
  tracer?: Tracer | null | undefined;
}

const NO_ENVELOPE = {
  raw_text: null,
  parse_error: null,
  provider_rejected: null,
  api: null,
  call: null,
};

/** Pick for one company and persist it. Throws LlmError on provider failure. */
export async function pickCompany(
  db: Queryable,
  llm: LlmClient | null,
  company: Company,
  opts: PickUnitOptions = {},
): Promise<PickOutcome> {
  const state = await gatherState(db, company);
  const result = await runPickGraph(llm, state, opts);
  // Free routes carry no llm envelope: the row still gets the uniform keys (all null).
  const envelope = result.llm ?? NO_ENVELOPE;
  await upsertEnrichment(db, {
    companyId: company.id,
    kind: "email_pick",
    model: pickerName(llm),
    promptVersion: PICK_VERSION,
    output: { ...envelope, pick: result.pick },
    runId: opts.runId ?? null,
  });
  return result;
}

export interface EmailPickStats {
  selected: number;
  picked: number;
  auto_accepted: number;
  no_signals: number;
  no_content: number;
  classified: number;
  parse_errors: number;
  provider_rejected: number;
  ungrounded_emails: number;
  ungrounded_names: number;
  aborted: string | null;
}

export interface EmailPickRunOptions extends PickSelectOptions, PickUnitOptions {
  checkpoint?: (company: Company) => void | Promise<void>;
}

const METHOD_STAT: Record<string, keyof EmailPickStats> = {
  auto_accept: "auto_accepted",
  no_signals: "no_signals",
  no_scannable_content: "no_content",
};

/**
 * One pick per company; cached forever under (company, kind, model, prompt_version).
 * Auto-accepts and empties are free re-runs; classify hits are bought once per model.
 * Each company commits in its own transaction; a crash loses at most one classify.
 */
export async function runEmailPick(
  db: Queryable,
  llm: LlmClient | null,
  opts: EmailPickRunOptions = {},
): Promise<EmailPickStats> {
  const targets = await selectPickTargets(db, llm, opts);
  const stats: EmailPickStats = {
    selected: targets.length,
    picked: 0,
    auto_accepted: 0,
    no_signals: 0,
    no_content: 0,
    classified: 0,
    parse_errors: 0,
    provider_rejected: 0,
    ungrounded_emails: 0,
    ungrounded_names: 0,
    aborted: null,
  };
  for (const company of targets) {
    let result: PickOutcome;
    try {
      result = await db.transaction((tx) => pickCompany(tx, llm, company, opts));
    } catch (err) {
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
    const key = METHOD_STAT[result.pick.method] ?? "classified";
    (stats[key] as number) += 1;
    if (result.parse_error) stats.parse_errors += 1;
    if (result.provider_rejected) stats.provider_rejected += 1;
    stats.ungrounded_emails += result.pick.ungrounded?.length ?? 0;
    stats.ungrounded_names += result.pick.ungrounded_names?.length ?? 0;
    stats.picked += 1;
    if (opts.checkpoint) await opts.checkpoint(company);
  }
  return stats;
}

/** Person-associated pick emails as a PersonSource: the re-encounter appends a sighting carrying the email. */
class PickPersonSource implements PersonSource {
  readonly sourceType = "email-pick-people";
  readonly sourceRef: string;
  constructor(
    private readonly items: PersonItem[],
    enrichmentIds: number[],
  ) {
    this.sourceRef = `email-picks:${enrichmentIds.join(",")}`;
  }
  rows(): Iterable<PersonItem> {
    return this.items;
  }
}

/** Chosen personless send-to addresses as an ordinary lead import. */
class RoleAddressSource implements LeadSource {
  readonly sourceType = "email-pick-leads";
  readonly sourceRef: string;
  constructor(
    private readonly items: RawRow[],
    enrichmentIds: number[],
  ) {
    this.sourceRef = `email-picks:${enrichmentIds.join(",")}`;
  }
  rows(): Iterable<RawRow> {
    return this.items;
  }
}

export interface ApplyPicksStats extends Record<string, unknown> {
  picks_applied: number;
  person_emails: number;
  /** Of person_emails: a person made from the address itself (jane.doe → Jane Doe). */
  people_from_addresses: number;
  role_leads: number;
  companies_without_send_to: number;
}

/** Fold unapplied verdicts (current version only) into the funnel; stamp applied_at. */
export async function applyPicks(
  db: Queryable,
  opts: { limit?: number } = {},
): Promise<ApplyPicksStats> {
  const q = db
    .select({ enrichment: enrichments, company: companies })
    .from(enrichments)
    .innerJoin(companies, eq(enrichments.companyId, companies.id))
    .where(
      and(
        eq(enrichments.kind, "email_pick"),
        eq(enrichments.promptVersion, PICK_VERSION),
        isNull(enrichments.appliedAt),
      ),
    )
    .orderBy(asc(enrichments.id));
  const rows: Array<{ enrichment: Enrichment; company: Company }> =
    opts.limit === undefined ? await q : await q.limit(opts.limit);
  const stats: ApplyPicksStats = {
    picks_applied: 0,
    person_emails: 0,
    people_from_addresses: 0,
    role_leads: 0,
    companies_without_send_to: 0,
  };
  if (!rows.length) return stats;

  const personItems: PersonItem[] = [];
  const personEnrichmentIds: number[] = [];
  const roleRows: RawRow[] = [];
  const roleEnrichmentIds: number[] = [];

  for (const { enrichment, company } of rows) {
    const pick = ((enrichment.output ?? {}) as { pick?: Pick }).pick;
    const emails = pick?.emails ?? [];
    // Index every person under BOTH key formulas: ground() canonicalizes person_name
    // to the full_name, whose match key differs from (first, last) when a middle name exists.
    const peopleByKey = new Map<string, Person>();
    const known = await db
      .select()
      .from(people)
      .where(and(eq(people.companyId, company.id), eq(people.origin, "website")));
    for (const p of known) {
      for (const key of new Set([
        matchKey(p.firstName, p.lastName, p.fullName),
        matchKey(null, null, p.fullName),
      ])) {
        if (!peopleByKey.has(key)) peopleByKey.set(key, p);
      }
    }
    let anySendTo = false;
    for (const entry of emails) {
      const email = entry.email;
      if (!email) continue;
      const pageUrl = entry.page_url ?? null;
      // The same shape a reading's people carry: "<ref> <page>", the page the address was on.
      const originRef = `email-pick:${enrichment.id}${pageUrl ? ` ${pageUrl}` : ""}`;
      const owner = entry.person_name
        ? peopleByKey.get(matchKey(null, null, entry.person_name))
        : undefined;
      const local = email.split("@")[0] ?? "";
      const domain = company.domain ?? email.split("@")[1] ?? "";
      const onDomain = email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`);
      const read =
        entry.classification === "person" && !owner && onDomain
          ? nameFromLocalPart(local, domain)
          : null;
      if (entry.classification === "person" && (owner || read)) {
        personItems.push(
          personRow({
            companySourceKey: company.sourceKey,
            companyDomain: company.domain,
            companyName: company.name,
            fullName: owner ? owner.fullName : `${read?.firstName} ${read?.lastName}`,
            firstName: owner ? owner.firstName : (read?.firstName ?? null),
            lastName: owner ? owner.lastName : (read?.lastName ?? null),
            title: owner?.title ?? null,
            origin: "website",
            originRef,
            raw: { email, _email_pick: enrichment.id, page_url: pageUrl },
          }),
        );
        personEnrichmentIds.push(enrichment.id);
        stats.person_emails += 1;
        if (!owner) stats.people_from_addresses += 1;
        anySendTo = true;
      } else if (entry.classification === "role" || entry.classification === "person") {
        // A role inbox, or a personal address whose owner the site never named.
        // other_company/noise stay unpromoted by design.
        roleRows.push({
          email,
          first_name: "",
          last_name: "",
          company_name: company.name ?? "",
          website: company.domain ?? "",
          country: company.country ?? "",
          source: "email-pick",
          _email_pick: enrichment.id,
          page_url: pageUrl ?? "",
        });
        roleEnrichmentIds.push(enrichment.id);
        stats.role_leads += 1;
        anySendTo = true;
      }
    }
    if (!anySendTo) stats.companies_without_send_to += 1;
  }

  if (personItems.length)
    await runPeopleImport(db, new PickPersonSource(personItems, personEnrichmentIds));
  if (roleRows.length) {
    await runImport(db, new RoleAddressSource(roleRows, roleEnrichmentIds), {
      defaults: { source: "email-pick" },
    });
  }
  await db
    .update(enrichments)
    .set({ appliedAt: sql`now()` })
    .where(
      inArray(
        enrichments.id,
        rows.map((r) => r.enrichment.id),
      ),
    );
  stats.picks_applied = rows.length;
  return stats;
}

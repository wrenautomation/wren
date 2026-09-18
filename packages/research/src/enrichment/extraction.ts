/**
 * LLM people-extraction over stored documents (funnel L2). Two separately-run
 * steps, each independently cacheable:
 * - runExtraction: every document without an enrichment row for (kind, model,
 *   prompt_version) gets ONE completion; the full response is stored whether or
 *   not it parses. Bumping PROMPT_VERSION re-extracts under a new cache key.
 * - applyExtractions: unapplied, parsed enrichments are folded into the person
 *   inventory through the SAME people importer as registry sources.
 *
 * The prompt asks for evidence-bound facts only and is generic by construction:
 * no industry word, no niche title vocabulary. A niche's own extraction prompt can
 * replace it through ExtractionSpec (same version discipline applies).
 */
import {
  type Company,
  companies,
  type PersonItem,
  type PersonSource,
  parseDirectName,
  personRow,
  personRowError,
  runPeopleImport,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, LlmError, parseModel, type Tracer } from "@wren/llm";
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Document, documents, type Enrichment, enrichments } from "../schema.js";
import type { Shard } from "./shard.js";
import { upsertEnrichment } from "./store.js";

export const PROMPT_VERSION = "v2";
const MAX_TEXT_CHARS = 14000;
// 8192, not the 2048 default: reasoning models spend hidden thinking tokens inside
// max_tokens, and a team page with 20 bios is ~700 visible tokens on top.
const MAX_TOKENS = 8192;

const PROMPT = `Extract the people who work at this company from the web page text below.

Return ONLY a JSON object, no prose, exactly this shape:
{"people": [{"full_name": "...", "title": "..." or null, "email": "..." or null,
"linkedin_url": "..." or null, "bio_facts": ["..."],
"is_testimonial": true or false, "testimonial_org": "..." or null}],
"generic_emails": ["info@..."], "notes": "..." or null}

Rules:
- Only people employed by or leading THIS company. Never article authors
  or people at other firms.
- EXCEPTION — a person quoted as a client, a testimonial author, or a
  case-study contact (e.g. "President, Cordelia Labs" on this company's
  own page) IS included, with is_testimonial=true and testimonial_org set
  to the organization named for them. Never list such a person as staff,
  and never drop them.
- is_testimonial=false and testimonial_org=null for everyone who actually
  works at this company, including its founders.
- email: only if an address is actually printed on the page. Never guess.
- bio_facts: up to 5 short factual strings per person taken from the page
  (education, tenure, specialties, community roles) — usable evidence for
  personalized outreach, no flattery, no inference.
- generic_emails: non-personal addresses printed on the page (info@, ...).
- Empty page or no people: return {"people": [], "generic_emails": []}.

Company: {company}
Page URL: {url}
Page title: {title}

PAGE TEXT:
{text}
`;

const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const ExtractedPerson = z.object({
  // Optional so a nameless entry (Cohere emits full_name: null for an unnamed
  // "Founder") fails softly: dropped by parse, not the whole page.
  full_name: nullableString,
  title: nullableString,
  email: nullableString,
  linkedin_url: nullableString,
  bio_facts: z.array(z.string()).default([]),
  // A client quoted on this company's page, not staff. Kept, never discarded, but tagged.
  is_testimonial: z.boolean().default(false),
  testimonial_org: nullableString,
});
export type ExtractedPerson = z.infer<typeof ExtractedPerson>;

export const ExtractionResult = z
  .object({
    people: z.array(ExtractedPerson).default([]),
    generic_emails: z.array(z.string()).default([]),
    notes: nullableString,
  })
  .transform((r) => ({
    ...r,
    // A nameless entry is not a person we can ever address.
    people: r.people.filter((p) => (p.full_name ?? "").trim()),
  }));
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/** The parsed result, or a reason string; nameless entries dropped. */
export function parseExtraction(text: string): ExtractionResult | string {
  return parseModel(text, ExtractionResult);
}

/**
 * Drop email claims that are not literally on the page. Page text is untrusted
 * prompt input: a fabricated address would enter the SCRAPED trust tier, which
 * proves a domain's pattern with zero verification. Dropped claims are still
 * recorded in the enrichment output.
 */
export function groundEmails(
  parsed: ExtractionResult,
  pageText: string,
): { parsed: ExtractionResult; dropped: string[] } {
  const haystack = pageText.toLowerCase();
  const dropped: string[] = [];
  const people = parsed.people.map((person) => {
    if (person.email && !haystack.includes(person.email.toLowerCase())) {
      dropped.push(person.email);
      return { ...person, email: null };
    }
    return person;
  });
  const generic: string[] = [];
  for (const email of parsed.generic_emails) {
    (haystack.includes(email.toLowerCase()) ? generic : dropped).push(email);
  }
  return { parsed: { ...parsed, people, generic_emails: generic }, dropped };
}

export interface PromptDocument {
  url: string;
  title: string | null;
  text: string;
  companyName: string | null;
}

/** What a niche can override: the prompt template and its version. Defaults are the generic ones. */
export interface ExtractionSpec {
  promptVersion: string;
  /** Template with {company} {url} {title} {text} placeholders. */
  prompt: string;
}
export const DEFAULT_EXTRACTION_SPEC: ExtractionSpec = {
  promptVersion: PROMPT_VERSION,
  prompt: PROMPT,
};

export function buildExtractionPrompt(
  document: PromptDocument,
  spec: ExtractionSpec = DEFAULT_EXTRACTION_SPEC,
): string {
  return spec.prompt
    .replace("{company}", document.companyName || "(unknown)")
    .replace("{url}", document.url)
    .replace("{title}", document.title ?? "")
    .replace("{text}", document.text.slice(0, MAX_TEXT_CHARS));
}

export interface ExtractionStats {
  selected: number;
  extracted: number;
  parse_errors: number;
  provider_rejected: number;
  ungrounded_emails: number;
  /** Already extracted under an older prompt version: a paid backlog `reextract` opts into. */
  skipped_older_version: number;
  aborted: string | null;
}

export interface ExtractionSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
  shard?: Shard | null | undefined;
  /** Re-buy documents already extracted under an older prompt. */
  reextract?: boolean | undefined;
  spec?: ExtractionSpec | undefined;
}

export type ExtractionTarget = Document & { companyName: string | null };

/**
 * Documents to extract for this model: no successful row under the current version;
 * non-empty text; not a shell. Rows extracted under ANY other version are skipped
 * (and counted) unless `reextract`.
 */
export async function selectExtractionTargets(
  db: Queryable,
  llm: LlmClient,
  opts: ExtractionSelectOptions = {},
): Promise<{ targets: ExtractionTarget[]; skippedOlderVersion: number }> {
  const version = (opts.spec ?? DEFAULT_EXTRACTION_SPEC).promptVersion;
  // The cache holds SUCCESSES: a parse-failed row stays for provenance but does not count as done.
  const successful = and(
    eq(enrichments.kind, "people_extraction"),
    eq(enrichments.model, llm.name),
    sql`${enrichments.output}->>'parse_error' IS NULL`,
  );
  const cached = db
    .select({ id: enrichments.documentId })
    .from(enrichments)
    .where(and(successful, eq(enrichments.promptVersion, version)));
  const olderVersion = db
    .select({ id: enrichments.documentId })
    .from(enrichments)
    .where(and(successful, ne(enrichments.promptVersion, version)));
  const scoped = [
    notInArray(documents.id, cached),
    ne(documents.text, ""),
    eq(documents.isShell, false),
  ];
  if (opts.niche != null) scoped.push(eq(companies.niche, opts.niche));
  if (opts.shard) scoped.push(opts.shard.where(documents.id));

  let skippedOlderVersion = 0;
  const conditions = [...scoped];
  if (!opts.reextract) {
    conditions.push(notInArray(documents.id, olderVersion));
    const [r] = await db
      .select({ n: count() })
      .from(documents)
      .leftJoin(companies, eq(documents.companyId, companies.id))
      .where(and(...scoped, inArray(documents.id, olderVersion)));
    skippedOlderVersion = r?.n ?? 0;
  }
  const q = db
    .select({ document: documents, companyName: companies.name })
    .from(documents)
    .leftJoin(companies, eq(documents.companyId, companies.id))
    .where(and(...conditions))
    .orderBy(asc(documents.id));
  const rows = opts.limit === undefined ? await q : await q.limit(opts.limit);
  return {
    targets: rows.map((r) => ({ ...r.document, companyName: r.companyName ?? null })),
    skippedOlderVersion,
  };
}

export interface ExtractionUnitOptions {
  runId?: string | null | undefined;
  tracer?: Tracer | null | undefined;
  spec?: ExtractionSpec | undefined;
}

export type ExtractionOutcome = "extracted" | "parse_error" | "provider_rejected";

/**
 * One completion for one document, persisted whatever the outcome. Throws LlmError
 * on provider failure (the loop decides to abort).
 */
export async function extractDocument(
  db: Queryable,
  llm: LlmClient,
  doc: ExtractionTarget,
  opts: ExtractionUnitOptions = {},
): Promise<{ outcome: ExtractionOutcome; ungrounded: string[] }> {
  const spec = opts.spec ?? DEFAULT_EXTRACTION_SPEC;
  const result = await completeAndParse(llm, buildExtractionPrompt(doc, spec), ExtractionResult, {
    maxTokens: MAX_TOKENS,
    runId: opts.runId ?? null,
    tracer: opts.tracer ?? null,
    name: "people_extraction",
    metadata: { document_id: doc.id, company_id: doc.companyId, url: doc.url },
  });
  let parsed: ExtractionResult | null = result.parsed;
  let dropped: string[] = [];
  if (parsed !== null) ({ parsed, dropped } = groundEmails(parsed, doc.text));
  await upsertEnrichment(db, {
    documentId: doc.id,
    kind: "people_extraction",
    model: llm.name,
    promptVersion: spec.promptVersion,
    output: result.envelope({ parsed, ungrounded_emails: dropped }),
    runId: opts.runId ?? null,
  });
  const outcome: ExtractionOutcome = result.providerRejected
    ? "provider_rejected"
    : result.parseError
      ? "parse_error"
      : "extracted";
  return { outcome, ungrounded: dropped };
}

export interface ExtractionRunOptions extends ExtractionSelectOptions, ExtractionUnitOptions {
  checkpoint?: (doc: ExtractionTarget) => void | Promise<void>;
}

/**
 * One completion per un-enriched document; every response persisted in its own
 * transaction. A provider failure aborts with partial progress kept.
 */
export async function runExtraction(
  db: Queryable,
  llm: LlmClient,
  opts: ExtractionRunOptions = {},
): Promise<ExtractionStats> {
  const { targets, skippedOlderVersion } = await selectExtractionTargets(db, llm, opts);
  const stats: ExtractionStats = {
    selected: targets.length,
    extracted: 0,
    parse_errors: 0,
    provider_rejected: 0,
    ungrounded_emails: 0,
    skipped_older_version: skippedOlderVersion,
    aborted: null,
  };
  for (const doc of targets) {
    let unit: Awaited<ReturnType<typeof extractDocument>>;
    try {
      unit = await db.transaction((tx) => extractDocument(tx, llm, doc, opts));
    } catch (err) {
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
    stats.ungrounded_emails += unit.ungrounded.length;
    if (unit.outcome === "provider_rejected") stats.provider_rejected += 1;
    else if (unit.outcome === "parse_error") stats.parse_errors += 1;
    else stats.extracted += 1;
    if (opts.checkpoint) await opts.checkpoint(doc);
  }
  return stats;
}

type ApplicableRow = { enrichment: Enrichment; document: Document; company: Company };

/** Unapplied enrichments as a PersonSource: website people enter the inventory through the same importer. */
export class ExtractionPersonSource implements PersonSource {
  readonly sourceType = "website-extraction";
  readonly sourceRef: string;
  constructor(private readonly rowsIn: ApplicableRow[]) {
    this.sourceRef = `enrichments:${rowsIn.map((r) => r.enrichment.id).join(",")}`;
  }
  *rows(): Iterable<PersonItem> {
    for (const { enrichment, document, company } of this.rowsIn) {
      const output = (enrichment.output ?? {}) as {
        parsed?: { people?: ExtractedPerson[] } | null;
      };
      for (const person of output.parsed?.people ?? []) {
        const fullName = (person.full_name ?? "").trim();
        if (!fullName) {
          yield personRowError(
            "extracted person without a name",
            person as Record<string, unknown>,
          );
          continue;
        }
        const [full, first, last] = parseDirectName(fullName) ?? [fullName, null, null];
        yield personRow({
          companySourceKey: company.sourceKey,
          companyDomain: company.domain,
          companyName: company.name,
          fullName: full,
          firstName: first,
          lastName: last,
          title: (person.title ?? "").trim() || null,
          isTestimonial: Boolean(person.is_testimonial),
          testimonialOrg: (person.testimonial_org ?? "").trim() || null,
          origin: "website",
          originRef: `enrichment:${enrichment.id} ${document.url}`,
          asOf: document.fetchedAt ? document.fetchedAt.toISOString().slice(0, 10) : null,
          linkedinUrl: (person.linkedin_url ?? "").trim() || null,
          raw: { ...person, _document_url: document.url },
        });
      }
    }
  }
}

export interface ApplyExtractionsStats extends Record<string, unknown> {
  enrichments_applied: number;
}

/** Fold unapplied parsed enrichments (current version only) into people; stamp applied_at. */
export async function applyExtractions(
  db: Queryable,
  opts: { limit?: number; spec?: ExtractionSpec } = {},
): Promise<ApplyExtractionsStats> {
  const version = (opts.spec ?? DEFAULT_EXTRACTION_SPEC).promptVersion;
  const q = db
    .select({ enrichment: enrichments, document: documents, company: companies })
    .from(enrichments)
    .innerJoin(documents, eq(enrichments.documentId, documents.id))
    .innerJoin(companies, eq(documents.companyId, companies.id))
    .where(
      and(
        eq(enrichments.kind, "people_extraction"),
        eq(enrichments.promptVersion, version),
        isNull(enrichments.appliedAt),
        // ->> yields SQL NULL for both a missing key and JSON null.
        sql`${enrichments.output}->>'parsed' IS NOT NULL`,
        isNotNull(documents.companyId),
      ),
    )
    .orderBy(asc(enrichments.id));
  const rows: ApplicableRow[] = opts.limit === undefined ? await q : await q.limit(opts.limit);
  if (!rows.length) return { enrichments_applied: 0 };
  const { stats } = await runPeopleImport(db, new ExtractionPersonSource(rows));
  await db
    .update(enrichments)
    .set({ appliedAt: sql`now()` })
    .where(
      inArray(
        enrichments.id,
        rows.map((r) => r.enrichment.id),
      ),
    );
  return { ...stats, enrichments_applied: rows.length };
}

/**
 * Outside readings: people extraction done by a reader outside the LLM seam (an
 * operator's agent session), carried in and out as files. Export cuts each firm's
 * crawled pages down to the lines near leadership words, so a reader sees names
 * and titles, not whole sites. Load grounds every claim in the stored page (the
 * name and any email must be printed there), writes one people_extraction
 * enrichment per document read, and folds them into people like a model run.
 */
import { companies, inPlay } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { documents, enrichments } from "../schema.js";
import { type ApplyExtractionsStats, applyExtractions, ExtractedPerson } from "./extraction.js";
import { upsertEnrichment } from "./store.js";

/** Words that sit near a decision maker's name on a team or about page. */
export const LEADERSHIP_WORDS = [
  "owner",
  "founder",
  "founded",
  "president",
  "ceo",
  "chief",
  "principal",
  "managing",
  "director",
  "partner",
  "vp",
  "vice president",
  "general manager",
  "head of",
  "leadership",
  "our team",
  "meet ",
];

const WORD_RE = new RegExp(
  LEADERSHIP_WORDS.map((w) => `\\b${w.trim().replace(/ /g, "\\s+")}`).join("|"),
  "i",
);

/** Lines within `radius` of a leadership word, joined; gaps marked "…"; capped at `max` chars. */
export function leadershipExcerpt(text: string, radius = 2, max = 1500): string {
  const lines = text.split("\n");
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (!WORD_RE.test(line)) return;
    for (let j = Math.max(0, i - radius); j <= Math.min(lines.length - 1, i + radius); j++)
      keep.add(j);
  });
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1 && out.length) out.push("…");
    out.push((lines[i] ?? "").slice(0, 400));
    last = i;
  }
  return out.join("\n").slice(0, max);
}

export interface ReadingPage {
  document_id: number;
  url: string;
  excerpt: string;
}
export interface ReadingFirm {
  company_id: number;
  name: string | null;
  domain: string | null;
  pages: ReadingPage[];
}

/**
 * In-play firms of a niche with crawled text, no people yet, and no outside reading
 * by this reader; only pages with a leadership excerpt are carried.
 */
export async function exportReadings(
  db: Queryable,
  opts: { niche: string; reader: string; limit?: number; maxPerFirm?: number },
): Promise<ReadingFirm[]> {
  const read = sql`EXISTS (SELECT 1 FROM ${enrichments} e WHERE e.document_id = ${documents.id}
    AND e.kind = 'people_extraction' AND e.model = ${opts.reader})`;
  const named = sql`EXISTS (SELECT 1 FROM people p WHERE p.company_id = ${companies.id})`;
  const rows = await db
    .select({
      companyId: companies.id,
      name: companies.name,
      domain: companies.domain,
      documentId: documents.id,
      url: documents.url,
      text: documents.text,
    })
    .from(documents)
    .innerJoin(companies, eq(documents.companyId, companies.id))
    .where(
      and(
        eq(companies.niche, opts.niche),
        inPlay,
        ne(documents.text, ""),
        eq(documents.isShell, false),
        sql`NOT ${named}`,
        sql`NOT ${read}`,
      ),
    )
    .orderBy(asc(companies.id), asc(documents.id));
  const firms = new Map<number, ReadingFirm>();
  const maxPerFirm = opts.maxPerFirm ?? 3000;
  for (const r of rows) {
    const excerpt = leadershipExcerpt(r.text);
    if (!excerpt) continue;
    let firm = firms.get(r.companyId);
    if (!firm) {
      if (opts.limit !== undefined && firms.size >= opts.limit) break;
      firm = { company_id: r.companyId, name: r.name, domain: r.domain, pages: [] };
      firms.set(r.companyId, firm);
    }
    const used = firm.pages.reduce((n, p) => n + p.excerpt.length, 0);
    if (used + excerpt.length > maxPerFirm) continue;
    firm.pages.push({ document_id: r.documentId, url: r.url, excerpt });
  }
  return [...firms.values()];
}

/** One reader's answer for one firm: people, each tied to the page that names them. */
export const ReadingResult = z.object({
  company_id: z.number().int(),
  people: z.array(ExtractedPerson.extend({ document_id: z.number().int() })).default([]),
});
export type ReadingResult = z.infer<typeof ReadingResult>;

export interface LoadReadingsStats extends Record<string, unknown> {
  firms: number;
  documents_read: number;
  people_claimed: number;
  ungrounded_names: number;
  ungrounded_emails: number;
  applied: ApplyExtractionsStats;
}

const printed = (haystack: string, needle: string) =>
  haystack.toLowerCase().replace(/\s+/g, " ").includes(needle.toLowerCase().replace(/\s+/g, " "));

/**
 * Write the reader's results as enrichments (one per exported page, empty when the
 * page named nobody), then apply. A name not printed on its page is dropped, as is
 * an email: page text is untrusted and a reader can invent.
 */
export async function loadReadings(
  db: Queryable,
  opts: {
    reader: string;
    promptVersion: string;
    exported: ReadingFirm[];
    results: ReadingResult[];
  },
): Promise<LoadReadingsStats> {
  const byFirm = new Map(opts.results.map((r) => [r.company_id, r]));
  const docIds = opts.exported
    .filter((f) => byFirm.has(f.company_id))
    .flatMap((f) => f.pages.map((p) => p.document_id));
  const texts = new Map<number, string>();
  for (let i = 0; i < docIds.length; i += 500) {
    const rows = await db
      .select({ id: documents.id, text: documents.text })
      .from(documents)
      .where(inArray(documents.id, docIds.slice(i, i + 500)));
    for (const r of rows) texts.set(r.id, r.text);
  }
  const stats = {
    firms: 0,
    documents_read: 0,
    people_claimed: 0,
    ungrounded_names: 0,
    ungrounded_emails: 0,
  };
  for (const firm of opts.exported) {
    const result = byFirm.get(firm.company_id);
    if (!result) continue;
    stats.firms += 1;
    for (const page of firm.pages) {
      const text = texts.get(page.document_id) ?? "";
      const dropped: string[] = [];
      const people = result.people
        .filter((p) => p.document_id === page.document_id)
        .flatMap((p) => {
          stats.people_claimed += 1;
          if (!p.full_name || !printed(text, p.full_name)) {
            stats.ungrounded_names += 1;
            dropped.push(p.full_name ?? "");
            return [];
          }
          const { document_id: _, ...person } = p;
          if (person.email && !printed(text, person.email)) {
            stats.ungrounded_emails += 1;
            dropped.push(person.email);
            return [{ ...person, email: null }];
          }
          return [person];
        });
      await upsertEnrichment(db, {
        documentId: page.document_id,
        kind: "people_extraction",
        model: opts.reader,
        promptVersion: opts.promptVersion,
        output: {
          parsed: { people, generic_emails: [], notes: null },
          ungrounded: dropped,
          excerpt_chars: page.excerpt.length,
        },
      });
      stats.documents_read += 1;
    }
  }
  const applied = await applyExtractions(db);
  return { ...stats, applied };
}

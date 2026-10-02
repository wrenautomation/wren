/**
 * Lift phone numbers out of pages we already crawled. A number a business put
 * on its own site is the `published` basis: the document row and its URL are
 * the evidence, stored with the contact.
 *
 * Two readers per page: `tel:` links (the site said "this is a phone number"),
 * then plain text. Every hit goes through `toUsE164`, so only valid US numbers
 * are kept. Toll-free numbers are stored (we keep what we find) but land as
 * `unreachable`: they are switchboards, never a person's phone. Companies in a
 * held niche are never read.
 */
import { companies } from "@wren/core/schema";
import type { Db } from "@wren/db";
import { telHrefs } from "@wren/research/pages";
import { documents } from "@wren/research/schema";
import { and, asc, eq, gt, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { isTollFree, toUsE164 } from "./phone.js";
import { smsContacts } from "./schema.js";

export type FoundKind = "tel_link" | "page_text";

export interface FoundPhone {
  e164: string;
  kind: FoundKind;
}

// NANP shapes as people type them: optional +1, area code (parens optional), 3, 4.
const TEXT_PHONE = /(?<![\d+])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)/g;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Every distinct valid US number on one page, `tel:` links first. */
export function phonesInPage(html: string | null, text: string | null): FoundPhone[] {
  return phonesOf(telHrefs(html ?? ""), text);
}

/** The same from a page's `tel:` targets and text: what an archived page keeps. */
export function phonesOf(tels: readonly string[], text: string | null): FoundPhone[] {
  const seen = new Map<string, FoundKind>();
  for (const tel of tels) {
    const e164 = toUsE164(decode(tel).split(/[;,?]/)[0] as string);
    if (e164 && !seen.has(e164)) seen.set(e164, "tel_link");
  }
  for (const m of (text ?? "").matchAll(TEXT_PHONE)) {
    const e164 = toUsE164(m[0]);
    if (e164 && !seen.has(e164)) seen.set(e164, "page_text");
  }
  return [...seen].map(([e164, kind]) => ({ e164, kind }));
}

export interface LiftOptions {
  /** Only this niche; default every niche but the held ones. */
  niche?: string | null;
  /** Niches never read (William's holds). */
  heldNiches: readonly string[];
  /** Pages per batch. */
  batch?: number;
  /** Stop after this many pages (a sample run). */
  limit?: number | null;
  onBatch?: (stats: LiftStats) => void | Promise<void>;
}

export interface LiftStats {
  pages: number;
  pagesWithPhones: number;
  found: number;
  added: number;
  tollFree: number;
  companies: number;
}

/**
 * One pass over crawled pages, keyset by document id; each batch commits on
 * its own, so Ctrl-C loses at most one batch and a re-run skips what is stored.
 */
export async function liftPhones(db: Db, opts: LiftOptions): Promise<LiftStats> {
  const stats: LiftStats = {
    pages: 0,
    pagesWithPhones: 0,
    found: 0,
    added: 0,
    tollFree: 0,
    companies: 0,
  };
  const touched = new Set<number>();
  const batch = opts.batch ?? 200;
  let after = 0;
  for (;;) {
    const where = [
      gt(documents.id, after),
      isNotNull(documents.companyId),
      or(
        sql`${documents.html} LIKE '%tel:%'`,
        sql`cardinality(${documents.telHrefs}) > 0`,
        sql`${documents.text} ~ '[0-9]{3}[^0-9]{0,2}[0-9]{3}[^0-9]?[0-9]{4}'`,
      ),
    ];
    if (opts.niche) where.push(eq(companies.niche, opts.niche));
    if (opts.heldNiches.length > 0) {
      where.push(
        or(sql`${companies.niche} IS NULL`, notInArray(companies.niche, [...opts.heldNiches])),
      );
    }
    const room = opts.limit ? Math.min(batch, opts.limit - stats.pages) : batch;
    if (room <= 0) break;
    const rows = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        url: documents.url,
        html: documents.html,
        telHrefs: documents.telHrefs,
        text: documents.text,
        niche: companies.niche,
      })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(...where))
      .orderBy(asc(documents.id))
      .limit(room);
    if (rows.length === 0) break;
    after = rows[rows.length - 1]?.id ?? after;
    const values = [];
    for (const row of rows) {
      stats.pages += 1;
      // An archived page kept its `tel:` targets; the HTML stays in the bucket.
      const tels = row.html !== null ? telHrefs(row.html) : (row.telHrefs ?? []);
      const found = phonesOf(tels, row.text);
      if (found.length > 0) stats.pagesWithPhones += 1;
      for (const f of found) {
        stats.found += 1;
        const tollFree = isTollFree(f.e164);
        values.push({
          e164: f.e164,
          companyId: row.companyId as number,
          sourceDocumentId: row.id,
          sourceUrl: row.url,
          sourceKind: f.kind,
          basis: "published" as const,
          lineType: tollFree ? ("toll_free" as const) : ("unknown" as const),
          state: tollFree ? ("unreachable" as const) : ("new" as const),
          stateReason: tollFree ? "toll-free: a switchboard, not a phone" : null,
          niche: row.niche,
        });
      }
    }
    if (values.length > 0) {
      const inserted = await db
        .insert(smsContacts)
        .values(values)
        .onConflictDoNothing()
        .returning({ companyId: smsContacts.companyId, lineType: smsContacts.lineType });
      stats.added += inserted.length;
      for (const r of inserted) {
        if (r.companyId !== null) touched.add(r.companyId);
        if (r.lineType === "toll_free") stats.tollFree += 1;
      }
      stats.companies = touched.size;
    }
    await opts.onBatch?.(stats);
  }
  return stats;
}

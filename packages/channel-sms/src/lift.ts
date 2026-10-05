/**
 * Lift the phone numbers the pool's `contacts` stage read off firms' own pages
 * (`own_contact_points`, kind phone: never a number on many firms' sites) into texting contacts. A number a business put
 * on its own site is the `published` basis: the page and its URL are the
 * evidence, stored with the contact. Toll-free numbers are stored (we keep what
 * we find) but land as `unreachable`: they are switchboards, never a person's
 * phone. Companies in a held niche are never lifted.
 */
import { companies } from "@wren/core/schema";
import type { Db } from "@wren/db";
import { ownContactPoints } from "@wren/research/schema";
import { and, asc, eq, gt, notInArray, or, type SQL, sql } from "drizzle-orm";
import { isTollFree } from "./phone.js";
import { smsContacts } from "./schema.js";

export interface LiftOptions {
  /** Only this niche; default every niche but the held ones. */
  niche?: string | null;
  /** Niches never read (William's holds). */
  heldNiches: readonly string[];
  /** Numbers per batch. */
  batch?: number;
  /** Stop after this many numbers (a sample run). */
  limit?: number | null;
  onBatch?: (stats: LiftStats) => void | Promise<void>;
}

export interface LiftStats {
  /** Published numbers read. */
  read: number;
  added: number;
  tollFree: number;
  companies: number;
}

/**
 * One pass over published numbers, keyset by id; each batch commits on its
 * own, so Ctrl-C loses at most one batch and a re-run skips what is stored.
 */
export async function liftPhones(db: Db, opts: LiftOptions): Promise<LiftStats> {
  const stats: LiftStats = { read: 0, added: 0, tollFree: 0, companies: 0 };
  const touched = new Set<number>();
  const batch = opts.batch ?? 500;
  let after = 0;
  for (;;) {
    const where: (SQL | undefined)[] = [
      gt(ownContactPoints.id, after),
      eq(ownContactPoints.kind, "phone"),
    ];
    if (opts.niche) where.push(eq(companies.niche, opts.niche));
    if (opts.heldNiches.length > 0) {
      where.push(
        or(sql`${companies.niche} IS NULL`, notInArray(companies.niche, [...opts.heldNiches])),
      );
    }
    const room = opts.limit ? Math.min(batch, opts.limit - stats.read) : batch;
    if (room <= 0) break;
    const rows = await db
      .select({
        id: ownContactPoints.id,
        e164: ownContactPoints.value,
        companyId: ownContactPoints.companyId,
        documentId: ownContactPoints.documentId,
        url: ownContactPoints.sourceUrl,
        source: ownContactPoints.source,
        niche: companies.niche,
      })
      .from(ownContactPoints)
      .innerJoin(companies, eq(companies.id, ownContactPoints.companyId))
      .where(and(...where))
      .orderBy(asc(ownContactPoints.id))
      .limit(room);
    if (rows.length === 0) break;
    after = rows[rows.length - 1]?.id ?? after;
    stats.read += rows.length;
    const values = rows.map((row) => {
      const tollFree = isTollFree(row.e164);
      return {
        e164: row.e164,
        companyId: row.companyId,
        sourceDocumentId: row.documentId,
        sourceUrl: row.url,
        sourceKind: row.source === "link" ? ("tel_link" as const) : ("page_text" as const),
        basis: "published" as const,
        lineType: tollFree ? ("toll_free" as const) : ("unknown" as const),
        state: tollFree ? ("unreachable" as const) : ("new" as const),
        stateReason: tollFree ? "toll-free: a switchboard, not a phone" : null,
        niche: row.niche,
      };
    });
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
    await opts.onBatch?.(stats);
  }
  return stats;
}

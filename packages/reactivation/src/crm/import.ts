/**
 * CRM import: the people importer does people and companies; this adds, per row,
 * the crm_contacts record and the CRM's email as a contact candidate (evidence
 * `crm`, unverified). Re-importing the same export updates its rows in place.
 */
import { contactCandidates } from "@wren/channel-email/schema";
import { emailDomain, emailSyntaxError, type PeopleImportStats, runPeopleImport } from "@wren/core";
import { type ImportBatch, imports } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { crmContacts } from "../schema.js";
import type { CrmCsvSource } from "./source.js";

export interface CrmImportStats extends PeopleImportStats {
  /** Unique CRM records; a repeated id updates the earlier row's record. */
  crm_contacts: number;
  crm_ids_repeated: number;
  candidates_added: number;
  emails_missing: number;
  emails_bad: number;
}

export async function runCrmImport(
  db: Queryable,
  source: CrmCsvSource,
  opts: { niche?: string | null } = {},
): Promise<{ batch: ImportBatch; stats: CrmImportStats }> {
  const extra = {
    crm_contacts: 0,
    crm_ids_repeated: 0,
    candidates_added: 0,
    emails_missing: 0,
    emails_bad: 0,
  };
  const keys = new Set<string>();
  const result = await runPeopleImport(db, source, {
    niche: opts.niche ?? null,
    onPerson: async ({ person, company, row, rowNumber, batch }) => {
      const rec = source.record(rowNumber);
      if (!rec) throw new Error(`crm import: no record for row ${rowNumber}`);
      const values = {
        personId: person.id,
        companyId: company.id,
        importId: batch.id,
        rowNumber,
        format: source.format.name,
        crmKey: rec.crmKey,
        email: rec.email,
        phone: rec.phone,
        owner: rec.owner,
        status: rec.status,
        lastContactedOn: rec.lastContactedOn,
        lastPlacementOn: rec.lastPlacementOn,
        addedOn: rec.addedOn,
        raw: row.raw,
      };
      const { crmKey: _, format: __, ...update } = values;
      await db
        .insert(crmContacts)
        .values(values)
        .onConflictDoUpdate({
          target: [crmContacts.format, crmContacts.crmKey],
          set: { ...update, updatedAt: sql`now()` },
        });
      if (keys.has(rec.crmKey)) extra.crm_ids_repeated += 1;
      else {
        keys.add(rec.crmKey);
        extra.crm_contacts += 1;
      }

      if (!rec.email) {
        extra.emails_missing += 1;
        return;
      }
      if (emailSyntaxError(rec.email)) {
        extra.emails_bad += 1;
        return;
      }
      const added = await db
        .insert(contactCandidates)
        .values({
          personId: person.id,
          email: rec.email,
          domain: emailDomain(rec.email),
          evidence: "crm",
          rank: 0,
          state: "candidate",
          sourceRef: `crm:${batch.id}:${rowNumber}`,
        })
        .onConflictDoNothing()
        .returning({ id: contactCandidates.id });
      extra.candidates_added += added.length;
    },
  });
  const stats = { ...result.stats, ...extra };
  await db.update(imports).set({ stats }).where(eq(imports.id, result.batch.id));
  return { batch: { ...result.batch, stats }, stats };
}

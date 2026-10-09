/**
 * Connected apps land here (designs/2026-10-09-connectors.md): a sync's people as a CSV through
 * the CRM import, so a live read and an export of the same record are one `crm_contacts` row.
 */
import type { CrmLanding } from "@wren/connectors";
import { and, eq, inArray } from "drizzle-orm";
import { crmContacts } from "../schema.js";
import { CRM_FORMATS } from "./formats.js";
import { runCrmImport } from "./import.js";
import { CrmCsvSource } from "./source.js";

export const crmLanding: CrmLanding = {
  async land(db, o) {
    const format = CRM_FORMATS.get(o.format);
    if (!format) throw new Error(`no CRM format ${o.format}`);
    await runCrmImport(db, new CrmCsvSource(format, o.ref, o.csv));
  },
  async contacts(db, format, ids) {
    if (!ids.length) return [];
    return db
      .select({ id: crmContacts.crmKey, email: crmContacts.email, phone: crmContacts.phone })
      .from(crmContacts)
      .where(and(eq(crmContacts.format, format), inArray(crmContacts.crmKey, [...ids])));
  },
};

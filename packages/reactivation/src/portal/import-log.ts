/**
 * The Import page's list: each file loaded into a client's contacts (`runCrmImport`), with what
 * it did. Connected apps land through the same import every hour; their pulls are left out, since
 * a person looks here for the files they loaded.
 */
import { CONNECTOR_APPS } from "@wren/connectors/apps";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { CRM_FORMATS } from "../crm/formats.js";

/** How each source reads on screen. */
export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "crm-generic": "Any contact export",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  bullhorn: "Bullhorn",
  quickbooks: "QuickBooks",
  jobber: "Jobber",
};
/** The most imports the list holds, newest first. */
const KEPT = 200;

const FROM_APPS = `^(${CONNECTOR_APPS.join("|")}):`;
const num = (key: string) => sql.raw(`coalesce((i.stats->>'${key}')::int, 0)`);

/** One row per import, newest first: counts from the batch, reasons from its rejected rows. */
export async function importRows(db: Queryable): Promise<Record<string, unknown>[]> {
  const rows = (await db.execute(sql`
    select i.id::text id, i.imported_at at, i.source_ref file, i.source_type source,
      ${num("rows")} rows, ${num("people_created")} created, ${num("people_seen")} merged,
      ${num("errors")} skipped,
      left((select string_agg(r.reason || ' (' || r.n || ')', '; ' order by r.n desc, r.reason)
        from (select e.reason, count(*)::int n from import_errors e
          where e.import_id = i.id and e.kind = 'rejected' group by e.reason) r), 400) why,
      nullif(concat_ws('; ',
        case when i.stats->>'replay_of' is not null
          then 'Same file as import ' || (i.stats->>'replay_of') end,
        case when ${num("emails_missing")} > 0
          then ${num("emails_missing")} || ' with no email' end,
        case when ${num("emails_bad")} > 0
          then ${num("emails_bad")} || ' with an email that looks wrong' end,
        case when ${num("company_domain_conflicts")} > 0
          then ${num("company_domain_conflicts")} || ' with a website that belongs to another company' end
      ), '') notes
    from imports i
    where i.stats ? 'crm_contacts' and i.source_ref !~ ${FROM_APPS}
    order by i.id desc limit ${KEPT}`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    source: SOURCE_LABELS[String(r.source)] ?? CRM_FORMATS.get(String(r.source))?.name ?? r.source,
  }));
}

/**
 * Keep's site visits (designs/2026-10-07-health.md, Keep): forms sent on the client's own Sites
 * pages and forms in the last 30 days, matched to its accounts. A known contact's email names
 * the person and their company; else a work address's domain names the company. Free mail and
 * platform domains never match. Each form lands once (`account_visits.entry`).
 * `main` holds Sites; `db` is the client's database.
 */
import { emailDomain, emailSyntaxError, isFreemail, isPlatformDomain } from "@wren/core";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { accountVisits } from "./schema.js";

/** The window Keep shows a visit for; older forms aren't read. */
const DAYS = 30;

export interface VisitStats {
  /** Forms with an email sent in the window. */
  read: number;
  /** Newly matched to an account. */
  added: number;
}

type Entry = {
  id: string;
  what: string;
  at: Date;
  email: string;
};

export async function readVisits(
  main: Queryable,
  db: Queryable,
  clientId: string,
  now: Date,
): Promise<VisitStats> {
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const rows = await main.execute<Entry>(sql`
    select id, coalesce(nullif(form_name, ''), nullif(page_title, ''), 'a form') what, at,
      lower(trim(email)) email
    from site_entry_records
    where owner = ${clientId} and at > ${since.toISOString()}::timestamptz
      and coalesce(email, '') <> ''`);
  const entries = rows.filter((e) => !emailSyntaxError(e.email));
  if (!entries.length) return { read: 0, added: 0 };

  const emails = [...new Set(entries.map((e) => e.email))];
  const domains = [
    ...new Set(emails.map(emailDomain).filter((d) => !isFreemail(d) && !isPlatformDomain(d))),
  ];
  const people = new Map<string, { person: number; company: number }>();
  for (const r of await db.execute<{ email: string; person: number; company: number }>(sql`
      select distinct on (lower(email)) lower(email) email, person_id person, company_id company
      from crm_contacts where lower(email) in (select jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb))
      order by lower(email), updated_at desc, id desc`))
    people.set(r.email, { person: r.person, company: r.company });
  const firms = new Map<string, number>();
  if (domains.length)
    for (const r of await db.execute<{ domain: string; id: number }>(sql`
        select domain, id from companies where domain in (select jsonb_array_elements_text(${JSON.stringify(domains)}::jsonb))`))
      firms.set(r.domain, r.id);

  const values = entries.flatMap((e) => {
    const known = people.get(e.email);
    const company = known?.company ?? firms.get(emailDomain(e.email));
    if (company === undefined) return [];
    return [
      {
        entry: e.id,
        companyId: company,
        personId: known?.person ?? null,
        email: e.email.slice(0, 320),
        what: e.what,
        at: new Date(e.at),
      },
    ];
  });
  const added = values.length
    ? await db
        .insert(accountVisits)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: accountVisits.id })
    : [];
  return { read: entries.length, added: added.length };
}

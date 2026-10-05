/**
 * The CRM health report: what the export says about the list before anything is
 * sent. Counts, not judgments, plus one gate: when more than 10% of the checked
 * addresses are dead, the list gets cleaned before a single send (a bad list burns
 * the client's new domains).
 */
import { emailDomain, emailSyntaxError, isFreemail, isRoleLocalpart } from "@wren/core";
import { type Queryable, snapshot } from "@wren/db";
import { sql } from "drizzle-orm";
import { CRM_FORMATS } from "./formats.js";

export const DEAD_SHARE_GATE = 0.1;

export interface CrmHealth {
  rows: number;
  people: number;
  /** Rows beyond the first for the same person. */
  duplicateRows: number;
  companies: number;
  emails: {
    missing: number;
    badSyntax: number;
    freemail: number;
    role: number;
    /** The same address on more than one row. */
    shared: number;
  };
  noTitle: number;
  lastContacted: {
    under6mo: number;
    from6to12mo: number;
    from1to2y: number;
    over2y: number;
    never: number;
  };
  owners: { owner: string; rows: number }[];
  verification: {
    valid: number;
    invalid: number;
    risky: number;
    catch_all: number;
    unchecked: number;
  };
  importErrors: number;
  gate: { ok: boolean; deadShare: number | null; reason: string };
}

interface Row extends Record<string, unknown> {
  email: string | null;
  owner: string | null;
  last_contacted_on: string | null;
  person_id: number;
  company_id: number;
  title: string | null;
}

/** The same day `months` earlier, clamped to that month's end (Aug 31 - 6mo = Feb 28/29). */
export function monthsBefore(today: Date, months: number): string {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() - months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(today.getUTCDate(), last))).toISOString().slice(0, 10);
}

export async function crmHealth(db: Queryable, today = new Date()): Promise<CrmHealth> {
  // Level 3: contacts, verdicts and errors come from one snapshot, so they add up.
  return snapshot(db, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      select c.email, c.owner, c.last_contacted_on::text, c.person_id, c.company_id, p.title
      from crm_contacts c join people p on p.id = c.person_id`);
    const persons = new Set<number>();
    const firms = new Set<number>();
    const emailRows = new Map<string, number>();
    const owners = new Map<string, number>();
    const emails = { missing: 0, badSyntax: 0, freemail: 0, role: 0, shared: 0 };
    const cut = {
      m6: monthsBefore(today, 6),
      m12: monthsBefore(today, 12),
      m24: monthsBefore(today, 24),
    };
    const lastContacted = { under6mo: 0, from6to12mo: 0, from1to2y: 0, over2y: 0, never: 0 };
    let noTitle = 0;
    for (const r of rows) {
      persons.add(r.person_id);
      firms.add(r.company_id);
      if (!r.title) noTitle += 1;
      const owner = r.owner ?? "(none)";
      owners.set(owner, (owners.get(owner) ?? 0) + 1);
      const on = r.last_contacted_on;
      if (!on) lastContacted.never += 1;
      else if (on >= cut.m6) lastContacted.under6mo += 1;
      else if (on >= cut.m12) lastContacted.from6to12mo += 1;
      else if (on >= cut.m24) lastContacted.from1to2y += 1;
      else lastContacted.over2y += 1;
      if (!r.email) {
        emails.missing += 1;
        continue;
      }
      emailRows.set(r.email, (emailRows.get(r.email) ?? 0) + 1);
      if (emailSyntaxError(r.email)) {
        emails.badSyntax += 1;
        continue;
      }
      if (isFreemail(emailDomain(r.email))) emails.freemail += 1;
      if (isRoleLocalpart(r.email)) emails.role += 1;
    }
    for (const n of emailRows.values()) if (n > 1) emails.shared += 1;

    // One verdict per address: the latest check of the CRM's own candidate.
    const verdicts = await tx.execute<{ result: string | null }>(sql`
      select distinct on (cc.email) v.result
      from contact_candidates cc
      left join verifications v on v.contact_candidate_id = cc.id
      where cc.evidence = 'crm'
      order by cc.email, v.checked_at desc nulls last, v.id desc nulls last`);
    const verification = { valid: 0, invalid: 0, risky: 0, catch_all: 0, unchecked: 0 };
    for (const { result } of verdicts) {
      if (result === null) verification.unchecked += 1;
      else if (result in verification) verification[result as keyof typeof verification] += 1;
    }

    // A re-import of a file (same bytes, or an edited export of the same path) repeats
    // its errors: count only the latest import of each file.
    const formats = [...CRM_FORMATS.keys()];
    const [errors] = await tx.execute<{ n: number }>(sql`
      select count(*)::int n from import_errors e
      where e.import_id in (
        select distinct on (i.source_ref) i.id from imports i
        where i.stats->>'replay_of' is null and i.source_type in (${sql.join(
          formats.map((f) => sql`${f}`),
          sql`, `,
        )})
        order by i.source_ref, i.id desc)`);

    const withEmail = rows.length - emails.missing;
    const checked =
      verification.valid + verification.invalid + verification.risky + verification.catch_all;
    const dead = verification.invalid + emails.badSyntax;
    const judged = checked + emails.badSyntax;
    const deadShare = judged > 0 ? dead / judged : null;
    // Shut until every address is judged: a share from a partial check is a guess.
    const gate =
      withEmail === 0
        ? { ok: false, deadShare, reason: "no emails in the export: nothing to send to" }
        : verification.unchecked > 0
          ? {
              ok: false,
              deadShare,
              reason: `not verified yet: ${verification.unchecked} unchecked, run \`wren crm run\``,
            }
          : (deadShare ?? 0) > DEAD_SHARE_GATE
            ? {
                ok: false,
                deadShare,
                reason: `clean first: ${pct(deadShare)} of checked addresses are dead (gate ${pct(DEAD_SHARE_GATE)})`,
              }
            : { ok: true, deadShare, reason: `ok: ${pct(deadShare)} dead` };

    return {
      rows: rows.length,
      people: persons.size,
      duplicateRows: rows.length - persons.size,
      companies: firms.size,
      emails,
      noTitle,
      lastContacted,
      owners: [...owners]
        .map(([owner, n]) => ({ owner, rows: n }))
        .sort((a, b) => b.rows - a.rows || a.owner.localeCompare(b.owner)),
      verification,
      importErrors: errors?.n ?? 0,
      gate,
    };
  });
}

const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);

/** The report as lines a person reads top to bottom. */
export function formatCrmHealth(h: CrmHealth): string[] {
  const v = h.verification;
  const lc = h.lastContacted;
  return [
    `rows ${h.rows}  people ${h.people}  duplicates ${h.duplicateRows}  companies ${h.companies}  import errors ${h.importErrors}`,
    `emails: missing ${h.emails.missing}  bad syntax ${h.emails.badSyntax}  freemail ${h.emails.freemail}  role ${h.emails.role}  on several rows ${h.emails.shared}`,
    `no title ${h.noTitle}`,
    `last contacted: <6mo ${lc.under6mo}  6-12mo ${lc.from6to12mo}  1-2y ${lc.from1to2y}  >2y ${lc.over2y}  never ${lc.never}`,
    `checked: valid ${v.valid}  invalid ${v.invalid}  risky ${v.risky}  catch-all ${v.catch_all}  unchecked ${v.unchecked}`,
    `owners: ${h.owners.map((o) => `${o.owner} ${o.rows}`).join(", ") || "-"}`,
    `gate: ${h.gate.reason}`,
  ];
}

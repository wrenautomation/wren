/**
 * Size a niche's companies from PPP loan files (`wren fetch get <niche>'s ppp
 * dataset`): jobs reported and a yearly payroll estimate, stored as a
 * `firmographics` enrichment (model `ppp-foia`, prompt_version = the release).
 *
 * A loan matches a company by business name (suffixes and punctuation dropped)
 * and ZIP; with no ZIP on the company, by name and state when every loan under
 * that name in the state is at one ZIP (one borrower). Anything looser is left
 * unmatched: a wrong size misleads more than a missing one.
 *
 * The loan was 2.5 months of payroll, so yearly payroll ≈ amount × 12 / 2.5. All
 * of a firm's loans (first and second draw) ride along whole.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { companies } from "@wren/core";
import type { Queryable } from "@wren/db";
import { parse } from "csv-parse/sync";
import { and, eq, notExists, sql } from "drizzle-orm";
import { enrichments } from "../schema.js";

export const PPP_MODEL = "ppp-foia";
const PAYROLL_MONTHS = 2.5;
const LOAN_FILE = /_(\d{6})\.csv$/;

const SUFFIX =
  /\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pc|p c|the|dba)\b/g;

/** "The Acme Staffing Co., LLC" -> "acme staffing". */
export function businessNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PppLoan = Record<string, string>;

/** The newest release's loan files in `dir`, as header-keyed records. */
export function readPppLoans(dir: string): { release: string; loans: PppLoan[] } {
  const files = readdirSync(dir).filter((f) => LOAN_FILE.test(f));
  const release = files
    .map((f) => LOAN_FILE.exec(f)?.[1] ?? "")
    .sort()
    .at(-1);
  if (!release) throw new Error(`${dir}: no PPP loan files (public_*_<yymmdd>.csv)`);
  const loans: PppLoan[] = [];
  for (const f of files.filter((f) => f.endsWith(`_${release}.csv`)).sort())
    loans.push(...(parse(readFileSync(join(dir, f)), { columns: true, bom: true }) as PppLoan[]));
  return { release, loans };
}

const zip5 = (z: string | null | undefined) => (z && /^\d{5}/.test(z) ? z.slice(0, 5) : null);
const money = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface CompanyPlace {
  id: number;
  names: string[];
  zip: string | null;
  state: string | null;
}

export type PppMatch = "name_zip" | "name_state";

/** Index loans once; `match` then answers per company. */
export function pppIndex(loans: readonly PppLoan[]) {
  const byZip = new Map<string, PppLoan[]>();
  const byState = new Map<string, PppLoan[]>();
  const push = (m: Map<string, PppLoan[]>, k: string, l: PppLoan) => {
    const list = m.get(k);
    if (list) list.push(l);
    else m.set(k, [l]);
  };
  for (const l of loans) {
    const key = businessNameKey(l.BorrowerName ?? "");
    if (!key) continue;
    const zip = zip5(l.BorrowerZip);
    if (zip) push(byZip, `${key}|${zip}`, l);
    if (l.BorrowerState) push(byState, `${key}|${l.BorrowerState.toUpperCase()}`, l);
  }
  return {
    match(c: CompanyPlace): { how: PppMatch; loans: PppLoan[] } | null {
      const keys = [...new Set(c.names.map(businessNameKey).filter(Boolean))];
      if (c.zip)
        for (const k of keys) {
          const hit = byZip.get(`${k}|${c.zip}`);
          if (hit) return { how: "name_zip", loans: hit };
        }
      if (c.state)
        for (const k of keys) {
          const hit = byState.get(`${k}|${c.state}`);
          const zips = hit?.map((l) => zip5(l.BorrowerZip)) ?? [];
          // One known ZIP only: a blank ZIP could be any branch.
          if (hit && zips.every(Boolean) && new Set(zips).size === 1)
            return { how: "name_state", loans: hit };
        }
      return null;
    },
  };
}

/** The enrichment output for one matched firm. */
export function pppFirmographics(how: PppMatch, release: string, loans: readonly PppLoan[]) {
  const amounts = loans.map(
    (l) => money(l.CurrentApprovalAmount) ?? money(l.InitialApprovalAmount) ?? 0,
  );
  const jobs = loans.map((l) => money(l.JobsReported) ?? 0);
  const top = Math.max(0, ...amounts);
  const franchise = loans.map((l) => l.FranchiseName?.trim()).find(Boolean) ?? null;
  return {
    source: "ppp_foia",
    release,
    match: how,
    jobs_reported: Math.max(0, ...jobs) || null,
    payroll_yearly_estimate: top ? Math.round((top * 12) / PAYROLL_MONTHS) : null,
    franchise,
    loans,
  };
}

const STATE = /,\s*([A-Z]{2})$/;

export interface PppSizeStats {
  release: string;
  loans: number;
  companies: number;
  matched_zip: number;
  matched_state: number;
  franchises: number;
}

/** Match every unsized company of `niche` against `dir`'s loans and store the sizes. */
export async function sizeFromPpp(
  db: Queryable,
  opts: { dir: string; niche: string },
): Promise<PppSizeStats> {
  const { release, loans } = readPppLoans(opts.dir);
  const index = pppIndex(loans);
  // Only the fields matching needs cross the wire, never the whole raw record.
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      legal: sql<string | null>`${companies.raw}->>'legal_name'`,
      postcode: sql<string | null>`${companies.raw}->>'postcode'`,
      geo: sql<string | null>`${companies.raw}->>'geo'`,
    })
    .from(companies)
    .where(
      and(
        eq(companies.niche, opts.niche),
        notExists(
          db
            .select({ one: sql`1` })
            .from(enrichments)
            .where(
              and(
                eq(enrichments.companyId, companies.id),
                eq(enrichments.kind, "firmographics"),
                eq(enrichments.model, PPP_MODEL),
                eq(enrichments.promptVersion, release),
              ),
            ),
        ),
      ),
    );
  const stats: PppSizeStats = {
    release,
    loans: loans.length,
    companies: rows.length,
    matched_zip: 0,
    matched_state: 0,
    franchises: 0,
  };
  const out: (typeof enrichments.$inferInsert)[] = [];
  for (const r of rows) {
    const names = [r.name, r.legal].filter((n): n is string => !!n);
    const hit = index.match({
      id: r.id,
      names,
      zip: zip5(r.postcode),
      state: STATE.exec(r.geo ?? "")?.[1] ?? null,
    });
    if (!hit) continue;
    stats[hit.how === "name_zip" ? "matched_zip" : "matched_state"] += 1;
    const output = pppFirmographics(hit.how, release, hit.loans);
    if (output.franchise) stats.franchises += 1;
    out.push({
      companyId: r.id,
      kind: "firmographics",
      model: PPP_MODEL,
      promptVersion: release,
      output,
    });
  }
  for (let i = 0; i < out.length; i += 500)
    await db
      .insert(enrichments)
      .values(out.slice(i, i + 500))
      .onConflictDoNothing();
  return stats;
}

/**
 * A demo client list built from an agency's own site, so a prospect sees the
 * product on companies they know. Real: the agency's customers (as its site
 * names them), their sites, and people who do hiring there or did before
 * (from search results). Made up, and seeded by the agency's domain: owners,
 * statuses and dates, plus a little of the mess real exports carry. The list
 * goes in as a Bullhorn export through the normal import, so everything after
 * is the product itself.
 */
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { type CustomersResult, findCustomers } from "@wren/research/companies";
import {
  findHomepage,
  politeHomepageFetcher,
  type Resolves,
  siteName,
} from "@wren/research/discovery";
import type { Fetcher } from "@wren/research/fetch";
import { findContacts } from "@wren/research/people";
import { sql } from "drizzle-orm";
import { CRM_FORMATS } from "../crm/formats.js";
import { type CrmImportStats, runCrmImport } from "../crm/import.js";
import { CrmCsvSource } from "../crm/source.js";
import { type Rng, seededRng, simulateHistory, usDate } from "./history.js";

export interface SeedDeps {
  fetcher: Fetcher;
  sites: SiteClient;
  llm: LlmClient;
  resolves?: Resolves;
}

export interface SeedOptions {
  /** The agency's site: a URL or a bare domain. */
  agency: string;
  /** Its name; read from the home page title when not given. */
  agencyName?: string | null;
  /** Customers to use at most. */
  companies?: number;
  /** People per customer at most. */
  perCompany?: number;
  today?: Date;
  runId?: string | null;
  onProgress?: (line: string) => void;
}

export interface SeedStats {
  agency: { name: string; domain: string };
  customersNamed: number;
  customersUsed: number;
  sitesFound: number;
  /** Customers where search turned up nobody who hires. */
  noContacts: number;
  people: number;
  /** Of those, whose results list another employer now. */
  moved: number;
  rows: number;
  dropped: CustomersResult["dropped"];
  imported: CrmImportStats;
}

export interface SeedRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  company: string;
  website: string;
  linkedin: string;
  owner: string;
  status: string;
  created: string;
  lastContacted: string;
  lastPlacement: string;
}

/** Bullhorn's ClientContact list headers, in its order. */
const HEADERS: [keyof SeedRow, string][] = [
  ["id", "ID"],
  ["firstName", "First Name"],
  ["lastName", "Last Name"],
  ["email", "Email"],
  ["title", "Title"],
  ["company", "Client Corporation"],
  ["website", "Website"],
  ["linkedin", "LinkedIn"],
  ["owner", "Recruiter"],
  ["status", "Status"],
  ["created", "Date Added"],
  ["lastContacted", "Date Last Note"],
  ["lastPlacement", "Date of Last Placement"],
];

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
export const toBullhornCsv = (rows: SeedRow[]): string =>
  [HEADERS.map(([, h]) => h), ...rows.map((r) => HEADERS.map(([k]) => r[k]))]
    .map((line) => line.map(cell).join(","))
    .join("\r\n");

const domainOf = (site: string): string =>
  new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname
    .toLowerCase()
    .replace(/^www\./, "");

/** "jane.o'neil@acme.com": ascii letters only, the guess every mail server gets. */
export const guessEmail = (first: string, last: string, domain: string): string | null => {
  const part = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\p{L}]/gu, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  const f = part(first);
  const l = part(last);
  return f && l ? `${f}.${l}@${domain}` : null;
};

/** "Acme" written the way one recruiter typed it years ago. */
const variant = (rng: Rng, name: string): string =>
  rng() < 0.5 ? `${name} Inc.` : name.toUpperCase();

/**
 * The mess real exports carry, on real people: a few blank titles, a company
 * spelled two ways, a missing site, a contact entered twice. Never a fake
 * bounce or a fake move: those would be claims about a real person.
 */
export function messUp(rng: Rng, rows: SeedRow[]): SeedRow[] {
  const out: SeedRow[] = [];
  let next = rows.length + 1;
  for (const r of rows) {
    const row = { ...r };
    if (rng() < 0.15) row.title = "";
    if (rng() < 0.08) row.company = variant(rng, row.company);
    if (rng() < 0.1) row.website = "";
    out.push(row);
    if (rng() < 0.05)
      out.push({
        ...row,
        id: String(next++),
        email: row.email.toUpperCase(),
        title: "",
        linkedin: "",
      });
  }
  return out;
}

/** Everything a client list holds, dropped. Only for a demo client's own database. */
export async function resetCrmData(db: Queryable): Promise<void> {
  await db.execute(
    sql.raw(
      `truncate table briefs, contact_scores, company_checks, findings, person_lookups, documents,
        verifications, contact_candidates, crm_contacts, sightings, import_errors, people, companies, imports
        restart identity cascade`,
    ),
  );
}

async function homeName(fetcher: Fetcher, domain: string): Promise<string | null> {
  try {
    const r = await fetcher.get(`https://${domain}`);
    return r.status === 200 ? siteName(r.text, domain) : null;
  } catch {
    return null;
  }
}

/** Build the list, reset the database, import it. The caller checks the client is a demo. */
export async function seedDemo(
  db: Queryable,
  deps: SeedDeps,
  opts: SeedOptions,
): Promise<{ stats: SeedStats; csv: string }> {
  const say = opts.onProgress ?? (() => {});
  const today = opts.today ?? new Date();
  const domain = domainOf(opts.agency);
  const rng = seededRng(domain);
  const fetchHomepage = politeHomepageFetcher(deps.fetcher);
  const name = opts.agencyName?.trim() || (await homeName(deps.fetcher, domain)) || domain;
  say(`agency: ${name} (${domain})`);

  const named = await findCustomers(
    deps.fetcher,
    deps.llm,
    { name, site: opts.agency },
    {
      runId: opts.runId ?? null,
    },
  );
  for (const t of named.tried) say(`  read ${t.url}: ${t.outcome}`);
  say(`customers named: ${named.customers.length}, dropped ${named.dropped.length}`);
  const used = named.customers.slice(0, opts.companies ?? 40);

  const rows: SeedRow[] = [];
  let sitesFound = 0;
  let noContacts = 0;
  let moved = 0;
  for (const c of used) {
    const home = await findHomepage(c.name, c.website, {
      fetchHomepage,
      ...(deps.resolves ? { resolves: deps.resolves } : {}),
    });
    if (home) sitesFound++;
    const people = await findContacts(
      deps.sites,
      { name: c.name, domain: home?.domain ?? null },
      {
        max: opts.perCompany ?? 2,
      },
    );
    say(`  ${c.name}: ${home?.domain ?? "no site"}, ${people.length} people`);
    if (!people.length) noContacts++;
    for (const p of people) {
      if (!p.current) moved++;
      const h = simulateHistory(rng, today);
      rows.push({
        id: String(rows.length + 1),
        firstName: p.firstName,
        lastName: p.lastName,
        // The address they had at the customer; the verify stage says whether it still works.
        email: home ? (guessEmail(p.firstName, p.lastName, home.domain) ?? "") : "",
        title: p.title,
        company: c.name,
        website: home ? `https://${home.domain}` : "",
        // Recruiters save a profile for about a third of their contacts.
        linkedin: rng() < 0.3 ? p.linkedin : "",
        owner: h.owner,
        status: h.status,
        created: usDate(h.created),
        lastContacted: usDate(h.lastContacted),
        lastPlacement: usDate(h.lastPlacement),
      });
    }
  }

  const messy = messUp(rng, rows);
  const csv = toBullhornCsv(messy);
  const format = CRM_FORMATS.get("bullhorn");
  if (!format) throw new Error("the bullhorn format is missing");
  await resetCrmData(db);
  const { stats: imported } = await runCrmImport(
    db,
    new CrmCsvSource(format, "demo-seed.csv", new TextEncoder().encode(csv)),
  );
  return {
    csv,
    stats: {
      agency: { name, domain },
      customersNamed: named.customers.length,
      customersUsed: used.length,
      sitesFound,
      noContacts,
      people: rows.length,
      moved,
      rows: messy.length,
      dropped: named.dropped,
      imported,
    },
  };
}

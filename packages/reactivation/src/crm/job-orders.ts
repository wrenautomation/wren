/**
 * Job orders from an ATS export (designs/2026-10-07-health.md, Keep). Headers mapped like the
 * CRM formats: a dialect's names first, then the generic ones. Each row's company is found by
 * the website's domain, else a work email's, else the company's name among those we hold; a
 * row we can't place keeps the name and no company. Re-importing replaces each order by its id.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeCsvBytes,
  emailDomain,
  isFreemail,
  isPlatformDomain,
  parseCsvRecords,
  type RawRow,
  rowsFromRecords,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { jobOrders } from "../schema.js";
import { dayOrder, parseCrmDate } from "./dates.js";
import { normalizeHeader } from "./formats.js";
import { emailsIn } from "./source.js";

export const ORDER_FIELDS = [
  "id",
  "title",
  "company",
  "website",
  "email",
  "status",
  "isOpen",
  "openings",
  "owner",
  "opened",
  "closed",
] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

export interface OrderFormat {
  name: string;
  help: string;
  headers: Partial<Record<OrderField, readonly string[]>>;
}

const GENERIC: Record<OrderField, readonly string[]> = {
  id: ["id", "job id", "job order id", "order id", "reference", "job reference", "req id"],
  title: ["title", "job title", "position", "role", "job"],
  company: ["company", "company name", "client", "client name", "account", "account name"],
  website: ["website", "company website", "domain", "company domain", "url"],
  email: ["email", "contact email", "client contact email", "hiring manager email"],
  status: ["status", "job status", "stage", "state"],
  isOpen: ["open", "is open", "open closed", "isopen"],
  openings: ["openings", "number of openings", "positions", "number of positions", "headcount"],
  owner: ["owner", "recruiter", "consultant", "account manager", "assigned to"],
  opened: ["date added", "created", "created date", "opened", "open date", "start date"],
  closed: ["date closed", "closed", "closed date", "close date", "date filled", "filled date"],
};

export const ORDER_FORMATS: ReadonlyMap<string, OrderFormat> = new Map(
  [
    {
      name: "ats-generic",
      help: "any job order export with a header row: names matched by a synonym table",
      headers: {},
    },
    {
      name: "bullhorn",
      help: "Bullhorn job orders list export (JobOrder)",
      headers: {
        id: ["id", "job id", "joborder id"],
        company: ["company", "client corporation", "clientcorporation"],
        isOpen: ["open closed", "is open", "isopen"],
        openings: ["openings", "num openings", "# of openings"],
        email: ["contact email", "client contact email"],
        opened: ["date added", "dateadded"],
        closed: ["date closed", "dateclosed", "date end", "dateend"],
      },
    },
    {
      name: "jobadder",
      help: "JobAdder jobs export",
      headers: {
        id: ["job id", "reference", "job reference"],
        company: ["company", "company name"],
        openings: ["number of positions", "positions"],
        owner: ["owner", "consultant"],
        opened: ["created", "date created"],
        closed: ["closed", "date closed"],
      },
    },
  ].map((f) => [f.name, f]),
);

/** A status that means the order is done or paused, not giving work now. */
const SHUT =
  /\b(closed?|filled|placed|lost|cancel+ed|cancel+ation|archived?|on hold|hold|dead|inactive|withdrawn|completed?)\b/i;
const NO = /^(false|no|n|0|closed)$/i;

export interface JobOrder {
  orderKey: string;
  title: string | null;
  companyName: string | null;
  domain: string | null;
  status: string | null;
  open: boolean;
  openings: number | null;
  owner: string | null;
  openedOn: string | null;
  closedOn: string | null;
  raw: RawRow;
}

/** Header -> field for one file; a header serves one field. Fails, listing headers, without a company. */
export function mapOrderHeaders(
  format: OrderFormat,
  headers: readonly string[],
): Partial<Record<OrderField, string>> {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h.replace(/#/g, "number"));
    if (!byNorm.has(n)) byNorm.set(n, h);
    if (!byNorm.has(n.replace(/ /g, ""))) byNorm.set(n.replace(/ /g, ""), h);
  }
  const used = new Set<string>();
  const map: Partial<Record<OrderField, string>> = {};
  for (const field of ORDER_FIELDS)
    for (const name of [...(format.headers[field] ?? []), ...GENERIC[field]]) {
      const n = normalizeHeader(name.replace(/#/g, "number"));
      const h = byNorm.get(n) ?? byNorm.get(n.replace(/ /g, ""));
      if (h !== undefined && !used.has(h)) {
        map[field] = h;
        used.add(h);
        break;
      }
    }
  if (!map.company && !map.website && !map.email)
    throw new Error(
      `${format.name}: no company, website or email column. Headers: ${headers.join(", ")}`,
    );
  return map;
}

const text = (v: unknown): string | null => {
  const t = v == null ? "" : String(v).trim();
  return t || null;
};

const host = (v: string | null): string | null => {
  if (!v) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
};

/** Every row of an export, read. Rows with no company, website or email are skipped and counted. */
export function readJobOrders(
  format: OrderFormat,
  path: string,
  bytes: Uint8Array = readFileSync(path),
): { headers: Partial<Record<OrderField, string>>; orders: JobOrder[]; skipped: number } {
  const records = parseCsvRecords(decodeCsvBytes(bytes, path).text);
  const headers = mapOrderHeaders(format, records[0] ?? []);
  const raws = [...rowsFromRecords(records)];
  const cell = (r: RawRow, f: OrderField) => {
    const h = headers[f];
    return h === undefined ? null : text(r[h]);
  };
  const order = dayOrder(raws.flatMap((r) => [cell(r, "opened"), cell(r, "closed")]));
  const seen = new Map<string, number>();
  const orders: JobOrder[] = [];
  let skipped = 0;
  for (const raw of raws) {
    const companyName = cell(raw, "company");
    const workDomain =
      emailsIn(cell(raw, "email"))
        .map(emailDomain)
        .find((d) => !isFreemail(d) && !isPlatformDomain(d)) ?? null;
    const site = host(cell(raw, "website"));
    const domain = (site && !isPlatformDomain(site) ? site : null) ?? workDomain;
    if (!companyName && !domain) {
      skipped += 1;
      continue;
    }
    const status = cell(raw, "status");
    const isOpen = cell(raw, "isOpen");
    const closedOn = parseCrmDate(cell(raw, "closed"), order);
    const open = isOpen !== null ? !NO.test(isOpen) : !closedOn && !(status && SHUT.test(status));
    const id = cell(raw, "id");
    let orderKey: string;
    if (id && id.length <= 128) orderKey = id;
    else {
      // No id: which firm and which role, so an edited re-export updates its rows.
      const who = [companyName, domain, cell(raw, "title"), cell(raw, "opened")]
        .map((v) => v?.toLowerCase() ?? "")
        .join("|");
      const hash = createHash("sha256").update(who).digest("hex").slice(0, 40);
      const n = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, n);
      orderKey = `h:${hash}#${n}`;
    }
    const openings = Number.parseInt(cell(raw, "openings") ?? "", 10);
    orders.push({
      orderKey,
      title: cell(raw, "title"),
      companyName,
      domain,
      status,
      open,
      openings: Number.isSafeInteger(openings) && openings >= 0 ? openings : null,
      owner: cell(raw, "owner"),
      openedOn: parseCrmDate(cell(raw, "opened"), order),
      closedOn,
      raw,
    });
  }
  return { headers, orders, skipped };
}

export interface JobOrderStats {
  orders: number;
  open: number;
  /** Placed with an account we hold. */
  matched: number;
  /** Kept with the company's name only. */
  unmatched: number;
  skipped: number;
}

/** Writes the orders; each replaces the earlier row with its format and id. */
export async function importJobOrders(
  db: Queryable,
  format: OrderFormat,
  read: { orders: JobOrder[]; skipped: number },
): Promise<JobOrderStats> {
  const { orders, skipped } = read;
  const domains = [...new Set(orders.flatMap((o) => (o.domain ? [o.domain] : [])))];
  const names = [
    ...new Set(orders.flatMap((o) => (o.companyName ? [o.companyName.toLowerCase()] : []))),
  ];
  const byDomain = new Map<string, number>();
  const byName = new Map<string, number>();
  if (domains.length)
    for (const r of await db.execute<{ domain: string; id: number }>(sql`
        select domain, id from companies where domain in (select jsonb_array_elements_text(${JSON.stringify(domains)}::jsonb))`))
      byDomain.set(r.domain, r.id);
  // A name held by more than one company: the one the client placed with, then the oldest.
  if (names.length)
    for (const r of await db.execute<{ name: string; id: number }>(sql`
        select distinct on (lower(c.name)) lower(c.name) name, c.id from companies c
        where lower(c.name) in (select jsonb_array_elements_text(${JSON.stringify(names)}::jsonb))
        order by lower(c.name),
          exists (select 1 from crm_contacts k where k.company_id = c.id) desc, c.id`))
      byName.set(r.name, r.id);

  const stats: JobOrderStats = { orders: 0, open: 0, matched: 0, unmatched: 0, skipped };
  for (const o of orders) {
    const companyId =
      (o.domain ? byDomain.get(o.domain) : undefined) ??
      (o.companyName ? byName.get(o.companyName.toLowerCase()) : undefined) ??
      null;
    const row = {
      format: format.name,
      orderKey: o.orderKey,
      companyId,
      companyName: o.companyName,
      title: o.title,
      status: o.status,
      open: o.open,
      openings: o.openings,
      owner: o.owner,
      openedOn: o.openedOn,
      closedOn: o.closedOn,
      raw: o.raw,
    };
    const { format: _, orderKey: __, ...set } = row;
    await db
      .insert(jobOrders)
      .values(row)
      .onConflictDoUpdate({
        target: [jobOrders.format, jobOrders.orderKey],
        set: { ...set, updatedAt: sql`now()` },
      });
    stats.orders += 1;
    if (o.open) stats.open += 1;
    if (companyId === null) stats.unmatched += 1;
    else stats.matched += 1;
  }
  return stats;
}

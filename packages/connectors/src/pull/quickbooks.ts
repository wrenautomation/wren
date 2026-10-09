/**
 * QuickBooks Online: customers, then invoices, each changed since its cursor, through the query
 * API. An invoice whose balance is 0 is paid. The company (`realm`) came with the sign-in.
 */
import type { LinkExtra } from "../schema.js";
import {
  jsonOf,
  later,
  PAGE,
  PullError,
  type PulledChange,
  type PulledPerson,
  type Puller,
  str,
  type WhoAmI,
} from "./types.js";

export const QUICKBOOKS_API = "https://quickbooks.api.intuit.com";
const MINOR = "75";

const realmOf = (extra: LinkExtra) => {
  if (!extra.realm) throw new PullError("QuickBooks named no company. Connect it again.", true);
  return extra.realm;
};

type Row = Record<string, unknown>;
const at = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Row)[k] : null);

async function query(
  i: Parameters<Puller>[0],
  entity: "Customer" | "Invoice",
  since: string | undefined,
  start: number,
): Promise<Row[]> {
  const where = since ? ` where MetaData.LastUpdatedTime > '${since.replace(/'/g, "")}'` : "";
  const q = `select * from ${entity}${where} order by MetaData.LastUpdatedTime startposition ${start} maxresults ${PAGE}`;
  const url = `${QUICKBOOKS_API}/v3/company/${encodeURIComponent(realmOf(i.extra))}/query?minorversion=${MINOR}&query=${encodeURIComponent(q)}`;
  const j = await jsonOf(
    await i.fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${i.token}`, accept: "application/json" },
    }),
    "QuickBooks",
  );
  const rows = at(j.QueryResponse, entity);
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

const person = (c: Row): PulledPerson | null => {
  const id = str(c.Id);
  if (!id) return null;
  const first = str(c.GivenName);
  const last = str(c.FamilyName);
  const display = str(c.DisplayName);
  return {
    id,
    firstName: first,
    lastName: last,
    fullName: first || last ? null : display,
    email: str(at(c.PrimaryEmailAddr, "Address")),
    phone: str(at(c.PrimaryPhone, "FreeFormNumber")) ?? str(at(c.Mobile, "FreeFormNumber")),
    company: str(c.CompanyName) ?? display,
    website: str(at(c.WebAddr, "URI")),
    title: str(c.Title),
    status: c.Active === false ? "inactive" : null,
    created: str(at(c.MetaData, "CreateTime")),
    lastContacted: null,
  };
};

export const pullQuickbooks: Puller = async (i) => {
  const cursor = { ...i.cursor };
  const people: PulledPerson[] = [];
  const changes: PulledChange[] = [];
  let read = 0;
  let more = false;
  for (const entity of ["Customer", "Invoice"] as const) {
    const key = entity === "Customer" ? "customers" : "invoices";
    let top = cursor[key];
    for (let start = 1; ; start += PAGE) {
      const rows = await query(i, entity, cursor[key], start);
      for (const r of rows) {
        top = later(top, str(at(r.MetaData, "LastUpdatedTime")));
        if (entity === "Customer") {
          const p = person(r);
          if (!p) continue;
          people.push(p);
          if (p.created)
            changes.push({
              key: `customer:${p.id}`,
              change: "contact_added",
              at: p.created,
              person: p.id,
              data: {},
            });
          continue;
        }
        const id = str(r.Id);
        const balance = Number(r.Balance);
        const updated = str(at(r.MetaData, "LastUpdatedTime"));
        if (!id || !updated || balance !== 0 || !(Number(r.TotalAmt) > 0)) continue;
        changes.push({
          key: `invoice:${id}`,
          change: "invoice_paid",
          at: updated,
          person: str(at(r.CustomerRef, "value")),
          data: {
            invoice: str(r.DocNumber) ?? id,
            amount: Number(r.TotalAmt),
            currency: str(at(r.CurrencyRef, "value")),
            customer: str(at(r.CustomerRef, "name")),
            billEmail: str(at(r.BillEmail, "Address")),
          },
        });
      }
      read += rows.length;
      if (rows.length < PAGE) break;
      if (read >= i.cap) {
        more = true;
        break;
      }
    }
    if (top) cursor[key] = top;
    if (more) break;
  }
  return { people, changes, cursor, more };
};

export const whoQuickbooks: WhoAmI = async (fetch, token, extra) => {
  const realm = realmOf(extra);
  const j = await jsonOf(
    await fetch(
      `${QUICKBOOKS_API}/v3/company/${encodeURIComponent(realm)}/companyinfo/${encodeURIComponent(realm)}?minorversion=${MINOR}`,
      { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
    ),
    "QuickBooks",
  );
  return { id: realm, name: str(at(j.CompanyInfo, "CompanyName")) };
};

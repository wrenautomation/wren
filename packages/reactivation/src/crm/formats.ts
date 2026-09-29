/**
 * CRM exports: which header means which field, per CRM. Headers are compared
 * normalized ("Account.Name", "account_name" and "Account Name" meet). A dialect's
 * own names are tried first, then the generic synonyms, so `crm-generic` reads any
 * sane export and a named dialect only adds the CRM's quirks and its preference
 * order (HubSpot's "Last Contacted" beats "Last Activity Date").
 */

export const CRM_FIELDS = [
  "id",
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "title",
  "company",
  "website",
  "linkedin",
  "owner",
  "lastContacted",
  "lastPlacement",
  "status",
  "created",
] as const;
export type CrmField = (typeof CRM_FIELDS)[number];

/** The date fields: parsed to ISO days, the column's day order decided once per file. */
export const CRM_DATE_FIELDS = ["lastContacted", "lastPlacement", "created"] as const;
export type CrmDateField = (typeof CRM_DATE_FIELDS)[number];

export interface CrmFormat {
  name: string;
  help: string;
  headers: Partial<Record<CrmField, readonly string[]>>;
}

const GENERIC: Record<CrmField, readonly string[]> = {
  id: ["id", "record id", "contact id", "crm id"],
  fullName: ["full name", "name", "contact name", "contact"],
  firstName: ["first name", "firstname", "given name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  email: ["email", "email address", "e mail", "work email", "primary email"],
  phone: ["phone", "phone number", "work phone", "direct phone", "mobile", "mobile phone"],
  title: ["title", "job title", "position", "role"],
  company: [
    "company",
    "company name",
    "account name",
    "account",
    "organization",
    "organisation",
    "employer",
    "client",
  ],
  website: ["website", "company website", "website url", "domain", "company domain", "url"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
  owner: ["owner", "contact owner", "account owner", "recruiter", "consultant", "assigned to"],
  lastContacted: [
    "last contacted",
    "last contact",
    "last contacted date",
    "last activity",
    "last activity date",
  ],
  lastPlacement: ["last placement", "last placement date", "last hire"],
  status: ["status", "stage", "lifecycle stage", "lead status"],
  created: ["created", "created date", "create date", "date added", "added"],
};

export const CRM_FORMATS: ReadonlyMap<string, CrmFormat> = new Map(
  [
    {
      name: "crm-generic",
      help: "any contact export with a header row: names matched by a synonym table",
      headers: {},
    },
    {
      name: "hubspot",
      help: "HubSpot contacts export (Contacts > Export, all properties)",
      headers: {
        id: ["record id"],
        company: ["company name", "associated company"],
        website: ["website url"],
        owner: ["contact owner", "hubspot owner"],
        lastContacted: ["last contacted", "last activity date", "last engagement date"],
        status: ["lifecycle stage", "lead status"],
        created: ["create date"],
      },
    },
    {
      name: "salesforce",
      help: "Salesforce contacts report or Data Loader export (API names work too)",
      headers: {
        id: ["contact id", "id"],
        fullName: ["contact name", "full name", "name"],
        firstName: ["first name", "firstname"],
        lastName: ["last name", "lastname"],
        company: ["account name", "account account name"],
        website: ["account website", "website"],
        // Not "Owner ID": an opaque user id names no one.
        owner: ["contact owner", "owner name", "owner full name", "owner"],
        lastContacted: ["last activity", "lastactivitydate", "last activity date"],
        created: ["created date", "createddate"],
      },
    },
    {
      name: "bullhorn",
      help: "Bullhorn contacts list export (ClientContact)",
      headers: {
        id: ["id", "contact id", "clientcontact id"],
        title: ["title", "occupation", "job title"],
        company: ["company", "client corporation", "clientcorporation"],
        owner: ["owner", "contact owner", "recruiter"],
        lastContacted: [
          "last note",
          "date last comment",
          "date last note",
          "last contacted",
          "date last visit",
        ],
        lastPlacement: ["last placement", "date of last placement", "last placement date"],
        created: ["date added", "dateadded"],
      },
    },
  ].map((f) => [f.name, f]),
);

/** "Account.Name" / "account_name" / " Account Name " -> "account name". */
export const normalizeHeader = (h: string): string =>
  h
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type HeaderMap = Partial<Record<CrmField, string>>;

/**
 * Header -> field for one file. A header serves one field at most; the first field
 * to claim it wins, in CRM_FIELDS order. Fails loudly, listing the headers, when a
 * row could never make a person: no name, or neither an email nor a company.
 */
export function mapHeaders(format: CrmFormat, headers: readonly string[]): HeaderMap {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    // A camelCase API name ("FirstName") and a spaced one both land on one key; keep the first.
    if (!byNorm.has(n)) byNorm.set(n, h);
    const squashed = n.replace(/ /g, "");
    if (!byNorm.has(squashed)) byNorm.set(squashed, h);
  }
  const used = new Set<string>();
  const map: HeaderMap = {};
  for (const field of CRM_FIELDS) {
    for (const name of [...(format.headers[field] ?? []), ...GENERIC[field]]) {
      const h = byNorm.get(name) ?? byNorm.get(name.replace(/ /g, ""));
      if (h !== undefined && !used.has(h)) {
        map[field] = h;
        used.add(h);
        break;
      }
    }
  }
  const missing: string[] = [];
  if (!map.fullName && !map.firstName) missing.push("a name (Name, or First Name)");
  if (!map.email && !map.company && !map.website)
    missing.push("an email, company or website column");
  if (missing.length)
    throw new Error(
      `${format.name}: no ${missing.join(" and no ")}. Headers: ${headers.join(", ")}`,
    );
  return map;
}

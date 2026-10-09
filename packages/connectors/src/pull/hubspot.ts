/**
 * HubSpot: contacts changed since the cursor, oldest change first, through the CRM search API.
 * Owners are ids naming no one here, so left out.
 */
import { jsonOf, later, PAGE, type Puller, str, type WhoAmI } from "./types.js";

const API = "https://api.hubapi.com";
const PROPS = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "company",
  "website",
  "jobtitle",
  "lifecyclestage",
  "createdate",
  "notes_last_contacted",
  "lastmodifieddate",
];

export const pullHubspot: Puller = async ({ fetch, token, cursor, cap }) => {
  const since = cursor.contacts;
  let top = since;
  let after: string | undefined;
  const people = [];
  const changes = [];
  let more = false;
  for (;;) {
    const res = await fetch(`${API}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        filterGroups: since
          ? [
              {
                filters: [
                  {
                    propertyName: "lastmodifieddate",
                    operator: "GT",
                    value: String(Date.parse(since)),
                  },
                ],
              },
            ]
          : [],
        sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
        properties: PROPS,
        limit: PAGE,
        ...(after ? { after } : {}),
      }),
    });
    const j = await jsonOf(res, "HubSpot");
    const rows = Array.isArray(j.results) ? (j.results as Record<string, unknown>[]) : [];
    for (const r of rows) {
      const p = (r.properties ?? {}) as Record<string, unknown>;
      const id = str(r.id);
      if (!id) continue;
      const first = str(p.firstname);
      const last = str(p.lastname);
      const created = str(p.createdate) ?? str(r.createdAt);
      people.push({
        id,
        firstName: first,
        lastName: last,
        fullName: null,
        email: str(p.email),
        phone: str(p.phone) ?? str(p.mobilephone),
        company: str(p.company) ?? ([first, last].filter(Boolean).join(" ") || null),
        website: str(p.website),
        title: str(p.jobtitle),
        status: str(p.lifecyclestage),
        created,
        lastContacted: str(p.notes_last_contacted),
      });
      if (created)
        changes.push({
          key: `contact:${id}`,
          change: "contact_added" as const,
          at: created,
          person: id,
          data: {},
        });
      top = later(top, str(p.lastmodifieddate) ?? str(r.updatedAt));
    }
    const next = str((j.paging as { next?: { after?: unknown } } | undefined)?.next?.after);
    if (!next || !rows.length) break;
    if (people.length >= cap) {
      more = true;
      break;
    }
    after = next;
  }
  return { people, changes, cursor: top ? { ...cursor, contacts: top } : cursor, more };
};

export const whoHubspot: WhoAmI = async (fetch, token) => {
  const j = await jsonOf(
    await fetch(`${API}/oauth/v1/access-tokens/${encodeURIComponent(token)}`, { method: "GET" }),
    "HubSpot",
  );
  const id = str(j.hub_id);
  if (!id) throw new Error("HubSpot named no account");
  return { id, name: str(j.hub_domain) };
};

/**
 * A lead at the door (designs/2026-10-07-speed-to-lead.md): whatever a form or CRM posts to a
 * hook, read as the facts every lead step needs. A hook's field map names where each sits
 * in the payload ("contact.phone"); a fact the map leaves out is looked for under its common names.
 * Consent is only ever a yes the form sent: a checked box, "yes", true. Anything else is no.
 */

export const LEAD_FIELDS = [
  "name",
  "phone",
  "email",
  "consent",
  "source",
  "zone",
  "niche",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

/** Where each fact sits in a hook's payload, dotted. */
export type FieldMap = Partial<Record<LeadField, string>>;

export interface DoorLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** The form said yes to texts. */
  consent: boolean;
  /** What the form called the field and what it held, for the consent record. */
  consentDetail: string | null;
  source: string | null;
  /** The lead's IANA time zone, when the form sent one. */
  zone: string | null;
  /** The market the form was for ("agencies"), when it said. */
  niche: string | null;
}

/** The names each fact goes by when the map doesn't say, most specific first. */
const COMMON: Record<Exclude<LeadField, "name">, readonly string[]> = {
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "cell", "tel"],
  email: ["email", "email_address", "emailAddress"],
  consent: ["sms_consent", "smsConsent", "text_consent", "consent", "opt_in", "optIn"],
  source: ["source", "utm_source", "form", "form_name"],
  zone: ["zone", "timezone", "time_zone", "tz"],
  niche: ["niche", "industry", "vertical"],
};
const NAMES = ["name", "full_name", "fullName"] as const;

const YES = new Set(["1", "true", "yes", "y", "on", "checked", "agree", "agreed"]);

function dig(v: unknown, path: string): unknown {
  for (const k of path.split("."))
    v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

function words(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, 200) : null;
}

function first(payload: unknown, map: FieldMap, field: Exclude<LeadField, "name">) {
  const path = map[field];
  if (path) return { at: path, v: dig(payload, path) };
  for (const at of COMMON[field]) {
    const v = dig(payload, at);
    if (v !== undefined && v !== null && v !== "") return { at, v };
  }
  return { at: null, v: undefined };
}

const isYes = (v: unknown) =>
  v === true || v === 1 || (typeof v === "string" && YES.has(v.trim().toLowerCase()));

/** A payload as a lead: each fact by the map, else by its common names. Never throws. */
export function leadOf(payload: unknown, map: FieldMap = {}): DoorLead {
  const named = map.name
    ? words(dig(payload, map.name))
    : (NAMES.map((k) => words(dig(payload, k))).find(Boolean) ??
      ([words(dig(payload, "first_name")), words(dig(payload, "last_name"))]
        .filter(Boolean)
        .join(" ") ||
        null));
  const email = words(first(payload, map, "email").v)?.toLowerCase() ?? null;
  const consent = first(payload, map, "consent");
  const zone = words(first(payload, map, "zone").v);
  return {
    name: named,
    phone: words(first(payload, map, "phone").v),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    consent: isYes(consent.v),
    consentDetail:
      consent.at && consent.v !== undefined
        ? `${consent.at}=${JSON.stringify(consent.v).slice(0, 60)}`
        : null,
    source: words(first(payload, map, "source").v),
    zone,
    niche: words(first(payload, map, "niche").v)?.toLowerCase() ?? null,
  };
}

/** `name=full_name` pairs (the CLI's `--field`) as a map; throws on a fact it doesn't know. */
export function fieldMapOf(pairs: readonly string[]): FieldMap {
  const map: FieldMap = {};
  for (const pair of pairs) {
    const [k, ...rest] = pair.split("=");
    const path = rest.join("=").trim();
    if (!(LEAD_FIELDS as readonly string[]).includes(k?.trim() ?? "") || !path)
      throw new Error(`--field reads like phone=contact.phone (facts: ${LEAD_FIELDS.join(", ")})`);
    map[k?.trim() as LeadField] = path;
  }
  return map;
}

/**
 * A known sender's hook: the payload field that names one lead (`subject`), its field map, and
 * where the hook's URL goes once made. `site` is our own lander (wrenautomation.com): each stored
 * lead or application posts `{id: "site:<table>:<row id>", source: "site", ...}`, so a retry of
 * the same row is the same subject and enters once.
 */
export interface HookPreset {
  workflow: string;
  input: string;
  subject: string;
  fields: FieldMap;
  /** Where the printed URL goes. */
  goes: string;
}

export const HOOK_PRESETS: Readonly<Record<string, HookPreset>> = {
  site: {
    workflow: "speed_to_lead.steps",
    input: "forms",
    subject: "id",
    fields: {
      name: "name",
      phone: "phone",
      email: "email",
      consent: "sms_consent",
      source: "source",
      niche: "niche",
    },
    goes: "the lander's Pages secret WREN_DOOR_URL: `cd lander && npx wrangler pages secret put WREN_DOOR_URL --project-name wren-lander`, paste it, then push or `npm run deploy`",
  },
};

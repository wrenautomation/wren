/**
 * What each address source says about who (designs/2026-10-14-customerio-audit.md, B1), one
 * builder per source so its live writer and the backfill agree, and the backfill itself: every
 * existing row through `resolveProfile`, oldest id first, batch by batch. Running it twice
 * changes nothing the first run made.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  type ElsewhereLine,
  keysOfFields,
  nameOfFields,
  noteElsewhere,
  noteProfile,
  type ProfileKey,
  type ResolveOptions,
  resolveProfile,
  TRAIT_KEY,
} from "./profiles.js";
import { normalizeHandle } from "./touches.js";

/** One source row as `resolveProfile` takes it. */
export interface ProfileInput extends ResolveOptions {
  keys: ProfileKey[];
}

const HANDLE_PLATFORMS = ["linkedin", "x", "instagram", "reddit", "youtube"] as const;

/** A social profile URL as its handle key; null for a URL no platform claims. */
export function handleOfUrl(url: string | null | undefined): ProfileKey | null {
  const u = url?.trim();
  if (!u || !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\//i.test(u)) return null;
  for (const p of HANDLE_PLATFORMS) {
    const ref = normalizeHandle(p, u);
    if (ref) return { kind: `handle:${ref.platform}`, value: ref.handle };
  }
  return null;
}

const person = (id: number | null | undefined): ProfileKey => ({ kind: "person", value: id });
const words = (...s: (string | null | undefined)[]) =>
  s
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(" ") || null;

/** The writers' sources: what `profile_keys.source` and trait sources say. */
export const PROFILE_SOURCES = [
  "lead_import",
  "people_import",
  "enrollment",
  "sms_contact",
  "consent",
  "social_handle",
  "crm",
  "site_form",
  "site_chat",
  "booking",
  "call_booking",
  "payment",
] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

/** Each source's row as keys, a name and traits. */
export const profileFrom = {
  lead: (l: {
    email: string;
    personId?: number | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    title?: string | null | undefined;
    company?: string | null | undefined;
    country?: string | null | undefined;
    socialUrl?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [{ kind: "email", value: l.email }, person(l.personId), handleOfUrl(l.socialUrl)].filter(
      (k): k is ProfileKey => k !== null,
    ),
    name: words(l.firstName, l.lastName),
    traits: { title: l.title, company: l.company, country: l.country },
    at: l.at,
  }),
  person: (p: {
    id: number;
    fullName?: string | null | undefined;
    title?: string | null | undefined;
    company?: string | null | undefined;
    linkedinUrl?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [person(p.id), handleOfUrl(p.linkedinUrl)].filter((k): k is ProfileKey => k !== null),
    name: p.fullName,
    traits: { title: p.title, company: p.company },
    at: p.at,
  }),
  contact: (c: {
    e164: string;
    email?: string | null | undefined;
    personId?: number | null | undefined;
    name?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [{ kind: "phone", value: c.e164 }, { kind: "email", value: c.email }, person(c.personId)],
    name: c.name,
    at: c.at,
  }),
  consent: (c: { channel: string; address: string; at?: Date | undefined }): ProfileInput => ({
    keys: [{ kind: c.channel === "sms" ? "phone" : "email", value: c.address }],
    at: c.at,
  }),
  handle: (h: {
    platform: string;
    handle: string;
    personId?: number | null | undefined;
    name?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [{ kind: `handle:${h.platform}`, value: h.handle }, person(h.personId)],
    name: h.name,
    at: h.at,
  }),
  crm: (c: {
    format: string;
    crmKey: string;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    personId?: number | null | undefined;
    name?: string | null | undefined;
    owner?: string | null | undefined;
    status?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [
      { kind: `crm:${c.format.toLowerCase()}`, value: c.crmKey },
      { kind: "email", value: c.email },
      { kind: "phone", value: c.phone },
      person(c.personId),
    ],
    name: c.name,
    traits: { crm_owner: c.owner, crm_status: c.status },
    at: c.at,
  }),
  /** A form entry: its address fields and visitor cookie as keys, its other answers as traits. */
  form: (f: {
    fields: Record<string, unknown>;
    visitor?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => {
    const traits: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f.fields))
      if (!FORM_SKIP.has(k) && TRAIT_KEY.test(k) && typeof v === "string") traits[k] = v;
    return {
      keys: keysOfFields(f.fields, f.visitor),
      name: nameOfFields(f.fields),
      traits,
      at: f.at,
    };
  },
  chat: (c: {
    email?: string | null | undefined;
    phone?: string | null | undefined;
    name?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [
      { kind: "email", value: c.email },
      { kind: "phone", value: c.phone },
    ],
    name: c.name,
    at: c.at,
  }),
  booking: (b: {
    email: string | null;
    name?: string | null | undefined;
    visitor?: string | null | undefined;
    at?: Date | undefined;
  }): ProfileInput => ({
    keys: [
      { kind: "email", value: b.email },
      { kind: "visitor", value: b.visitor },
    ],
    name: b.name,
    at: b.at,
  }),
};

/** Form fields that are keys or the name, not traits; and what a form must never keep. */
const FORM_SKIP = new Set([
  "email",
  "phone",
  "phone_number",
  "mobile",
  "name",
  "first_name",
  "last_name",
  "message",
  "password",
  "card",
]);

export interface Source {
  name: ProfileSource;
  /** Rows after `after` by id, at most `limit`, with `cursor` as text. */
  rows: (db: Queryable, after: string, limit: number) => Promise<Record<string, unknown>[]>;
  first: string;
  input: (r: Record<string, unknown>) => ProfileInput;
}

const at = (v: unknown) => (v instanceof Date ? v : v ? new Date(String(v)) : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const int = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute<Record<string, unknown>>(q)) as unknown as Record<string, unknown>[];

export const SOURCES: Source[] = [
  {
    name: "people_import",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select p.id::text cursor, p.id, p.full_name, p.title, p.linkedin_url, p.created_at,
          c.name company from people p left join companies c on c.id = p.company_id
          where p.id > ${Number(after)} order by p.id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.person({
        id: Number(r.id),
        fullName: str(r.full_name),
        title: str(r.title),
        company: str(r.company),
        linkedinUrl: str(r.linkedin_url),
        at: at(r.created_at),
      }),
  },
  {
    name: "lead_import",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select l.id::text cursor, l.email, l.person_id, l.first_name, l.last_name, l.title,
          l.country, l.social_url, l.created_at, c.name company
          from leads l left join companies c on c.id = l.company_id
          where l.id > ${Number(after)} order by l.id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.lead({
        email: String(r.email),
        personId: int(r.person_id),
        firstName: str(r.first_name),
        lastName: str(r.last_name),
        title: str(r.title),
        company: str(r.company),
        country: str(r.country),
        socialUrl: str(r.social_url),
        at: at(r.created_at),
      }),
  },
  {
    name: "enrollment",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, to_email, person_id, created_at from enrollments
          where id > ${Number(after)} order by id limit ${n}`,
      ),
    input: (r) => ({
      keys: [
        { kind: "email", value: str(r.to_email) },
        { kind: "person", value: int(r.person_id) },
      ],
      at: at(r.created_at),
    }),
  },
  {
    name: "sms_contact",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, e164, email, person_id, name, created_at from sms_contacts
          where id > ${Number(after)} order by id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.contact({
        e164: String(r.e164),
        email: str(r.email),
        personId: int(r.person_id),
        name: str(r.name),
        at: at(r.created_at),
      }),
  },
  {
    name: "consent",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, channel, address, created_at from consents
          where id > ${Number(after)} order by id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.consent({
        channel: String(r.channel),
        address: String(r.address),
        at: at(r.created_at),
      }),
  },
  {
    name: "social_handle",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, platform, handle, person_id, name, created_at
          from social_handles where id > ${Number(after)} order by id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.handle({
        platform: String(r.platform),
        handle: String(r.handle),
        personId: int(r.person_id),
        name: str(r.name),
        at: at(r.created_at),
      }),
  },
  {
    name: "crm",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select c.id::text cursor, c.format, c.crm_key, c.email, c.phone, c.person_id,
          c.owner, c.status, c.created_at, p.full_name
          from crm_contacts c left join people p on p.id = c.person_id
          where c.id > ${Number(after)} order by c.id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.crm({
        format: String(r.format),
        crmKey: String(r.crm_key),
        email: str(r.email),
        phone: str(r.phone),
        personId: int(r.person_id),
        name: str(r.full_name),
        owner: str(r.owner),
        status: str(r.status),
        at: at(r.created_at),
      }),
  },
  {
    // Wren's own forms: a client's live on main but its people are its own (their texts).
    name: "site_form",
    first: "00000000-0000-0000-0000-000000000000",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select e.id::text cursor, e.fields, e.visitor, e.at from site_forms e
          left join site_form_defs f on f.id = e.form left join site_pages p on p.id = e.page
          where e.id > ${after}::uuid and coalesce(f.client, p.client) is null
          order by e.id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.form({
        fields: (r.fields ?? {}) as Record<string, unknown>,
        visitor: str(r.visitor),
        at: at(r.at),
      }),
  },
  {
    name: "site_chat",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, email, phone, name, created_at from chat_threads
          where id > ${Number(after)} and (email is not null or phone is not null)
          order by id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.chat({
        email: str(r.email),
        phone: str(r.phone),
        name: str(r.name),
        at: at(r.created_at),
      }),
  },
  {
    name: "booking",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, email, name, source ->> 'visitor' visitor, created_at
          from calendar.bookings where id > ${Number(after)} order by id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.booking({
        email: str(r.email),
        name: str(r.name),
        visitor: str(r.visitor),
        at: at(r.created_at),
      }),
  },
  {
    name: "call_booking",
    first: "0",
    rows: (db, after, n) =>
      rows(
        db,
        sql`select id::text cursor, email, name, booked_at from call_bookings
          where id > ${Number(after)} and email is not null order by id limit ${n}`,
      ),
    input: (r) =>
      profileFrom.booking({ email: str(r.email), name: str(r.name), at: at(r.booked_at) }),
  },
];

export interface BackfillCount {
  source: ProfileSource;
  rows: number;
  created: number;
  merged: number;
  skipped: number;
}

/**
 * Every source's existing rows into profiles. `dryRun` counts rows only. `progress` hears each
 * batch. One row's failure is counted as skipped and logged; the rest go on.
 */
export async function backfillProfiles(
  db: Queryable,
  o: {
    dryRun?: boolean;
    only?: readonly string[];
    batch?: number;
    progress?: (c: BackfillCount) => void;
  } = {},
): Promise<BackfillCount[]> {
  const out: BackfillCount[] = [];
  const n = o.batch ?? 500;
  for (const s of SOURCES) {
    if (o.only?.length && !o.only.includes(s.name)) continue;
    const c: BackfillCount = { source: s.name, rows: 0, created: 0, merged: 0, skipped: 0 };
    for (let after = s.first; ; ) {
      const batch = await s.rows(db, after, n);
      if (!batch.length) break;
      for (const r of batch) {
        c.rows += 1;
        if (o.dryRun) continue;
        const { keys, ...rest } = s.input(r);
        try {
          const got = await resolveProfile(db, keys, s.name, rest);
          if (!got) c.skipped += 1;
          else {
            if (got.created) c.created += 1;
            c.merged += got.merged.length;
          }
        } catch (err) {
          c.skipped += 1;
          console.error(`backfill ${s.name} ${String(r.cursor)}: ${(err as Error).message}`);
        }
      }
      after = String(batch[batch.length - 1]?.cursor);
      o.progress?.(c);
      if (batch.length < n) break;
    }
    out.push(c);
  }
  return out;
}

/** A writer's row through `noteProfile`: never fails the write it rides on. */
export const noteProfileFrom = (db: Queryable, source: ProfileSource, input: ProfileInput) =>
  noteProfile(db, input.keys, source, input);

/**
 * Text contacts just written, into profiles: after `linkPeople`, so a linked person joins too.
 * Never fails the write it rides on.
 */
export async function noteContacts(db: Queryable, ids: readonly number[]): Promise<void> {
  const source = SOURCES.find((s) => s.name === "sms_contact");
  if (!ids.length || !source) return;
  try {
    const got = await rows(
      db,
      sql`select id::text cursor, e164, email, person_id, name, created_at from sms_contacts
        where id in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`,
    );
    for (const r of got) await noteProfileFrom(db, "sms_contact", source.input(r));
  } catch (err) {
    console.error(`profile (sms_contact): ${(err as Error).message}`);
  }
}

/** One page a visit saw before its form (`site_forms.pages`). */
export interface SeenPage {
  path: string;
  at: number;
}

/** A form entry's body on the timeline: its fields, then the pages seen before it. */
export function formBody(fields: Record<string, unknown>, pages?: readonly SeenPage[] | null) {
  const lines = Object.entries(fields)
    .filter(([, v]) => typeof v === "string" && v)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}: ${v}`);
  const seen = pages?.length ? `Pages seen first: ${pages.map((p) => p.path).join(", ")}` : null;
  return [lines.join("\n"), seen].filter(Boolean).join("\n\n") || null;
}

const money = (cents: number, currency: string) =>
  currency.toLowerCase() === "usd"
    ? `$${(cents / 100).toFixed(2)}`
    : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** A client's form entry, kept on main, as its workspace's timeline line. */
export interface ClientForm {
  id: string;
  title: string | null;
  fields: Record<string, unknown>;
  pages?: readonly SeenPage[] | null;
  at: Date;
}

/** A client's pay link, kept on main, as far as its timeline line needs. */
export interface ClientPayLink {
  id: string;
  contact: number | null;
  email: string | null;
  name: string | null;
  channel: string;
  description: string;
  amountCents: number;
  quantity: number;
  currency: string;
  sentAt: Date | null;
  paidCents: number | null;
  paidAt: Date | null;
}

/** Rows kept on main that belong to a client, as their one line in its workspace (B7). */
export const lineFrom = {
  form: (e: ClientForm): ElsewhereLine => ({
    kind: "form",
    channel: "site",
    at: e.at,
    summary: `${e.title ?? "A form"} sent`,
    body: formBody(e.fields, e.pages),
    link: `/sites/submissions/${e.id}`,
    source: "site_forms",
    sourceId: e.id,
  }),
  /** Null until it was sent or paid: a draft link is nothing that happened to anyone. */
  payLink: (l: ClientPayLink): ElsewhereLine | null => {
    const at = l.paidAt ?? l.sentAt;
    if (!at) return null;
    const what = ` for ${l.description}`;
    return {
      kind: "payment",
      channel: l.channel,
      at,
      summary: l.paidAt
        ? `Paid ${money(l.paidCents ?? l.amountCents * l.quantity, l.currency)}${what}`
        : `Pay link sent: ${money(l.amountCents * l.quantity, l.currency)}${what}`,
      link: `/payments/links/${l.id}`,
      source: "pay_links",
      sourceId: l.id,
    };
  },
};

/** A client's form entry into its workspace (`db`): its profile and its line. Never throws. */
export function noteClientForm(db: Queryable, e: ClientForm) {
  const { keys, ...o } = profileFrom.form({ fields: e.fields, at: e.at });
  return noteElsewhere(db, keys, "site_form", o, lineFrom.form(e));
}

/**
 * A client's pay link into its workspace (`db`), once sent and again when paid: its profile by
 * the email, or the text thread's number read here, and its line. Never throws.
 */
export async function noteClientPayLink(db: Queryable, l: ClientPayLink) {
  const line = lineFrom.payLink(l);
  if (!line) return null;
  try {
    const keys: ProfileKey[] = [{ kind: "email", value: l.email }];
    if (l.contact !== null) {
      const [c] = await rows(
        db,
        sql`select e164, email, person_id from sms_contacts where id = ${l.contact}`,
      );
      if (c)
        keys.push(
          { kind: "phone", value: str(c.e164) },
          { kind: "email", value: str(c.email) },
          { kind: "person", value: int(c.person_id) },
        );
    }
    return await noteElsewhere(db, keys, "payment", { name: l.name, at: line.at }, line);
  } catch (err) {
    console.error(`profile event (payment pay_links ${l.id}): ${(err as Error).message}`);
    return null;
  }
}

export interface ElsewhereCount {
  source: "site_forms" | "pay_links";
  rows: number;
  noted: number;
}

/**
 * One client's rows kept on main (form entries, sent or paid pay links) into its workspace, one
 * line each. Lines are upserted by source row, so running it twice changes nothing.
 */
export async function backfillClientRows(
  main: Queryable,
  client: string,
  workspace: Queryable,
  o: { dryRun?: boolean; batch?: number } = {},
): Promise<ElsewhereCount[]> {
  const n = o.batch ?? 500;
  const forms: ElsewhereCount = { source: "site_forms", rows: 0, noted: 0 };
  for (let after = "00000000-0000-0000-0000-000000000000"; ; ) {
    const batch = await rows(
      main,
      sql`select e.id::text id, e.fields, e.pages, e.at, coalesce(f.name, p.title) title
        from site_forms e left join site_form_defs f on f.id = e.form
        left join site_pages p on p.id = e.page
        where e.id > ${after}::uuid and coalesce(f.client, p.client) = ${client}
        order by e.id limit ${n}`,
    );
    for (const r of batch) {
      forms.rows += 1;
      if (o.dryRun) continue;
      const got = await noteClientForm(workspace, {
        id: String(r.id),
        title: str(r.title),
        fields: (r.fields ?? {}) as Record<string, unknown>,
        pages: (r.pages ?? null) as SeenPage[] | null,
        at: at(r.at) ?? new Date(),
      });
      if (got !== null) forms.noted += 1;
    }
    if (batch.length < n) break;
    after = String(batch[batch.length - 1]?.id);
  }
  const links: ElsewhereCount = { source: "pay_links", rows: 0, noted: 0 };
  for (let after = "00000000-0000-0000-0000-000000000000"; ; ) {
    const batch = await rows(
      main,
      sql`select id::text id, contact, email, name, channel, description, amount_cents, quantity,
          currency, sent_at, paid_cents, paid_at from pay_links
        where id > ${after}::uuid and client = ${client}
          and (sent_at is not null or paid_at is not null)
        order by id limit ${n}`,
    );
    for (const r of batch) {
      links.rows += 1;
      if (o.dryRun) continue;
      const got = await noteClientPayLink(workspace, {
        id: String(r.id),
        contact: int(r.contact),
        email: str(r.email),
        name: str(r.name),
        channel: String(r.channel),
        description: String(r.description),
        amountCents: Number(r.amount_cents),
        quantity: Number(r.quantity),
        currency: String(r.currency),
        sentAt: at(r.sent_at) ?? null,
        paidCents: int(r.paid_cents),
        paidAt: at(r.paid_at) ?? null,
      });
      if (got !== null) links.noted += 1;
    }
    if (batch.length < n) break;
    after = String(batch[batch.length - 1]?.id);
  }
  return [forms, links];
}

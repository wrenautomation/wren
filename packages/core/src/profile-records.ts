/**
 * Profiles as console records (designs/2026-10-14-customerio-audit.md, B1), the People app's:
 * the people (`people.profile`), every line of their timeline (`people.event`), each address
 * (`people.key`), trait (`people.trait`) and merge (`people.merge`), and the data index
 * (`people.datum`): every address kind, trait and timeline kind, who has it and what uses it.
 * Read only. Views in `./profiles-schema.ts`.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { TIMELINE_KIND_NAMES, type TimelineKind } from "./profiles-schema.js";
import {
  cued,
  date,
  defineRecord,
  link,
  name,
  number,
  prose,
  type RecordType,
  status,
  text,
} from "./records.js";
import type { Workflow } from "./workflows.js";

const KINDS = cued(
  Object.fromEntries(
    Object.entries(TIMELINE_KIND_NAMES).map(([k, label]) => [k, { label, tone: "neutral" }]),
  ) as Record<TimelineKind, { label: string; tone: "neutral" }>,
);

/** Where a line happened. The access channels, and the few places that aren't one. */
const CHANNELS = cued({
  email: { label: "Email", tone: "neutral" },
  sms: { label: "Text", tone: "neutral" },
  phone: { label: "Phone", tone: "neutral" },
  linkedin: { label: "LinkedIn", tone: "neutral" },
  reddit: { label: "Reddit", tone: "neutral" },
  x: { label: "X", tone: "neutral" },
  instagram: { label: "Instagram", tone: "neutral" },
  facebook: { label: "Facebook", tone: "neutral" },
  youtube: { label: "YouTube", tone: "neutral" },
  tiktok: { label: "TikTok", tone: "neutral" },
  google_business: { label: "Google", tone: "neutral" },
  site: { label: "Site", tone: "neutral" },
  calendar: { label: "Calendar", tone: "neutral" },
  workflow: { label: "Workflow", tone: "neutral" },
  profile: { label: "Profile", tone: "neutral" },
} as const);

/** One visit line: a page seen or a recorded session, from Wren's site log (B7). */
export interface VisitLine {
  /** When, ISO. */
  at: string;
  text: string;
  href: string | null;
}

/**
 * A Wren profile's site visits by its `visitor` keys (the `wv` cookie), read live from the
 * lander's log each time the page opens and never stored. Newest first; empty when the read fails.
 */
export type VisitReader = (visitors: readonly string[]) => Promise<VisitLine[]>;

/** The visitor keys a profile page reads, newest first. */
export const VISITORS_MAX = 5;

/** One row's lines counted by kind: the profile page's timeline, each count a link to its lines. */
export interface ProfileDetail {
  timeline: { kind: string; label: string; count: number; last: string | null; href: string }[];
  total: number;
  /** Every line, filtered to this profile. */
  href: string;
  /** Its site visits, read live; null where no reader is set or it has no visitor key. */
  visits: VisitLine[] | null;
}

/** The Timeline page's address for one profile's lines, of one kind when given. */
export const timelineHref = (profile: number | string, kind?: string) =>
  `/people/timeline?profile=${profile}..${profile}${kind ? `&kind=${kind}` : ""}`;

async function profileDetail(
  db: Queryable,
  id: string,
  visits?: VisitReader,
): Promise<ProfileDetail | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = (await db.execute<{ kind: string; n: number; last: Date | string | null }>(sql`
    select kind, count(*)::int n, max(at) last from profile_timeline
    where profile_id = ${Number(id)} group by kind`)) as unknown as {
    kind: string;
    n: number;
    last: Date | string | null;
  }[];
  const order = Object.keys(TIMELINE_KIND_NAMES);
  const timeline = rows
    .map((r) => ({
      kind: r.kind,
      label: TIMELINE_KIND_NAMES[r.kind as TimelineKind] ?? r.kind,
      count: Number(r.n),
      last: r.last instanceof Date ? r.last.toISOString() : r.last,
      href: timelineHref(id, r.kind),
    }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return {
    timeline,
    total: timeline.reduce((n, t) => n + t.count, 0),
    href: timelineHref(id),
    visits: visits ? await visitsOf(db, Number(id), visits) : null,
  };
}

async function visitsOf(db: Queryable, id: number, read: VisitReader) {
  const keys = (await db.execute<{ value: string }>(sql`
    select value from profile_keys where profile_id = ${id} and kind = 'visitor'
    order by first_seen desc limit ${VISITORS_MAX}`)) as unknown as { value: string }[];
  return keys.length ? read(keys.map((k) => k.value)) : null;
}

export const profileRecord = defineRecord({
  id: "people.profile",
  app: "people",
  channel: null,
  name: { one: "person", many: "people" },
  view: "profile_records",
  key: "id",
  title: "name",
  subtitle: "emails",
  fields: {
    name: name(),
    emails: text("Emails"),
    phones: text("Phones"),
    handles: text("Handles"),
    channels: text("Channels"),
    consent: text("Consent"),
    lastSeen: date("Last seen"),
    firstSeen: date("First seen"),
    keys: number("Addresses"),
    traits: number("Traits"),
    merged: number("Merged in"),
  },
  views: [
    { id: "all", label: "All", sort: "-lastSeen", at: "firstSeen" },
    { id: "email", label: "With email", where: { emails: { empty: false } }, sort: "-lastSeen" },
    { id: "phone", label: "With phone", where: { phones: { empty: false } }, sort: "-lastSeen" },
    { id: "merged", label: "Merged", where: { merged: { gte: 1 } }, sort: "-lastSeen" },
  ],
  related: [
    { record: "people.key", by: "profile_id" },
    { record: "people.trait", by: "profile_id" },
    { record: "people.event", by: "profile_id" },
    { record: "people.merge", by: "into_id" },
  ],
  // The Timeline tab is `people.event` by profile: whole rows, each linked to its own page.
  load: (db, id) => profileDetail(db, id),
});

export const eventRecord = defineRecord({
  id: "people.event",
  app: "people",
  channel: { field: "channel" },
  name: { one: "timeline line", many: "timeline" },
  view: "profile_timeline",
  key: "id",
  title: "summary",
  subtitle: "who",
  fields: {
    at: date("When"),
    who: name("Who"),
    kind: status(KINDS, "Kind"),
    channel: status(CHANNELS),
    summary: text("What"),
    body: prose("All of it"),
    link: link("Its page"),
    profileLink: link("Profile"),
    profile: number("Profile id", { from: "profile_id", listed: false }),
    source: text("Table", { listed: false }),
  },
  quick: ["kind", "channel"],
  views: [{ id: "all", label: "All", sort: "-at", at: "at" }],
});

export const keyRecord = defineRecord({
  id: "people.key",
  app: "people",
  channel: null,
  name: { one: "address", many: "addresses" },
  view: "profile_key_records",
  key: "id",
  title: "value",
  subtitle: "kind",
  fields: {
    kind: text("Kind"),
    value: text("Address"),
    source: text("First from"),
    firstSeen: date("First seen"),
    profileLink: link("Profile"),
    profile: number("Profile id", { from: "profile_id", listed: false }),
  },
  views: [{ id: "all", label: "All", sort: "-firstSeen", at: "firstSeen" }],
});

export const traitRecord = defineRecord({
  id: "people.trait",
  app: "people",
  channel: null,
  name: { one: "trait", many: "traits" },
  view: "profile_trait_records",
  key: "id",
  title: "key",
  subtitle: "value",
  fields: {
    key: text("Trait"),
    value: text("Value"),
    source: text("From"),
    at: date("Set"),
    changes: number("Changes"),
    profileLink: link("Profile"),
    profile: number("Profile id", { from: "profile_id", listed: false }),
  },
  views: [{ id: "all", label: "All", sort: "-at", at: "at" }],
  activity: { view: "profile_trait_activity", by: "trait", seq: "seq", label: "Changes" },
});

export const mergeRecord = defineRecord({
  id: "people.merge",
  app: "people",
  channel: null,
  name: { one: "merge", many: "merges" },
  view: "profile_merge_records",
  key: "id",
  title: "fromName",
  subtitle: "by",
  fields: {
    fromName: name("Merged in"),
    by: text("Found by"),
    keys: number("Addresses moved"),
    traits: number("Traits taken"),
    source: text("Seen by"),
    at: date("When"),
    intoLink: link("Profile"),
    into: number("Profile id", { from: "into_id", listed: false }),
  },
  views: [{ id: "all", label: "All", sort: "-at", at: "at" }],
});

/** Which timeline kinds a workflow trigger hears. */
const HEARD_BY: Readonly<Record<string, readonly string[]>> = {
  "trigger.reply": ["email_received", "text_received"],
  "trigger.booking": ["booking"],
  "trigger.form": ["form"],
  "trigger.hook": ["form"],
  "trigger.payment": ["payment"],
};

/** Each timeline kind, address kind and trait: the workflows that use it, by name. */
export function usesOf(workflows: readonly Workflow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, wf: string) => {
    const has = out.get(id) ?? [];
    if (!has.includes(wf)) out.set(id, [...has, wf]);
  };
  for (const w of workflows)
    for (const n of w.nodes) {
      for (const k of HEARD_BY[n.uses ?? ""] ?? []) add(`event:${k}`, w.name);
      // A node that reads a trait names it `trait.<key>` in its settings (B5).
      for (const m of JSON.stringify(n.with ?? {}).matchAll(/trait\.([a-z][a-z0-9_]{0,63})/g))
        add(`trait:${m[1]}`, w.name);
    }
  return out;
}

const DATA_KINDS = {
  address: { label: "Address", tone: "neutral" },
  trait: { label: "Trait", tone: "neutral" },
  event: { label: "Timeline", tone: "neutral" },
} as const;

/**
 * The data index: every address kind, trait key and timeline kind there is, where it comes from,
 * how many people have it, when it was last seen and which workflows use it. Segments join
 * "used by" when they land (B5).
 */
export function datumRecord(workflows: readonly Workflow[] = []): RecordType {
  const uses = usesOf(workflows);
  return defineRecord({
    id: "people.datum",
    app: "people",
    channel: null,
    name: { one: "data point", many: "data" },
    key: "id",
    title: "name",
    subtitle: "what",
    fields: {
      what: status(DATA_KINDS, "Is"),
      name: text("Name"),
      sources: text("From"),
      people: number("People"),
      rows: number("Rows"),
      lastSeen: date("Last seen"),
      usedBy: text("Used by"),
      list: link("Its rows"),
    },
    quick: ["what"],
    views: [{ id: "all", label: "All", sort: "-people" }],
    rows: async (db) => {
      const raw = (await db.execute(sql`
        select 'address' what, kind "name", string_agg(distinct source, ', ') sources,
          count(distinct profile_id)::int people, count(*)::int "rows", max(first_seen) last_seen
        from profile_keys group by kind
        union all
        select 'trait', key, string_agg(distinct source, ', '), count(distinct profile_id)::int,
          count(*)::int, max(at)
        from profile_traits t
        where exists (select 1 from profiles p where p.id = t.profile_id and p.merged_into is null)
        group by key
        union all
        select 'event', kind, string_agg(distinct source, ', '), count(distinct profile_id)::int,
          count(*)::int, max(at)
        from profile_timeline group by kind`)) as unknown as {
        what: "address" | "trait" | "event";
        name: string;
        sources: string | null;
        people: number;
        rows: number;
        last_seen: Date | string | null;
      }[];
      return raw.map((r) => {
        const id = `${r.what}:${r.name}`;
        return {
          id,
          what: r.what,
          name:
            r.what === "event" ? (TIMELINE_KIND_NAMES[r.name as TimelineKind] ?? r.name) : r.name,
          sources: r.sources,
          people: Number(r.people),
          rows: Number(r.rows),
          last_seen: r.last_seen instanceof Date ? r.last_seen.toISOString() : r.last_seen,
          used_by: uses.get(id)?.join(", ") ?? null,
          list:
            r.what === "event"
              ? `/people/timeline?kind=${r.name}`
              : r.what === "trait"
                ? `/people/traits?key=~${encodeURIComponent(r.name)}`
                : `/people/addresses?kind=~${encodeURIComponent(r.name)}`,
        };
      });
    },
  });
}

/** Every People record past the sent log, the data index's "used by" read from `workflows`. */
/**
 * The People app's records. `visits`: Wren's own console reads its profiles' site visits live
 * (a client's sites keep no visitor id, so its profiles have none).
 */
export function profileRecords(
  workflows: readonly Workflow[] = [],
  o: { visits?: VisitReader } = {},
): RecordType[] {
  const read = o.visits;
  const profile: RecordType = read
    ? { ...profileRecord, load: (db, id) => profileDetail(db, id, read) }
    : profileRecord;
  return [profile, eventRecord, keyRecord, traitRecord, mergeRecord, datumRecord(workflows)];
}

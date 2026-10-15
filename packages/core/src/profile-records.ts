/**
 * Profiles as console records (designs/2026-10-14-customerio-audit.md, B1), the People app's:
 * the people (`people.profile`), every line of their timeline (`people.event`), each address
 * (`people.key`), trait (`people.trait`) and merge (`people.merge`), and the data index
 * (`people.datum`): every address kind, trait and timeline kind, who has it and what uses it.
 * Read only. Views in `./profiles-schema.ts`.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { REASON_WORDS, STAGE_WORDS, warmthOf } from "./people-map.js";
import { WARM_REASONS } from "./people-map-schema.js";
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
  type State,
  status,
  text,
} from "./records.js";
import { conditionsOf, dataOf, listSegments } from "./segments.js";
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
  chat: { label: "Site chat", tone: "neutral" },
  calendar: { label: "Calendar", tone: "neutral" },
  workflow: { label: "Workflow", tone: "neutral" },
  profile: { label: "Profile", tone: "neutral" },
} as const);

const STAGE_STATES = cued({
  stranger: {
    label: "Stranger",
    tone: "neutral",
    about: "An address only: never reached, never came to us.",
  },
  lead: { label: "Lead", tone: "neutral", about: "We reached them, or they showed a warm sign." },
  replied: {
    label: "Replied",
    tone: "good",
    about: "Wrote back on any channel, sent a form or chatted.",
  },
  booked: { label: "Booked", tone: "good", about: "Booked a call that wasn't cancelled." },
  client: {
    label: "Client",
    tone: "good",
    about: "Paid, signs in to a workspace, or marked a client.",
  },
  past_client: { label: "Past client", tone: "neutral", about: "Marked a past client." },
} as const);

const WARMTH = cued({
  warm: {
    label: "Warm",
    tone: "good",
    about: "Did something toward us: never send a cold opener.",
  },
  cold: { label: "Cold", tone: "neutral", about: "Never came toward us." },
} as const);

const ROLES = cued({
  owner: { label: "Owner", tone: "neutral" },
  executive: { label: "Executive", tone: "neutral" },
  manager: { label: "Manager", tone: "neutral" },
  staff: { label: "Staff", tone: "neutral" },
  unknown: { label: "Unknown", tone: "neutral" },
} as const);

const SIZES = cued({
  solo: { label: "Solo", tone: "neutral", about: "One person." },
  small: { label: "Small", tone: "neutral", about: "2 to 9 people." },
  mid: { label: "Mid", tone: "neutral", about: "10 to 49 people." },
  large: { label: "Large", tone: "neutral", about: "50 or more." },
  unknown: { label: "Unknown", tone: "neutral" },
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

/** The newest lines a profile page draws on its short rail. */
export const PROFILE_LINES = 8;

/** One of a profile's newest lines, with its kind's and channel's states as the Timeline draws them. */
export interface ProfileLine {
  id: string;
  /** ISO. */
  at: string;
  kind: string;
  summary: string | null;
  /** Its source's page, when it has one. */
  link: string | null;
  kindState: State | null;
  channelState: State | null;
}

/** One row's lines counted by kind: the profile page's timeline, each count a link to its lines. */
export interface ProfileDetail {
  timeline: { kind: string; label: string; count: number; last: string | null; href: string }[];
  total: number;
  /** Its newest lines, `PROFILE_LINES` at most. */
  lines: ProfileLine[];
  /** Every line, filtered to this profile. */
  href: string;
  /** Its site visits, read live; null where no reader is set or it has no visitor key. */
  visits: VisitLine[] | null;
  /** Where they stand and why, read live from the sources (the people map). */
  warmth: WarmthDetail | null;
}

/** The person page's Warmth section: the map's row for one profile, in words. */
export interface WarmthDetail {
  stage: string;
  warmth: "warm" | "cold";
  line: string | null;
  /** Each thing they did toward us, and what we sent them, counted. */
  counts: { label: string; n: number; first: string | null; last: string | null }[];
  subscriptions: string | null;
  repliedOn: string | null;
  first: { at: string; channel: string | null; what: string | null } | null;
  last: { at: string; channel: string | null; what: string | null } | null;
  cameFrom: string | null;
  persona: string;
  role: string;
  niche: string;
  size: string;
}

async function warmthDetail(db: Queryable, id: number): Promise<WarmthDetail | null> {
  const [r] = await warmthOf(db, [id]);
  if (!r) return null;
  return {
    stage: STAGE_WORDS[r.stage],
    warmth: r.warmth,
    line: r.warmthLine,
    counts: [
      ...WARM_REASONS.map((k) => ({ label: REASON_WORDS[k], ...r.counts[k] })),
      { label: "we reached out", ...r.counts.contacted },
    ].filter((c) => c.n > 0),
    subscriptions: r.subscriptions,
    repliedOn: r.repliedChannels,
    first: r.firstTouch,
    last: r.lastTouch,
    cameFrom: r.cameFrom,
    persona: r.persona,
    role: r.personaRole,
    niche: r.personaNiche,
    size: r.personaSize,
  };
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
    lines: timeline.length ? await linesOf(db, Number(id)) : [],
    href: timelineHref(id),
    visits: visits ? await visitsOf(db, Number(id), visits) : null,
    warmth: await warmthDetail(db, Number(id)),
  };
}

async function linesOf(db: Queryable, id: number): Promise<ProfileLine[]> {
  const rows = (await db.execute(sql`
    select id, at, kind, channel, summary, link from profile_timeline
    where profile_id = ${id} order by at desc, id desc limit ${PROFILE_LINES}`)) as unknown as {
    id: string;
    at: Date | string;
    kind: string;
    channel: string | null;
    summary: string | null;
    link: string | null;
  }[];
  return rows.map((r) => ({
    id: String(r.id),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    kind: r.kind,
    summary: r.summary,
    link: r.link,
    kindState: (KINDS as Record<string, State>)[r.kind] ?? null,
    channelState: r.channel ? ((CHANNELS as Record<string, State>)[r.channel] ?? null) : null,
  }));
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
    stage: status(STAGE_STATES, "Stage"),
    warmth: status(WARMTH, "Warmth"),
    warmthLine: text("What they did"),
    persona: text("Persona"),
    emails: text("Emails"),
    phones: text("Phones"),
    handles: text("Handles"),
    channels: text("Channels"),
    consent: text("Consent"),
    subscriptions: text("Subscriptions"),
    replies: number("Replies"),
    repliedLast: date("Last reply"),
    repliedChannel: status(CHANNELS, "Replied on"),
    lastTouchAt: date("Last touch"),
    lastChannel: status(CHANNELS, "Last touch on"),
    firstChannel: status(CHANNELS, "First touch on"),
    cameFrom: text("Came from"),
    warmSince: date("Warm since"),
    why: text("Why warm", { listed: false }),
    personaRole: status(ROLES, "Role"),
    personaNiche: text("Niche"),
    personaSize: status(SIZES, "Size"),
    lastSeen: date("Last seen"),
    firstSeen: date("First seen"),
    keys: number("Addresses"),
    traits: number("Traits"),
    merged: number("Merged in"),
  },
  quick: ["stage", "warmth", "personaRole", "personaSize", "firstChannel"],
  views: [
    { id: "all", label: "All", sort: "-lastSeen", at: "firstSeen" },
    {
      id: "warm",
      label: "Warm",
      where: { warmth: "warm" },
      sort: "-warmSince",
      hint: "Did something toward us: subscribed, replied, booked, visited, opened, engaged.",
    },
    { id: "replied", label: "Replied", where: { replies: { gte: 1 } }, sort: "-repliedLast" },
    { id: "booked", label: "Booked", where: { stage: "booked" }, sort: "-lastTouchAt" },
    {
      id: "clients",
      label: "Clients",
      where: { stage: ["client", "past_client"] },
      sort: "-lastTouchAt",
    },
    { id: "cold", label: "Cold", where: { warmth: "cold" }, sort: "-lastTouchAt" },
    {
      id: "subscribed",
      label: "Subscribed",
      where: { subscriptions: { empty: false } },
      sort: "-lastTouchAt",
    },
    { id: "email", label: "With email", where: { emails: { empty: false } }, sort: "-lastSeen" },
    { id: "phone", label: "With phone", where: { phones: { empty: false } }, sort: "-lastSeen" },
    { id: "merged", label: "Merged", where: { merged: { gte: 1 } }, sort: "-lastSeen" },
  ],
  related: [
    { record: "people.key", by: "profile_id" },
    { record: "people.trait", by: "profile_id" },
    { record: "people.event", by: "profile_id" },
    { record: "people.merge", by: "into_id" },
    { record: "people.member", by: "profile_id" },
  ],
  // Put in a manual segment (B5).
  actions: ["people.memberAdd"],
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
      // Trait changed and Date name their trait plainly.
      if ((n.uses === "trigger.trait" || n.uses === "trigger.date") && n.with?.trait)
        add(`trait:${String(n.with.trait)}`, w.name);
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

/** Each data point the workspace's active segments read: "Segment <name>", by datum id. */
async function segmentUses(db: Queryable): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const s of await listSegments(db, "active")) {
    if (!s.rule) continue;
    for (const id of new Set(conditionsOf(s.rule).flatMap(dataOf)))
      out.set(id, [...(out.get(id) ?? []), `Segment ${s.name}`]);
  }
  return out;
}

/**
 * The data index: every address kind, trait key and timeline kind there is, where it comes from,
 * how many people have it, when it was last seen and which workflows and segments use it.
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
      const bySegment = await segmentUses(db);
      return raw.map((r) => {
        const id = `${r.what}:${r.name}`;
        const usedBy = [...(uses.get(id) ?? []), ...(bySegment.get(id) ?? [])];
        return {
          id,
          what: r.what,
          name:
            r.what === "event" ? (TIMELINE_KIND_NAMES[r.name as TimelineKind] ?? r.name) : r.name,
          sources: r.sources,
          people: Number(r.people),
          rows: Number(r.rows),
          last_seen: r.last_seen instanceof Date ? r.last_seen.toISOString() : r.last_seen,
          used_by: usedBy.length ? usedBy.join(", ") : null,
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

/**
 * The message rules a workspace sets for marketing sends (designs/2026-10-14-customerio-audit.md,
 * B4): a per-person cap across email, texts and DMs together, and the switch that tags every link
 * with where it came from. One row in `message_settings`; a missing row is the defaults.
 *
 * Cold outreach keeps its own policy and never reads this. Transactional mail (an opt-in confirm,
 * a receipt) is exempt: it never asks `mayMarket`. A newsletter asks `mayMarket`; a follow-up text
 * or DM to someone who asked has no topic consent, so its sender asks `capCheck` and counts the
 * send with `countMarketingSend`. One person is one key (`profile:<id>`) when People knows them.
 */
import type { Queryable } from "@wren/db";
import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { profileOf } from "./profiles.js";
import { marketingSends, messageSettings, type SendChannel } from "./schema.js";
import { normalizeValue } from "./suppress.js";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface MessageSettings {
  /** The most marketing messages one person gets in a rolling day, all channels; null: no cap. */
  capPerDay: number | null;
  capPerWeek: number | null;
  /** Tag every http link in marketing messages with `utm_*`. */
  utmLinks: boolean;
}

/** What a workspace has before anyone changes it: generous caps, links tagged. */
export const MESSAGE_DEFAULTS: Readonly<MessageSettings> = {
  capPerDay: 2,
  capPerWeek: 5,
  utmLinks: true,
};
/** The most a cap can be set to: past it, say no cap. */
export const CAP_MAX = 100;

/** The workspace's rules: the saved row over the defaults. */
export async function readMessageSettings(db: Queryable): Promise<MessageSettings> {
  const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  return row
    ? { capPerDay: row.capPerDay, capPerWeek: row.capPerWeek, utmLinks: row.utmLinks }
    : { ...MESSAGE_DEFAULTS };
}

/** A cap from a form: blank, 0 or "off" is no cap; else a whole number up to `CAP_MAX`. */
export function capOf(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().toLowerCase();
  if (text === "" || text === "0" || text === "off" || text === "none" || text === "no cap") {
    return null;
  }
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > CAP_MAX) {
    throw new RangeError(`a cap is a whole number from 1 to ${CAP_MAX}, or off`);
  }
  return n;
}

/** Change some of the rules; a field left out keeps its value. Returns what is saved now. */
export async function saveMessageSettings(
  db: Queryable,
  patch: Partial<MessageSettings>,
  by: string,
): Promise<MessageSettings> {
  const now = await readMessageSettings(db);
  const next: MessageSettings = {
    capPerDay: patch.capPerDay === undefined ? now.capPerDay : patch.capPerDay,
    capPerWeek: patch.capPerWeek === undefined ? now.capPerWeek : patch.capPerWeek,
    utmLinks: patch.utmLinks ?? now.utmLinks,
  };
  if (next.capPerDay !== null && next.capPerWeek !== null && next.capPerWeek < next.capPerDay) {
    throw new RangeError("the weekly cap can't be under the daily one");
  }
  await db
    .insert(messageSettings)
    .values({ id: 1, ...next, updatedBy: by.slice(0, 200) })
    .onConflictDoUpdate({
      target: messageSettings.id,
      set: { ...next, updatedBy: by.slice(0, 200), updatedAt: new Date() },
    });
  return next;
}

/**
 * Who a channel address is, as the person's one key: `profile:<id>` when People knows the person,
 * else `<kind>:<address>`. `kind` is `email`, `phone` or `handle:<platform>`, People's own key
 * kinds. Email, SMS and DM keys only add up when something knows the person behind them.
 */
export type PersonResolver = (db: Queryable, kind: string, value: string) => Promise<string | null>;

/**
 * People's answer, read only: the profile an address already belongs to. An address People has
 * not met stands alone until it does; this never makes a profile.
 */
const profileResolver: PersonResolver = async (db, kind, value) => {
  const id = await profileOf(db, { kind, value });
  return id === null ? null : `profile:${id}`;
};

let resolver: PersonResolver = profileResolver;
/** Swap how a person is found (null: People's profiles, the default). A test seam. */
export const setPersonResolver = (fn: PersonResolver | null): void => {
  resolver = fn ?? profileResolver;
};

/**
 * The one key a person's sends are counted under, whichever channel the address is on. A DM
 * names its `platform`, since a handle is only one on its own site.
 */
export async function personKeyOf(
  db: Queryable,
  channel: SendChannel,
  address: string,
  platform?: string,
): Promise<string> {
  if (channel === "dm") {
    const handle = address.trim();
    const kind = `handle:${platform ?? "dm"}`;
    return (await resolver(db, kind, handle)) ?? `${kind}:${handle.toLowerCase()}`.slice(0, 340);
  }
  const kind = channel === "email" ? "email" : "phone";
  // A blank or odd address never stops a send: it counts under what was written.
  let value: string;
  try {
    value = normalizeValue(kind, address);
  } catch {
    value = kind === "phone" ? address.replace(/[^\d+]/g, "") : address.trim().toLowerCase();
  }
  return (await resolver(db, kind, value)) ?? `${kind}:${value}`.slice(0, 340);
}

/**
 * Every key this person's sends were ever counted under. A `profile:<id>` key also stands for the
 * profiles merged into it, since a merge moves the keys but not the ledger: sends counted before
 * it sit under the old id. Any other key stands alone.
 */
export async function keysOfPerson(db: Queryable, personKey: string): Promise<string[]> {
  const m = /^profile:(\d+)$/.exec(personKey);
  if (!m) return [personKey];
  const rows = await db.execute<{ id: number }>(sql`
    with recursive up(id, hops) as (
      select ${Number(m[1])}::int, 0
      union all
      select p.merged_into, up.hops + 1 from profiles p join up on p.id = up.id
      where p.merged_into is not null and up.hops < 50),
    root as (select id from up order by hops desc limit 1),
    down(id) as (
      select id from root
      union
      select p.id from profiles p join down on p.merged_into = down.id)
    select id from down`);
  const keys = rows.map((r) => `profile:${r.id}`);
  return keys.includes(personKey) ? keys : [personKey, ...keys];
}

/** Which cap a person is at, now, or null when under both. */
export async function overCap(
  db: Queryable,
  personKey: string,
  now: Date = new Date(),
): Promise<"day" | "week" | null> {
  const { capPerDay, capPerWeek } = await readMessageSettings(db);
  if (capPerDay === null && capPerWeek === null) return null;
  const keys = await keysOfPerson(db, personKey);
  const [n] = await db
    .select({
      week: count(),
      day: sql<number>`count(*) filter (where ${gt(marketingSends.sentAt, new Date(now.getTime() - DAY))})`.mapWith(
        Number,
      ),
    })
    .from(marketingSends)
    .where(
      and(
        inArray(marketingSends.personKey, keys),
        gt(marketingSends.sentAt, new Date(now.getTime() - WEEK)),
      ),
    );
  if (capPerDay !== null && (n?.day ?? 0) >= capPerDay) return "day";
  if (capPerWeek !== null && (n?.week ?? 0) >= capPerWeek) return "week";
  return null;
}

/** A marketing message went out: it counts toward the person's cap, on any channel. */
export async function recordMessageSend(
  db: Queryable,
  input: {
    personKey: string;
    channel: SendChannel;
    /** The workflow, broadcast or campaign slug. */
    campaign?: string | null;
    now?: Date;
  },
): Promise<void> {
  await db.insert(marketingSends).values({
    personKey: input.personKey,
    channel: input.channel,
    campaign: input.campaign ? input.campaign.slice(0, 120) : null,
    sentAt: input.now ?? new Date(),
  });
}

/**
 * When a person has room again: null when they are under both caps now, else the moment the
 * oldest send holding them back leaves its window. A queued message waits until then.
 */
export async function capRoomAt(
  db: Queryable,
  personKey: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const { capPerDay, capPerWeek } = await readMessageSettings(db);
  if (capPerDay === null && capPerWeek === null) return null;
  const keys = await keysOfPerson(db, personKey);
  const rows = await db
    .select({ at: marketingSends.sentAt })
    .from(marketingSends)
    .where(
      and(
        inArray(marketingSends.personKey, keys),
        gt(marketingSends.sentAt, new Date(now.getTime() - WEEK)),
      ),
    )
    .orderBy(desc(marketingSends.sentAt))
    .limit(CAP_MAX);
  const sent = rows.map((r) => r.at.getTime());
  let room = 0;
  if (capPerDay !== null) {
    const today = sent.filter((t) => t > now.getTime() - DAY);
    const holding = today[capPerDay - 1];
    if (holding !== undefined) room = Math.max(room, holding + DAY);
  }
  const holdingWeek = capPerWeek === null ? undefined : sent[capPerWeek - 1];
  if (holdingWeek !== undefined) room = Math.max(room, holdingWeek + WEEK);
  return room ? new Date(room) : null;
}

/**
 * The cap, for a text or DM to someone who asked for it (a form, a thread we wrote on) and gave
 * no topic consent: `mayMarket` would refuse them, so the cap is all that applies. `until` is
 * when they have room, null when they have it now. `person` is the key the send counts under.
 */
export async function capCheck(
  db: Queryable,
  channel: SendChannel,
  address: string,
  now: Date,
  platform?: string,
): Promise<{ person: string; until: Date | null }> {
  const person = await personKeyOf(db, channel, address, platform);
  return { person, until: await capRoomAt(db, person, now) };
}

/** `recordMessageSend` for a message that already went: a ledger error is logged, never thrown. */
export async function countMarketingSend(
  db: Queryable,
  input: Parameters<typeof recordMessageSend>[1],
): Promise<void> {
  try {
    await recordMessageSend(db, input);
  } catch (err) {
    console.error(`marketing send not counted (${input.channel}): ${(err as Error).message}`);
  }
}

/** The workflow a follow-up's `ref` (`<workflow>/<node>`) names, as its campaign slug. */
export const campaignOfRef = (ref: string | null | undefined): string | null =>
  ref ? ref.split("/")[0] || null : null;

// ---- Link parameters ----

/** A name as a parameter value: lowercase words joined by `-`, up to 60 characters. */
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export interface LinkTags {
  /** Whose message: the client's short name. */
  source: string;
  /** Where it went: `email`, `sms` or `dm`. */
  medium: string;
  /** The workflow, broadcast or campaign slug; none leaves `utm_campaign` off. */
  campaign?: string | null;
}

const URL_AT = /https?:\/\/[^\s<>"'`\])]+/g;
/** Sentence punctuation just after a link is not part of it. */
const TRAILING = /[.,;:!?]+$/;
/** Our own tracked links add their own parameters. */
const TRACKED = /^\/go\//;

function tagOne(url: string, tags: LinkTags): string {
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  const tail = hash === -1 ? "" : url.slice(hash);
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return url;
  }
  if (TRACKED.test(parsed.pathname)) return url;
  const add: [string, string][] = [
    ["utm_source", slugOf(tags.source)],
    ["utm_medium", slugOf(tags.medium)],
    ["utm_campaign", tags.campaign ? slugOf(tags.campaign) : ""],
  ];
  const fresh = add.filter(([k, v]) => v && !parsed.searchParams.has(k));
  if (!fresh.length) return url;
  const query = fresh.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  // Written onto the text as it was, so a link's own parts are never re-encoded.
  const join = base.includes("?") ? (/[?&]$/.test(base) ? "" : "&") : "?";
  return `${base}${join}${query}${tail}`;
}

/**
 * Every http link in `text` with `utm_source`, `utm_medium` and `utm_campaign` added. A parameter
 * already on the link stays as it is, and our own `/go/` links are left alone. Run it on the
 * body, not on the signed footer.
 */
export function tagLinks(text: string, tags: LinkTags): string {
  return text.replace(URL_AT, (match) => {
    const trail = TRAILING.exec(match)?.[0] ?? "";
    const url = trail ? match.slice(0, -trail.length) : match;
    return tagOne(url, tags) + trail;
  });
}

/** `tagLinks` when the workspace has the switch on, else the text as it is. */
export async function tagged(db: Queryable, text: string, tags: LinkTags): Promise<string> {
  return (await readMessageSettings(db)).utmLinks ? tagLinks(text, tags) : text;
}

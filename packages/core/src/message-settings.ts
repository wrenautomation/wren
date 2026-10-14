/**
 * The message rules a workspace sets for marketing sends (designs/2026-10-14-customerio-audit.md,
 * B4): a per-person cap across email, texts and DMs together, and the switch that tags every link
 * with where it came from. One row in `message_settings`; a missing row is the defaults.
 *
 * Cold outreach keeps its own policy and never reads this. Transactional mail (an opt-in confirm,
 * a receipt) is exempt: it never asks `mayMarket`.
 */
import type { Queryable } from "@wren/db";
import { and, count, eq, gt, isNotNull, sql } from "drizzle-orm";
import { leads, marketingSends, messageSettings, type SendChannel } from "./schema.js";
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
 * Who a channel address is, as the person's one key: `person:<id>` when something knows the
 * person, else `<kind>:<address>`. Email, SMS and DM keys only add up when something knows the
 * person behind them, so a sender with a better answer (a profile layer) sets one.
 */
export type PersonResolver = (
  db: Queryable,
  kind: "email" | "phone" | "handle",
  value: string,
) => Promise<string | null>;

/** Core knows the person behind an email through `leads.person_id`; nothing else here does. */
const leadPerson: PersonResolver = async (db, kind, value) => {
  if (kind !== "email") return null;
  const [row] = await db
    .select({ id: leads.personId })
    .from(leads)
    .where(and(eq(leads.email, value), isNotNull(leads.personId)))
    .limit(1);
  return row?.id ? `person:${row.id}` : null;
};

let resolver: PersonResolver = leadPerson;
/** Swap how a person is found (null: back to leads only). */
export const setPersonResolver = (fn: PersonResolver | null): void => {
  resolver = fn ?? leadPerson;
};

const KIND = { email: "email", sms: "phone", dm: "handle" } as const;

/** The one key a person's sends are counted under, whichever channel the address is on. */
export async function personKeyOf(
  db: Queryable,
  channel: SendChannel,
  address: string,
): Promise<string> {
  const kind = KIND[channel];
  const value = kind === "handle" ? address.trim().toLowerCase() : normalizeValue(kind, address);
  return (await resolver(db, kind, value)) ?? `${kind}:${value}`.slice(0, 340);
}

/** Which cap a person is at, now, or null when under both. */
export async function overCap(
  db: Queryable,
  personKey: string,
  now: Date = new Date(),
): Promise<"day" | "week" | null> {
  const { capPerDay, capPerWeek } = await readMessageSettings(db);
  if (capPerDay === null && capPerWeek === null) return null;
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
        eq(marketingSends.personKey, personKey),
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

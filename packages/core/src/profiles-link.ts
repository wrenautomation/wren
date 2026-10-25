/**
 * A booker we already reached under another address: an invite went to their LinkedIn, they
 * searched for us and booked with their work email. Keys alone never meet, so two profiles hold one person and the booking shows no earlier touch.
 *
 * `linkByName` joins them when the full name matches and a domain agrees: the booker's email
 * domain and the other profile's company domain (or one of its emails) share a name
 * (`acme.com` and `acme.io`). A name match with nothing to agree leaves a "may be the same
 * person" line on the booker's timeline for a person to judge; nothing merges on a name alone.
 */
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { mergeProfiles } from "./profiles.js";
import { profileEvents } from "./profiles-schema.js";

/** Mail hosts anyone can sign up at: their domain says nothing about a company. */
const FREE_MAIL = [
  "gmail",
  "googlemail",
  "outlook",
  "hotmail",
  "live",
  "msn",
  "yahoo",
  "ymail",
  "icloud",
  "me",
  "mac",
  "aol",
  "proton",
  "protonmail",
  "pm",
  "gmx",
  "zoho",
  "yandex",
  "mail",
  "fastmail",
  "hey",
  "rediffmail",
  "qq",
  "163",
];

/** A domain's own name, the label before its suffix: `www.acme.co.uk` and `acme.io` are `acme`. */
function domainName(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // Two-part suffixes (co.uk, com.au, co.in): the name is one further left.
  const second = parts[parts.length - 2] as string;
  const name =
    parts.length >= 3 && ["co", "com", "net", "org", "ac", "gov", "edu"].includes(second)
      ? (parts[parts.length - 3] as string)
      : second;
  return name.length >= 4 && !FREE_MAIL.includes(name) ? name : null;
}

/** A full name as compared: lowercased, spaces squeezed; null when it is not two words or more. */
export function nameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.trim().toLowerCase().replace(/\s+/g, " ");
  return s.split(" ").length >= 2 && s.length >= 5 ? s : null;
}

interface Linked {
  /** Profiles merged into the booker's (or the booker's into the older one). */
  merged: number[];
  /** Same name, nothing agreed: a line left for a person. */
  maybe: number[];
  /** The live profile the booker is now. */
  id: number;
}

interface Other {
  id: number;
  first_seen: Date | string;
  names: string[] | null;
  reached: boolean;
}

/**
 * Join `profileId` with the live profiles that share its full name when a domain agrees. Never
 * throws: a booking or a form this rides on still lands.
 */
export async function linkByName(
  db: Queryable,
  profileId: number,
  source: string,
  at = new Date(),
): Promise<Linked> {
  const none = { merged: [], maybe: [], id: profileId };
  try {
    return await atomic(db, (tx) => link(tx, profileId, source, at, none));
  } catch (err) {
    console.error(`profile link ${profileId}: ${(err as Error).message}`);
    return none;
  }
}

async function link(
  db: Queryable,
  profileId: number,
  source: string,
  at: Date,
  none: Linked,
): Promise<Linked> {
  const [me] = (await db.execute(sql`
    select p.id, p.name, p.first_seen,
      array(select split_part(k.value, '@', 2) from profile_keys k
        where k.profile_id = p.id and k.kind = 'email') domains
    from profiles p where p.id = ${profileId} and p.merged_into is null`)) as unknown as {
    id: number;
    name: string | null;
    first_seen: Date | string;
    domains: string[];
  }[];
  const key = nameKey(me?.name);
  if (!me || !key) return none;
  const mine = new Set(me.domains.map(domainName).filter((d): d is string => d !== null));
  const others = (await db.execute(sql`
    select p.id, p.first_seen,
      array(
        select split_part(k.value, '@', 2) from profile_keys k
          where k.profile_id = p.id and k.kind = 'email'
        union
        select c.domain from profile_keys k
          join people pe on k.kind = 'person' and pe.id::text = k.value
          join companies c on c.id = pe.company_id
          where k.profile_id = p.id and c.domain is not null
        union
        select c.domain from profile_keys k
          join reach_contacts rc on k.kind = 'handle:' || rc.platform and rc.handle = k.value
          join companies c on c.id = rc.company_id
          where k.profile_id = p.id and c.domain is not null
      ) names,
      exists (
        select 1 from profile_keys k
          join social_handles h on k.kind = 'handle:' || h.platform and h.handle = k.value
          join touches t on t.handle_id = h.id and t.direction = 'ours'
          where k.profile_id = p.id
      ) or exists (
        select 1 from profile_keys k join enrollments e on lower(e.to_email) = k.value
          where k.profile_id = p.id and k.kind = 'email'
      ) reached
    from profiles p
    where p.merged_into is null and p.id <> ${profileId}
      and lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) = ${key}`)) as unknown as Other[];
  if (!others.length) return none;
  const agree = (o: Other) =>
    mine.size > 0 && (o.names ?? []).some((d) => mine.has(domainName(d) ?? ""));
  const same = others.filter(agree);
  // One person: the oldest profile keeps the id, as `resolveProfile` merges.
  const all = [{ id: me.id, first_seen: me.first_seen }, ...same].sort(
    (a, b) => new Date(a.first_seen).getTime() - new Date(b.first_seen).getTime() || a.id - b.id,
  );
  const into = (all[0] as { id: number }).id;
  const merged: number[] = [];
  for (const p of all.slice(1)) {
    await mergeProfiles(db, into, p.id, `name and domain: ${key}`, source, at);
    merged.push(p.id);
  }
  // Same name, no domain to agree, and we reached them: a person judges.
  const maybe = others.filter((o) => !agree(o) && o.reached).map((o) => o.id);
  for (const id of maybe)
    await db
      .insert(profileEvents)
      .values({
        profileId: into,
        kind: "merge",
        channel: "profile",
        at,
        summary: `May be the same person as profile #${id}, whom we reached: same name, nothing else agrees`,
        link: `/people/people/${id}`,
        source: "profile_link",
        sourceId: `${into}:${id}`,
      })
      .onConflictDoNothing();
  return { merged, maybe, id: into };
}

/** Every booker's profile through `linkByName`: the backfill for bookings made before it. */
export async function linkBookers(db: Queryable, at = new Date()): Promise<Linked[]> {
  const ids = (await db.execute(sql`
    select distinct k.profile_id id from profile_keys k
    join profiles p on p.id = k.profile_id and p.merged_into is null
    where k.kind = 'email' and k.source in ('booking', 'call_booking')`)) as unknown as {
    id: number;
  }[];
  const out: Linked[] = [];
  for (const { id } of ids) {
    const got = await linkByName(db, id, "booking_link", at);
    if (got.merged.length || got.maybe.length) out.push(got);
  }
  return out;
}

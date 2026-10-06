/**
 * People on a platform. `addProspects` keeps what a search found (a row per
 * handle, never a duplicate); `enrichContact` reads their page once and
 * stores it; `fieldsFor` is what a template fills in for them.
 */

import { linkPeople } from "@wren/core/leads";
import {
  HANDLE_RE,
  handleOf,
  type OutreachChannel,
  type Profile,
  type Prospect,
} from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ReachRefusal } from "./refusal.js";
import { type ContactState, type Platform, type ReachContact, reachContacts } from "./schema.js";
import { firstName, type RenderFields } from "./sequences.js";

export interface AddStats {
  added: number;
  known: number;
}

export async function addProspects(
  db: Queryable,
  platform: Platform,
  prospects: readonly Prospect[],
  o: { niche?: string | null } = {},
): Promise<AddStats> {
  const rows = prospects
    .map((p) => ({ ...p, handle: handleOf(platform, p.handle) }))
    .filter((p) => HANDLE_RE[platform].test(p.handle));
  if (rows.length === 0) return { added: 0, known: 0 };
  const inserted = await db
    .insert(reachContacts)
    .values(
      rows.map((p) => ({
        platform,
        handle: p.handle,
        url: p.url,
        name: p.name,
        headline: p.headline,
        foundIn: p.foundIn.slice(0, 200),
        niche: o.niche ?? null,
      })),
    )
    .onConflictDoNothing({ target: [reachContacts.platform, reachContacts.handle] })
    .returning({ id: reachContacts.id });
  await linkPeople(
    db,
    "reach_contacts",
    inserted.map((r) => r.id),
  );
  return { added: inserted.length, known: rows.length - inserted.length };
}

/** One person by hand (a URL or a handle). */
export async function addContact(
  db: Queryable,
  req: { platform: Platform; handle: string; name?: string | null; niche?: string | null },
): Promise<ReachContact> {
  const handle = handleOf(req.platform, req.handle);
  if (!HANDLE_RE[req.platform].test(handle))
    throw new ReachRefusal(`not a ${req.platform} handle: ${req.handle}`);
  const url =
    req.platform === "reddit"
      ? `https://www.reddit.com/user/${handle}`
      : `https://www.linkedin.com/in/${handle}/`;
  await addProspects(
    db,
    req.platform,
    [{ handle, url, name: req.name ?? null, headline: null, foundIn: "manual" }],
    { niche: req.niche ?? null },
  );
  return contactByHandle(db, req.platform, handle);
}

export async function contactByHandle(
  db: Queryable,
  platform: Platform,
  handle: string,
): Promise<ReachContact> {
  const [row] = await db
    .select()
    .from(reachContacts)
    .where(and(eq(reachContacts.platform, platform), eq(reachContacts.handle, handle)));
  if (!row) throw new ReachRefusal(`no ${platform} contact ${handle}`);
  return row;
}

export async function contactById(db: Queryable, id: number): Promise<ReachContact> {
  const [row] = await db.select().from(reachContacts).where(eq(reachContacts.id, id));
  if (!row) throw new ReachRefusal(`no contact ${id}`);
  return row;
}

export async function listContacts(
  db: Queryable,
  f: { platform?: Platform | null; state?: ContactState | null; limit?: number } = {},
): Promise<ReachContact[]> {
  return db
    .select()
    .from(reachContacts)
    .where(
      and(
        f.platform ? eq(reachContacts.platform, f.platform) : undefined,
        f.state ? eq(reachContacts.state, f.state) : undefined,
      ),
    )
    .orderBy(desc(reachContacts.createdAt))
    .limit(Math.min(Math.max(f.limit ?? 50, 1), 500));
}

/** Read the page once and keep it; name and headline are updated from it. */
export async function enrichContact(
  db: Queryable,
  contact: ReachContact,
  channel: OutreachChannel,
  now: Date,
): Promise<Profile> {
  const profile = await channel.enrich(contact.handle);
  await db
    .update(reachContacts)
    .set({
      profile,
      enrichedAt: now,
      name: profile.name ?? contact.name,
      headline: profile.headline ?? profile.current ?? contact.headline,
      ...(profile.url ? { url: profile.url } : {}),
    })
    .where(eq(reachContacts.id, contact.id));
  return profile;
}

export const profileOf = (c: ReachContact): Profile | null => (c.profile as Profile | null) ?? null;

/** What a template fills in for this person. */
export function fieldsFor(contact: ReachContact, sender: string): RenderFields {
  const p = profileOf(contact);
  return {
    first_name: firstName(contact.name ?? p?.name),
    company: p?.company ?? null,
    headline: contact.headline ?? p?.headline ?? p?.current ?? null,
    found_in: contact.foundIn === "manual" || contact.foundIn === "enrich" ? null : contact.foundIn,
    sender,
  };
}

export async function setContactState(
  db: Queryable,
  id: number,
  state: ContactState,
  o: { reason?: string | null; now: Date; ended?: boolean },
): Promise<void> {
  await db
    .update(reachContacts)
    .set({
      state,
      stateReason: o.reason ?? null,
      ...((o.ended ?? !["new", "enrolled", "connected"].includes(state)) ? { endedAt: o.now } : {}),
    })
    .where(eq(reachContacts.id, id));
}

export async function contactsById(
  db: Queryable,
  ids: readonly number[],
): Promise<Map<number, ReachContact>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(reachContacts)
    .where(inArray(reachContacts.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r]));
}

/** How many contacts each account carries: enroll gives the next one to the lightest. */
export async function loadByAccount(
  db: Queryable,
  platform: Platform,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ accountId: reachContacts.accountId, n: sql<number>`count(*)::int` })
    .from(reachContacts)
    .where(
      and(
        eq(reachContacts.platform, platform),
        inArray(reachContacts.state, ["enrolled", "connected"]),
      ),
    )
    .groupBy(reachContacts.accountId);
  return new Map(rows.filter((r) => r.accountId).map((r) => [r.accountId as string, r.n]));
}

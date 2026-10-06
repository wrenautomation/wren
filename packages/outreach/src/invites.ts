/**
 * LinkedIn invites from our own people (designs/2026-10-06-linkedin-invites.md). `topUp` adds
 * people with a LinkedIn page as contacts and enrolls them in `linkedin-invite` until tomorrow's
 * invites are queued; the tick sends them (live gate, window, ramp, autobrowse's cap). `sweep`
 * finds accepts in one read of recent connections and withdraws invites still pending after
 * `withdrawAfterDays`. The sender is the settings' `account`; empty = nothing tops up.
 */
import { settingsFor } from "@wren/core/clients";
import type { OutreachChannel, Relationship } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { healthOf } from "./accounts.js";
import { addProspects, setContactState } from "./contacts.js";
import { enroll } from "./enroll.js";
import { type ReachPolicy, standingOf } from "./policy.js";
import { type ReachAccount, reachContacts, reachMessages } from "./schema.js";
import type { ReachSequence } from "./sequences.js";
import type { Journal } from "./tick.js";

export const INVITES_COMPONENT = "linkedin.invites";
export const INVITE_SEQUENCE = "linkedin-invite";
const DAY_MS = 86_400_000;
/** autobrowse caps withdraws at 20 a day; four sweeps a day take 5 each. */
const WITHDRAWS_PER_SWEEP = 5;
/** Titles that decide, invited first. */
const SENIOR =
  "(founder|owner|ceo|chief|president|partner|principal|director|head of|vp|vice president)";
const VANITY = sql`lower(substring(p.linkedin_url from 'linkedin\\.com/in/([^/?#]+)'))`;

export const invitesSettingsSchema = z
  .object({
    /** The autobrowse credential that sends (`linkedin@wren`); empty = off. */
    account: z.string().trim().default(""),
    /** Invites a day at most; the account's ramp may allow fewer. */
    perDay: z.number().int().min(0).max(20).default(20),
    /** Niches to invite from; empty = every niche not held. */
    niches: z.array(z.string().trim().min(1)).default([]),
    /** Words a title must hold (`founder`, `owner`); empty = any title. */
    titles: z.array(z.string().trim().min(1)).default([]),
    withdrawAfterDays: z.number().int().min(7).max(90).default(21),
  })
  .strict();
export type InviteSettings = z.infer<typeof invitesSettingsSchema>;

/** Wren's invite settings (Shop → LinkedIn invites); a bad block reads as the defaults. */
export async function inviteSettings(db: Queryable): Promise<InviteSettings> {
  const p = invitesSettingsSchema.safeParse((await settingsFor(db, null))[INVITES_COMPONENT] ?? {});
  return p.success ? p.data : invitesSettingsSchema.parse({});
}

const any = (vals: readonly string[]) =>
  sql`(${sql.join(
    vals.map((v) => sql`${v}`),
    sql`, `,
  )})`;
const wordsRe = (words: readonly string[]) =>
  `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;

export interface InviteTarget {
  personId: number;
  vanity: string;
  name: string;
  title: string | null;
  niche: string | null;
}

/**
 * People with a LinkedIn page we haven't invited: in the settings' niches and titles, no held
 * niche, no declined firm. Senior titles first; one a channel held last time goes last.
 */
export async function peopleForInvites(
  db: Queryable,
  s: Pick<InviteSettings, "niches" | "titles">,
  held: readonly string[],
  limit: number,
): Promise<InviteTarget[]> {
  if (limit <= 0) return [];
  const rows = (await db.execute(sql`
    SELECT p.id person_id, ${VANITY} vanity, p.full_name name, p.title, co.niche
    FROM people p
    JOIN companies co ON co.id = p.company_id
    LEFT JOIN reach_contacts rc ON rc.platform = 'linkedin' AND lower(rc.handle) = ${VANITY}
    WHERE p.linkedin_url ~* 'linkedin\\.com/in/[^/?#]+'
      AND co.decline_reason IS NULL
      AND (rc.id IS NULL OR rc.state = 'new')
      AND NOT EXISTS (SELECT 1 FROM reach_contacts x
        WHERE x.platform = 'linkedin' AND x.person_id = p.id AND x.state <> 'new')
      ${s.niches.length ? sql`AND co.niche IN ${any(s.niches)}` : sql``}
      ${held.length ? sql`AND (co.niche IS NULL OR co.niche NOT IN ${any(held)})` : sql``}
      ${s.titles.length ? sql`AND p.title ~* ${wordsRe(s.titles)}` : sql``}
    ORDER BY rc.state_reason IS NOT NULL, coalesce(p.title ~* ${SENIOR}, false) DESC, p.id
    LIMIT ${limit}`)) as unknown as Array<{
    person_id: number;
    vanity: string;
    name: string;
    title: string | null;
    niche: string | null;
  }>;
  return rows.map((r) => ({
    personId: r.person_id,
    vanity: r.vanity,
    name: r.name,
    title: r.title,
    niche: r.niche,
  }));
}

export interface TopUpStats {
  /** Invites tomorrow may send: the settings' cap under the account's ramp. */
  target: number;
  queued: number;
  added: number;
  enrolled: number;
  leadBusy: number;
}

/** Queue invites from `account` until tomorrow's are waiting. */
export async function topUp(
  db: Queryable,
  o: {
    settings: InviteSettings;
    account: ReachAccount;
    policy: ReachPolicy;
    sequences: ReadonlyMap<string, ReachSequence>;
    sender: string;
    held: readonly string[];
    now: Date;
    runId?: string | null;
  },
): Promise<TopUpStats> {
  const seq = o.sequences.get(INVITE_SEQUENCE);
  const standing = standingOf(
    { platform: "linkedin", startedOn: o.account.startedOn, health: healthOf(o.account) },
    o.policy,
    new Date(o.now.getTime() + DAY_MS),
  );
  const target = Math.min(o.settings.perDay, standing.caps.connects);
  const [q] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.accountId, o.account.id),
        eq(reachMessages.kind, "connect"),
        eq(reachMessages.state, "queued"),
      ),
    );
  const queued = q?.n ?? 0;
  const need = target - queued;
  const stats = { target, queued, added: 0, enrolled: 0, leadBusy: 0 };
  if (!seq || need <= 0 || standing.frozen) return stats;
  // Three for each slot: a lead another channel holds stays `new` and is tried again later.
  const people = await peopleForInvites(db, o.settings, o.held, need * 3);
  if (people.length === 0) return stats;
  for (const niche of new Set(people.map((p) => p.niche))) {
    const r = await addProspects(
      db,
      "linkedin",
      people
        .filter((p) => p.niche === niche)
        .map((p) => ({
          handle: p.vanity,
          url: `https://www.linkedin.com/in/${p.vanity}/`,
          name: p.name,
          headline: p.title,
          foundIn: "people",
        })),
      { niche },
    );
    stats.added += r.added;
  }
  const contacts = await db
    .select({ id: reachContacts.id })
    .from(reachContacts)
    .where(
      and(
        eq(reachContacts.platform, "linkedin"),
        eq(reachContacts.state, "new"),
        inArray(
          sql`lower(${reachContacts.handle})`,
          people.map((p) => p.vanity),
        ),
      ),
    );
  const e = await enroll(db, {
    sequence: seq,
    sender: o.sender,
    contactIds: contacts.map((c) => c.id),
    limit: contacts.length,
    take: need,
    account: o.account.account,
    now: o.now,
    runId: o.runId ?? null,
  });
  return { ...stats, enrolled: e.enrolled, leadBusy: e.leadBusy };
}

/** Invited contacts of `account` now among its connections: `connected`. Returns their ids. */
export async function markAccepted(
  db: Queryable,
  accountId: string,
  handles: readonly string[],
  now: Date,
): Promise<number[]> {
  if (handles.length === 0) return [];
  const rows = await db
    .update(reachContacts)
    .set({ state: "connected", connectedAt: now, stateReason: null, endedAt: null })
    .where(
      and(
        eq(reachContacts.platform, "linkedin"),
        eq(reachContacts.accountId, accountId),
        inArray(reachContacts.state, ["enrolled", "unreachable"]),
        isNull(reachContacts.connectedAt),
        isNull(reachContacts.withdrawnAt),
        inArray(
          sql`lower(${reachContacts.handle})`,
          handles.map((h) => h.toLowerCase()),
        ),
      ),
    )
    .returning({ id: reachContacts.id });
  return rows.map((r) => r.id);
}

/** Invites from `account` still pending after `days`, oldest first. */
export async function staleInvites(
  db: Queryable,
  accountId: string,
  days: number,
  now: Date,
  limit = WITHDRAWS_PER_SWEEP,
): Promise<Array<{ contactId: number; handle: string }>> {
  const rows = (await db.execute(sql`
    SELECT contact_id, handle FROM reach_invites
    WHERE account_id = ${accountId} AND status = 'pending'
      AND sent_at < ${new Date(now.getTime() - days * DAY_MS).toISOString()}
    ORDER BY sent_at LIMIT ${limit}`)) as unknown as Array<{ contact_id: number; handle: string }>;
  return rows.map((r) => ({ contactId: r.contact_id, handle: r.handle }));
}

export type WithdrawOutcome = "withdrawn" | "accepted" | "gone" | "unknown";

/** What a withdraw read means for the contact. */
export async function applyWithdraw(
  db: Queryable,
  contactId: number,
  r: { withdrawn: boolean; relationship: Relationship },
  days: number,
  now: Date,
): Promise<WithdrawOutcome> {
  if (r.withdrawn) {
    await db.update(reachContacts).set({ withdrawnAt: now }).where(eq(reachContacts.id, contactId));
    await setContactState(db, contactId, "unreachable", {
      reason: `invite withdrawn after ${days} days`,
      now,
    });
    return "withdrawn";
  }
  if (r.relationship === "connected") {
    await db
      .update(reachContacts)
      .set({ state: "connected", connectedAt: now, stateReason: null })
      .where(eq(reachContacts.id, contactId));
    return "accepted";
  }
  if (r.relationship === "none") {
    await setContactState(db, contactId, "unreachable", {
      reason: "invite no longer pending: declined, or withdrawn by hand",
      now,
    });
    return "gone";
  }
  return "unknown";
}

export interface SweepStats {
  accepted: number[];
  withdrawn: number;
  gone: number;
  errors: string[];
}

/**
 * One account's invites: accepts from its recent connections, then the oldest stale invites
 * withdrawn. Platform calls sit between journaled database steps.
 */
export async function sweepInvites(
  db: Queryable,
  ch: OutreachChannel,
  account: ReachAccount,
  s: InviteSettings,
  now: Date,
  run: Journal = (_n, fn) => fn(),
): Promise<SweepStats> {
  const stats: SweepStats = { accepted: [], withdrawn: 0, gone: 0, errors: [] };
  if (!ch.connections || !ch.withdraw) return stats;
  const handles = await ch.connections();
  stats.accepted = await run(`accepted ${account.account}`, () =>
    markAccepted(db, account.id, handles, now),
  );
  const stale = await run(`stale ${account.account}`, () =>
    staleInvites(db, account.id, s.withdrawAfterDays, now),
  );
  for (const inv of stale) {
    try {
      const r = await ch.withdraw(inv.handle);
      const out = await run(`withdraw ${inv.contactId}`, () =>
        applyWithdraw(db, inv.contactId, r, s.withdrawAfterDays, now),
      );
      if (out === "withdrawn") stats.withdrawn++;
      else if (out === "accepted") stats.accepted.push(inv.contactId);
      else if (out === "gone") stats.gone++;
    } catch (err) {
      stats.errors.push(`${inv.handle}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

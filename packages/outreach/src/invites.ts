/**
 * LinkedIn invites from our own people (designs/2026-10-06-linkedin-invites.md,
 * designs/2026-10-07-posting-flow.md). `topUp` picks the day's best people (engaged with us first,
 * then decision-makers at the biggest firms), adds them as contacts with one line on why, and
 * proposes their invites: `proposed` rows wait in To approve and only his yes (`approveInvites`)
 * makes them `queued` for the tick (live gate, window, ramp, autobrowse's cap). `sweep` finds
 * accepts in one read of recent connections and withdraws invites still pending after
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
import { type InviteFit, type ReachAccount, reachContacts, reachMessages } from "./schema.js";
import type { ReachSequence } from "./sequences.js";
import type { Journal } from "./tick.js";
import { keepTouch, touchInvites } from "./touches.js";

export const INVITES_COMPONENT = "linkedin.invites";
export const INVITE_SEQUENCE = "linkedin-invite";
const DAY_MS = 86_400_000;
/** autobrowse caps withdraws at 20 a day; four sweeps a day take 5 each. */
const WITHDRAWS_PER_SWEEP = 5;
/** Titles that decide. Tier 1 owns the firm or runs it; tier 2 runs a part of it. */
const TIER1 =
  "\\y(founder|co-founder|owner|co-owner|ceo|cfo|coo|cto|cmo|cro|chief|(?<!vice )president|partner|principal|managing director|managing member)\\y";
const TIER2 = "\\y(vp|vice president|head of|director|general manager)\\y";
/** What `decisionMakers` keeps: either tier. */
const DECIDES = `(${TIER1}|${TIER2})`;
export const VANITY = sql`lower(substring(p.linkedin_url from 'linkedin\\.com/in/([^/?#]+)'))`;

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
    /** Only founders, owners, C-level, partners, VPs, heads and directors. */
    decisionMakers: z.boolean().default(true),
    /** Firms with at least this many people; 0 = any size. An unknown size passes unless `knownSizeOnly`. */
    minEmployees: z.number().int().min(0).default(0),
    /** Leave out firms whose size we don't know. */
    knownSizeOnly: z.boolean().default(false),
    /** People who reacted, mentioned or followed us on LinkedIn go first, past the title and size filters. */
    engaged: z.boolean().default(true),
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
  /** Null: someone who engaged with us and isn't in People. */
  personId: number | null;
  vanity: string;
  name: string;
  title: string | null;
  niche: string | null;
  company: string | null;
  employees: number | null;
  size: string | null;
  engaged: string | null;
  /** 1 owns or runs the firm, 2 runs a part, 3 anyone else. */
  tier: 1 | 2 | 3;
}

/** The largest number in a size string: "11-50" = 50, "1,000 - 9,999" = 9999, "12" = 12. */
const topOf = (expr: ReturnType<typeof sql>) =>
  sql`(SELECT max(nullif(regexp_replace(m[1], ',', '', 'g'), '')::bigint)
    FROM regexp_matches(${expr}, '([0-9][0-9,]*)', 'g') m)`;

/**
 * A firm's size from what we hold, best source first: an agency listing's team size, the SEC
 * ADV's employees (5A), PPP's jobs reported (recruiting), then the LinkedIn company page as Exa's
 * cache read it (`findings` kind profile). None: Exa's company read or autobrowse's company page
 * would fill it; nothing here buys it.
 */
const SIZE = sql`LEFT JOIN LATERAL (
    SELECT x.n, x.label FROM (
      SELECT ${topOf(sql`co.raw->>'agency.team_size'`)} n, co.raw->>'agency.team_size' label, 1 o
      UNION ALL
      SELECT nullif(regexp_replace(split_part(co.raw->>'5A', '.', 1), '[^0-9]', '', 'g'), '')::bigint,
        nullif(regexp_replace(split_part(co.raw->>'5A', '.', 1), '[^0-9]', '', 'g'), ''), 2
      UNION ALL
      SELECT nullif(round((e.output->>'jobs_reported')::numeric), 0)::bigint,
        round((e.output->>'jobs_reported')::numeric)::text, 3
      FROM enrichments e
      WHERE e.company_id = co.id AND e.kind = 'firmographics' AND e.model = 'ppp-foia'
      UNION ALL
      SELECT ${topOf(sql`f.value->>'employees'`)}, f.value->>'employees', 4
      FROM findings f
      WHERE f.company_id = co.id AND f.kind = 'profile' AND f.value ? 'employees'
    ) x WHERE x.n IS NOT NULL ORDER BY x.o LIMIT 1
  ) sz ON true`;

/** LinkedIn people who reacted, mentioned or followed us, by page, newest touch first. */
const ENGAGED = sql`SELECT lower(substring(a.actor_url from 'linkedin\\.com/in/([^/?#]+)')) vanity,
    (array_agg(a.kind ORDER BY a.at DESC))[1] kind, (array_agg(a.actor ORDER BY a.at DESC))[1] actor
  FROM social_activity a
  WHERE a.platform = 'linkedin' AND a.actor_url ~* 'linkedin\\.com/in/[^/?#]+'
    AND a.kind IN ('reaction', 'mention', 'follow')
  GROUP BY 1`;

type PickSettings = Pick<
  InviteSettings,
  "niches" | "titles" | "decisionMakers" | "minEmployees" | "knownSizeOnly" | "engaged"
>;

/**
 * People with a LinkedIn page we haven't invited: no held niche, no declined firm, in the
 * settings' niches; then, unless they engaged with us, a decision-maker title, the settings'
 * words and the size floor. Ranked: engaged first, then title tier, then firm size (largest
 * first, unknown last); one a channel held last time goes last. With `engaged` on, people who
 * engaged and aren't in People come after the engaged ones who are.
 */
export async function peopleForInvites(
  db: Queryable,
  partial: Partial<PickSettings>,
  held: readonly string[],
  limit: number,
): Promise<InviteTarget[]> {
  if (limit <= 0) return [];
  const s = { ...invitesSettingsSchema.parse({}), ...partial };
  const tier = (title: ReturnType<typeof sql>) =>
    sql`CASE WHEN ${title} ~* ${TIER1} THEN 1 WHEN ${title} ~* ${TIER2} THEN 2 ELSE 3 END`;
  const filters = [
    s.decisionMakers ? sql`p.title ~* ${DECIDES}` : null,
    s.titles.length ? sql`p.title ~* ${wordsRe(s.titles)}` : null,
    s.minEmployees > 0
      ? s.knownSizeOnly
        ? sql`sz.n >= ${s.minEmployees}`
        : sql`(sz.n IS NULL OR sz.n >= ${s.minEmployees})`
      : s.knownSizeOnly
        ? sql`sz.n IS NOT NULL`
        : null,
  ].filter((f) => f !== null);
  const fit = filters.length ? sql.join(filters, sql` AND `) : sql`true`;
  const rows = (await db.execute(sql`
    WITH eng AS (${ENGAGED})
    SELECT p.id person_id, ${VANITY} vanity, p.full_name name, p.title, co.niche, co.name company,
      sz.n employees, sz.label size, eng.kind engaged, ${tier(sql`p.title`)} tier,
      rc.state_reason IS NOT NULL held_before
    FROM people p
    JOIN companies co ON co.id = p.company_id
    LEFT JOIN reach_contacts rc ON rc.platform = 'linkedin' AND lower(rc.handle) = ${VANITY}
    LEFT JOIN eng ON ${s.engaged ? sql`eng.vanity = ${VANITY}` : sql`false`}
    ${SIZE}
    WHERE p.linkedin_url ~* 'linkedin\\.com/in/[^/?#]+'
      AND co.decline_reason IS NULL
      AND (rc.id IS NULL OR rc.state = 'new')
      AND NOT EXISTS (SELECT 1 FROM reach_contacts x
        WHERE x.platform = 'linkedin' AND x.person_id = p.id AND x.state <> 'new')
      ${s.niches.length ? sql`AND co.niche IN ${any(s.niches)}` : sql``}
      ${held.length ? sql`AND (co.niche IS NULL OR co.niche NOT IN ${any(held)})` : sql``}
      AND (eng.vanity IS NOT NULL OR (${fit}))
    ORDER BY rc.state_reason IS NOT NULL, eng.vanity IS NULL, tier, sz.n IS NULL, sz.n DESC, p.id
    LIMIT ${limit}`)) as unknown as Row[];
  // Engaged, not in People: no title or firm to filter on, and no niche to hold.
  const outsiders =
    s.engaged && !s.niches.length
      ? ((await db.execute(sql`
    WITH eng AS (${ENGAGED})
    SELECT NULL::int person_id, eng.vanity, coalesce(eng.actor, eng.vanity) name, NULL title,
      NULL niche, NULL company, NULL::bigint employees, NULL size, eng.kind engaged, 3 tier,
      rc.state_reason IS NOT NULL held_before
    FROM eng
    LEFT JOIN reach_contacts rc ON rc.platform = 'linkedin' AND lower(rc.handle) = eng.vanity
    WHERE (rc.id IS NULL OR rc.state = 'new')
      AND NOT EXISTS (SELECT 1 FROM people p WHERE p.linkedin_url ~* 'linkedin\\.com/in/[^/?#]+'
        AND ${VANITY} = eng.vanity)
    ORDER BY rc.state_reason IS NOT NULL, eng.vanity
    LIMIT ${limit}`)) as unknown as Row[])
      : [];
  const known = rows.map(targetOf);
  const engaged = known.filter((t) => t.engaged);
  return [...engaged, ...outsiders.map(targetOf), ...known.filter((t) => !t.engaged)].slice(
    0,
    limit,
  );
}

interface Row {
  person_id: number | null;
  vanity: string;
  name: string;
  title: string | null;
  niche: string | null;
  company: string | null;
  employees: number | string | null;
  size: string | null;
  engaged: string | null;
  tier: number;
}
const targetOf = (r: Row): InviteTarget => ({
  personId: r.person_id,
  vanity: r.vanity,
  name: r.name,
  title: r.title,
  niche: r.niche,
  company: r.company,
  employees: r.employees === null ? null : Number(r.employees),
  size: r.size,
  engaged: r.engaged,
  tier: (r.tier === 1 || r.tier === 2 ? r.tier : 3) as 1 | 2 | 3,
});

const ENGAGED_SAYS: Record<string, string> = {
  reaction: "Reacted to our post.",
  mention: "Mentioned us.",
  follow: "Follows us.",
};

/** The one line To approve shows: "Founder at Acme, 51-200 people. Reacted to our post." */
export function whyOf(t: InviteTarget): InviteFit {
  const people = t.size ? `${t.size.replace(/\s*-\s*/g, "-")} people` : null;
  const role = t.title && t.company ? `${t.title} at ${t.company}` : (t.title ?? t.company);
  const first = [role, people].filter(Boolean).join(", ");
  const why = [first ? `${first}.` : "", t.engaged ? (ENGAGED_SAYS[t.engaged] ?? "") : ""]
    .filter(Boolean)
    .join(" ");
  return {
    why: why || "In People with a LinkedIn page.",
    title: t.title,
    company: t.company,
    employees: t.employees,
    size: t.size,
    engaged: t.engaged,
  };
}

export interface TopUpStats {
  /** Invites tomorrow may send: the settings' cap under the account's ramp. */
  target: number;
  /** Approved and waiting to send, plus proposed and waiting on his yes. */
  queued: number;
  added: number;
  enrolled: number;
  leadBusy: number;
}

/** Propose invites from `account` until tomorrow's are waiting (approved or proposed). */
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
        inArray(reachMessages.state, ["queued", "proposed"]),
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
    .select({ id: reachContacts.id, handle: reachContacts.handle })
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
  const idOf = new Map(contacts.map((c) => [c.handle.toLowerCase(), c.id]));
  const ranked: number[] = [];
  for (const p of people) {
    const id = idOf.get(p.vanity);
    if (id === undefined) continue;
    ranked.push(id);
    await db
      .update(reachContacts)
      .set({ fit: whyOf(p) })
      .where(eq(reachContacts.id, id));
  }
  // Proposed, not queued: each waits in To approve for his yes.
  const e = await enroll(db, {
    sequence: seq,
    sender: o.sender,
    contactIds: ranked,
    ordered: true,
    first: "proposed",
    limit: ranked.length,
    take: need,
    account: o.account.account,
    now: o.now,
    runId: o.runId ?? null,
  });
  return { ...stats, enrolled: e.enrolled, leadBusy: e.leadBusy };
}

/** One invite waiting on his yes, as the CLI lists it; `id` is the contact's. */
export interface ProposedInvite {
  id: number;
  handle: string;
  name: string | null;
  fit: InviteFit | null;
  at: Date;
}

/** Invites waiting on his yes, oldest first. */
export async function proposedInvites(db: Queryable, limit = 100): Promise<ProposedInvite[]> {
  const rows = await db
    .select({
      id: reachMessages.contactId,
      handle: reachContacts.handle,
      name: reachContacts.name,
      fit: reachContacts.fit,
      at: reachMessages.createdAt,
    })
    .from(reachMessages)
    .innerJoin(reachContacts, eq(reachContacts.id, reachMessages.contactId))
    .where(and(eq(reachMessages.kind, "connect"), eq(reachMessages.state, "proposed")))
    .orderBy(reachMessages.id)
    .limit(limit);
  return rows;
}

/**
 * His yes, by contact: their proposed invite becomes `queued`; the tick sends it under the day's
 * cap and ramp. A contact with no proposed invite is left alone. Returns the contacts approved.
 */
export async function approveInvites(
  db: Queryable,
  contactIds: readonly number[],
  now: Date,
): Promise<number[]> {
  if (contactIds.length === 0) return [];
  const rows = await db
    .update(reachMessages)
    .set({ state: "queued", dueAt: now, stateReason: null })
    .where(
      and(
        inArray(reachMessages.contactId, [...contactIds]),
        eq(reachMessages.kind, "connect"),
        eq(reachMessages.state, "proposed"),
      ),
    )
    .returning({ contactId: reachMessages.contactId });
  return rows.map((r) => r.contactId);
}

/** His no, by contact: the invite is skipped and the contact finished, never proposed again. */
export async function skipInvites(
  db: Queryable,
  contactIds: readonly number[],
  now: Date,
): Promise<number[]> {
  if (contactIds.length === 0) return [];
  const reason = "skipped in To approve";
  const rows = await db
    .update(reachMessages)
    .set({ state: "skipped", stateReason: reason })
    .where(
      and(
        inArray(reachMessages.contactId, [...contactIds]),
        eq(reachMessages.kind, "connect"),
        eq(reachMessages.state, "proposed"),
      ),
    )
    .returning({ contactId: reachMessages.contactId });
  for (const r of rows) await setContactState(db, r.contactId, "finished", { reason, now });
  return rows.map((r) => r.contactId);
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
  const ids = rows.map((r) => r.id);
  await keepTouch("accepted", () => touchInvites(db, ids, "accepted", now));
  return ids;
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
    await keepTouch("withdrawn", () => touchInvites(db, [contactId], "ignored", now));
    return "withdrawn";
  }
  if (r.relationship === "connected") {
    await db
      .update(reachContacts)
      .set({ state: "connected", connectedAt: now, stateReason: null })
      .where(eq(reachContacts.id, contactId));
    await keepTouch("accepted", () => touchInvites(db, [contactId], "accepted", now));
    return "accepted";
  }
  if (r.relationship === "none") {
    await setContactState(db, contactId, "unreachable", {
      reason: "invite no longer pending: declined, or withdrawn by hand",
      now,
    });
    await keepTouch("gone", () => touchInvites(db, [contactId], "ignored", now));
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

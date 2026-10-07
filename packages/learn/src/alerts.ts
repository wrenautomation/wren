/**
 * Learn's alerts, for every workspace's people (designs/2026-10-07-learn.md, "Alerts"). The
 * Monitor's pass rings the portal's bell for each person with Learn in that workspace: a followed
 * source posted (their pick "every"), a post scored 8 and up ("top"), or a saved link read and
 * scored 8 and up. Each person picks per source: every post, high score only, or off. The bell
 * rings at most `ALERTS_PER_HOUR` times an hour per person; the rest roll into their Today.
 *
 * Today is each person's daily digest: what came in over the last 24 hours, best first, with
 * scores and one line each. Mailing it to their login address is built and off: a workspace's
 * `digest_mail` starts false and only a person with manage turns it on.
 */
import { can, type RoleId, type Who, WREN } from "@wren/core/access";
import { clientMembers, clients, operators } from "@wren/core/clients";
import { grantsFor } from "@wren/core/grants";
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  ALERTS_PER_HOUR,
  type AlertPick,
  type AlertState,
  type AlertWhy,
  alertPicks,
  alerts,
  items,
  learnSettings,
  readers,
  sources,
  type Tell,
  TOP_SCORE,
  type TYPES,
} from "./schema.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The bell's list. */
const BELL_SHOWN = 20;
/** Today's list; the rest are counted. */
const TODAY_SHOWN = 40;
/** The hour a digest mail goes, the fleet's clock. */
export const DIGEST_MAIL_HOUR = 9;

/** A source's own `tell` as a person's pick when they haven't made one: digest only is off. */
export const pickOfTell = (tell: Tell): AlertPick => (tell === "digest" ? "off" : tell);

const lower = (email: string) => email.trim().toLowerCase();

/** One line of a summary: its first sentence, cut to fit a row. */
export function oneLine(text: string | null | undefined, max = 140): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const first = t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/**
 * The people who read this workspace's Learn: Wren's team seats that reach it, or the client's
 * members whose role or grants do. Lowercase emails, sorted.
 */
export async function learnPeople(db: Queryable, client: string): Promise<string[]> {
  // Wren's own Learn opens to seats that hold Wren's team, as `learnPlace` checks.
  const reaches = (who: Who) =>
    client === WREN ? can(who, "team", WREN) : can(who, "read", { client, app: "learn" });
  const out: string[] = [];
  if (client === WREN) {
    const seats = await db.select().from(operators).orderBy(asc(operators.email));
    for (const s of seats) {
      const grants = await grantsFor(db, s.email, s.role as RoleId);
      const who: Who = { team: s.role, clients: s.clients, ...(grants.length ? { grants } : {}) };
      if (reaches(who)) out.push(lower(s.email));
    }
    return out;
  }
  const members = await db
    .select({ email: clientMembers.email, role: clientMembers.role })
    .from(clientMembers)
    .innerJoin(clients, eq(clients.id, clientMembers.clientId))
    .where(and(eq(clientMembers.clientId, client), eq(clients.demo, false)))
    .orderBy(asc(clientMembers.email));
  for (const m of members) {
    const grants = await grantsFor(db, m.email, m.role, client);
    const who: Who = { member: m.role, client, ...(grants.length ? { grants } : {}) };
    if (reaches(who)) out.push(lower(m.email));
  }
  return out;
}

interface Candidate {
  id: number;
  client: string;
  sourceId: number | null;
  tell: Tell | null;
  score: number | null;
  saved: boolean;
  fresh: boolean;
  scored: boolean;
}

/** Why this person hears of this item now, or null: their pick against what happened. */
export function alertWhy(c: Candidate, pick: AlertPick): AlertWhy | null {
  if (pick === "off") return null;
  const high = c.scored && (c.score ?? 0) >= TOP_SCORE;
  if (c.saved) return high ? "saved" : null;
  if (pick === "every") return c.fresh ? "new" : null;
  return high ? "score" : null;
}

export interface AlertStats {
  bell: number;
  digest: number;
}

/**
 * One pass: every workspace's items that came in or scored in the last day, told once to each
 * person by their pick. The bell takes the best first until the person's hour is full; the rest
 * roll into Today. A backlog read at follow time is archived, so it never rings.
 */
export async function alertLearn(
  db: Db,
  now: Date,
  perHour = ALERTS_PER_HOUR,
): Promise<AlertStats> {
  const since = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select({
      id: items.id,
      client: items.client,
      sourceId: items.sourceId,
      tell: sources.tell,
      score: items.score,
      saved: sql<boolean>`${items.savedAt} is not null`,
      fresh: sql<boolean>`${items.createdAt} > ${since.toISOString()}`,
      scored: sql<boolean>`coalesce(${items.scoredAt} > ${since.toISOString()}, false)`,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        isNull(items.archivedAt),
        sql`(${items.createdAt} > ${since.toISOString()} or ${items.scoredAt} > ${since.toISOString()})`,
        sql`(${items.savedAt} is not null or (${sources.id} is not null and ${sources.stoppedAt} is null))`,
      ),
    )
    .orderBy(sql`${items.score} desc nulls last`, asc(items.id));
  const stats: AlertStats = { bell: 0, digest: 0 };
  const byClient = new Map<string, Candidate[]>();
  for (const r of rows) byClient.set(r.client, [...(byClient.get(r.client) ?? []), r]);
  for (const [client, list] of byClient) {
    const people = await learnPeople(db, client);
    if (!people.length) continue;
    const ids = list.map((c) => c.id);
    await atomic(db, async (tx) => {
      const [picks, saved, told, recent] = await Promise.all([
        tx
          .select()
          .from(alertPicks)
          .where(and(eq(alertPicks.client, client), inArray(alertPicks.email, people))),
        tx
          .select()
          .from(readers)
          .where(and(eq(readers.client, client), inArray(readers.email, people))),
        tx
          .select({ email: alerts.email, itemId: alerts.itemId })
          .from(alerts)
          .where(and(eq(alerts.client, client), inArray(alerts.itemId, ids))),
        tx
          .select({ email: alerts.email, n: sql<number>`count(*)::int` })
          .from(alerts)
          .where(
            and(
              eq(alerts.client, client),
              eq(alerts.state, "bell"),
              gt(alerts.at, new Date(now.getTime() - HOUR_MS)),
            ),
          )
          .groupBy(alerts.email),
      ]);
      const pickOf = new Map(picks.map((p) => [`${p.email}:${p.sourceId}`, p.pick]));
      const savedOf = new Map(saved.map((r) => [r.email, r.saved]));
      const done = new Set(told.map((t) => `${t.email}:${t.itemId}`));
      const rang = new Map(recent.map((r) => [r.email, Number(r.n)]));
      const rowsOut: {
        client: string;
        email: string;
        itemId: number;
        why: AlertWhy;
        state: AlertState;
        at: Date;
      }[] = [];
      for (const email of people) {
        let n = rang.get(email) ?? 0;
        for (const c of list) {
          if (done.has(`${email}:${c.id}`)) continue;
          const pick: AlertPick = c.saved
            ? (savedOf.get(email) ?? "top")
            : (pickOf.get(`${email}:${c.sourceId}`) ?? pickOfTell(c.tell ?? "top"));
          const why = alertWhy(c, pick);
          if (!why) continue;
          const state: AlertState = n < perHour ? "bell" : "digest";
          if (state === "bell") n += 1;
          rowsOut.push({ client, email, itemId: c.id, why, state, at: now });
        }
      }
      if (!rowsOut.length) return;
      const added = await tx
        .insert(alerts)
        .values(rowsOut)
        .onConflictDoNothing()
        .returning({ state: alerts.state });
      for (const a of added) stats[a.state] += 1;
    });
  }
  return stats;
}

type ItemType = (typeof TYPES)[number];

export interface BellLine {
  id: number;
  itemId: number;
  title: string;
  type: ItemType;
  source: string;
  score: number | null;
  line: string | null;
  why: AlertWhy;
  at: string;
  seen: boolean;
}

/** A person's bell in one workspace: the newest alerts that rang, and how many they haven't seen. */
export async function bellOf(
  db: Queryable,
  client: string,
  email: string,
): Promise<{ unseen: number; alerts: BellLine[] }> {
  const mine = and(
    eq(alerts.client, client),
    eq(alerts.email, lower(email)),
    eq(alerts.state, "bell"),
  );
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: alerts.id,
        itemId: items.id,
        title: items.title,
        type: items.type,
        source: sql<string>`coalesce(${sources.name}, 'Saved')`,
        score: items.score,
        summary: items.summary,
        why: alerts.why,
        at: alerts.at,
        seenAt: alerts.seenAt,
      })
      .from(alerts)
      .innerJoin(items, eq(items.id, alerts.itemId))
      .leftJoin(sources, eq(sources.id, items.sourceId))
      .where(mine)
      .orderBy(desc(alerts.at), desc(alerts.id))
      .limit(BELL_SHOWN),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(mine, isNull(alerts.seenAt))),
  ]);
  return {
    unseen: Number(count?.n ?? 0),
    alerts: rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      title: r.title,
      type: r.type,
      source: r.source,
      score: r.score,
      line: oneLine(r.summary),
      why: r.why,
      at: r.at.toISOString(),
      seen: r.seenAt !== null,
    })),
  };
}

/** They opened the bell: everything in it is seen. */
export async function bellSeen(
  db: Queryable,
  client: string,
  email: string,
  now = new Date(),
): Promise<number> {
  const rows = await db
    .update(alerts)
    .set({ seenAt: now })
    .where(and(eq(alerts.client, client), eq(alerts.email, lower(email)), isNull(alerts.seenAt)))
    .returning({ id: alerts.id });
  return rows.length;
}

export interface TodayLine {
  id: number;
  title: string;
  type: ItemType;
  url: string;
  source: string;
  score: number | null;
  line: string | null;
  /** In your bell (bell), held back for the hour's limit (digest), or not alerted (null). */
  told: AlertState | null;
  read: boolean;
  at: string;
}

/**
 * A person's Today: the last 24 hours in this workspace, best first, worth reading or not yet
 * scored (a dropped item never shows), with whether the bell rang for each or held it back.
 */
export async function todayOf(
  db: Queryable,
  client: string,
  email: string,
  now = new Date(),
): Promise<{ since: string; total: number; held: number; items: TodayLine[] }> {
  const since = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      type: items.type,
      url: items.url,
      source: sql<string>`coalesce(${sources.name}, 'Saved')`,
      score: items.score,
      summary: items.summary,
      why: items.why,
      told: alerts.state,
      read: sql<boolean>`${items.openedAt} is not null`,
      at: sql<Date>`coalesce(${items.scoredAt}, ${items.createdAt})`,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(
      alerts,
      and(eq(alerts.itemId, items.id), eq(alerts.client, client), eq(alerts.email, lower(email))),
    )
    .where(
      and(
        eq(items.client, client),
        isNull(items.archivedAt),
        sql`(${items.verdict} is null or ${items.verdict} <> 'drop')`,
        sql`(${items.createdAt} > ${since.toISOString()} or ${items.scoredAt} > ${since.toISOString()})`,
      ),
    )
    .orderBy(sql`${items.score} desc nulls last`, desc(items.id));
  return {
    since: since.toISOString(),
    total: rows.length,
    held: rows.filter((r) => r.told === "digest").length,
    items: rows.slice(0, TODAY_SHOWN).map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      url: r.url,
      source: r.source,
      score: r.score,
      line: oneLine(r.summary) ?? oneLine(r.why),
      told: r.told,
      read: r.read,
      at: new Date(r.at).toISOString(),
    })),
  };
}

/** A person's picks: saved links, then each followed source with its pick and whether it's theirs. */
export async function picksOf(db: Queryable, client: string, email: string) {
  const e = lower(email);
  const [own, [reader], list] = await Promise.all([
    db
      .select()
      .from(alertPicks)
      .where(and(eq(alertPicks.client, client), eq(alertPicks.email, e))),
    db
      .select()
      .from(readers)
      .where(and(eq(readers.client, client), eq(readers.email, e))),
    db
      .select({ id: sources.id, tell: sources.tell })
      .from(sources)
      .where(and(eq(sources.client, client), isNull(sources.stoppedAt))),
  ]);
  const mine = new Map(own.map((p) => [p.sourceId, p.pick]));
  return {
    saved: (reader?.saved ?? "top") as AlertPick,
    sources: Object.fromEntries(
      list.map((s) => [s.id, mine.get(s.id) ?? pickOfTell(s.tell)]),
    ) as Record<number, AlertPick>,
  };
}

/** Set a person's pick for one of this workspace's sources, or for saved links. False: no such source. */
export async function setPick(
  db: Queryable,
  client: string,
  email: string,
  on: number | "saved",
  pick: AlertPick,
): Promise<boolean> {
  const e = lower(email);
  if (on === "saved") {
    if (pick === "every") throw new Error("saved links alert on a high score or not at all");
    await db
      .insert(readers)
      .values({ client, email: e, saved: pick })
      .onConflictDoUpdate({ target: [readers.client, readers.email], set: { saved: pick } });
    return true;
  }
  const [src] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, on), eq(sources.client, client)));
  if (!src) return false;
  await db
    .insert(alertPicks)
    .values({ client, email: e, sourceId: on, pick })
    .onConflictDoUpdate({
      target: [alertPicks.client, alertPicks.email, alertPicks.sourceId],
      set: { pick, at: sql`now()` },
    });
  return true;
}

/** Is the digest mailed in this workspace? Off unless someone turned it on. */
export async function digestMailOn(db: Queryable, client: string): Promise<boolean> {
  const [row] = await db.select().from(learnSettings).where(eq(learnSettings.client, client));
  return row?.digestMail ?? false;
}

export async function setDigestMail(
  db: Queryable,
  client: string,
  on: boolean,
  by: string,
): Promise<void> {
  await db
    .insert(learnSettings)
    .values({ client, digestMail: on, by: lower(by) })
    .onConflictDoUpdate({
      target: learnSettings.client,
      set: { digestMail: on, by: lower(by), at: sql`now()` },
    });
}

export interface DigestMail {
  to: string;
  subject: string;
  text: string;
}

/** The digest as a mail's words: one block per item, best first, and where to change it. */
export function digestText(
  t: Awaited<ReturnType<typeof todayOf>>,
  links: { today: string; settings: string },
): string {
  const lines = t.items.map(
    (i) => `${i.score ?? "-"}/10 ${i.title} (${i.source})${i.line ? `\n${i.line}` : ""}\n${i.url}`,
  );
  const more = t.total > t.items.length ? [`and ${t.total - t.items.length} more`] : [];
  return [
    ...lines,
    ...more,
    `All of today: ${links.today}`,
    `Stop this mail: ${links.settings}`,
  ].join("\n\n");
}

/**
 * Mail each person their digest, once a day from `DIGEST_MAIL_HOUR`, in each workspace that
 * turned it on. A day with nothing new sends nothing. A failed send is tried next pass.
 */
export async function mailLearnDigests(
  db: Db,
  send: (m: DigestMail) => Promise<void>,
  p: { now: Date; today: string; hour: number; portal: string | null },
): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (p.hour < DIGEST_MAIL_HOUR) return out;
  const on = await db
    .select({ client: learnSettings.client })
    .from(learnSettings)
    .where(eq(learnSettings.digestMail, true))
    .orderBy(asc(learnSettings.client));
  for (const { client } of on) {
    const people = await learnPeople(db, client);
    if (!people.length) continue;
    const mailed = new Map(
      (
        await db
          .select()
          .from(readers)
          .where(and(eq(readers.client, client), inArray(readers.email, people)))
      ).map((r) => [r.email, r.mailedOn]),
    );
    const q = client === WREN ? "" : `?client=${encodeURIComponent(client)}`;
    const base = p.portal ?? "";
    for (const email of people) {
      if (mailed.get(email) === p.today) continue;
      const t = await todayOf(db, client, email, p.now);
      if (t.total) {
        try {
          await send({
            to: email,
            subject: `Learn: ${t.total} new today`,
            text: digestText(t, {
              today: `${base}/learn/today${q}`,
              settings: `${base}/learn/today${q}#mail`,
            }),
          });
          out.sent += 1;
        } catch {
          out.failed += 1;
          continue;
        }
      }
      await db
        .insert(readers)
        .values({ client, email, mailedOn: p.today })
        .onConflictDoUpdate({
          target: [readers.client, readers.email],
          set: { mailedOn: p.today },
        });
    }
  }
  return out;
}

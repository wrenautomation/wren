/**
 * DeliveryWatch/fleet (D8–D10): one pass an hour over every client's work. It
 * mails each client person (D9): a welcome when they're invited, new asks and
 * deliverables, and the Friday digest with the weekly pulse (D10). And it pings
 * the operator when a client could feel forgotten (D8). The demo is never
 * watched. Mail is per person and marks itself done, so a failed send is tried
 * again next hour and a sent one never repeats.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type ClientMember, clientMembers, clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { errorText, makeLoopObject, runPass } from "@wren/core/restate";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import { offerFor } from "@wren/offers";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, max, sql } from "drizzle-orm";
import { addDays, weekday } from "./index.js";
import { PULSE_WORDS } from "./routes.js";
import {
  asks,
  deliverables,
  type Engagement,
  engagements,
  type MemberMail,
  memberMail,
  milestones,
  pings,
  pulses,
  results,
  updates,
} from "./schema.js";

export const WATCH = "DeliveryWatch";
export const WATCH_KEY = "fleet";
export const WATCH_COMMAND = "delivery watch";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** D8's thresholds. */
const QUIET_WORKDAYS = 3;
const AWAY_DAYS = 14;
const LOW_PULSE = 3;
/** A problem still standing pings again after this long. */
const REPING_DAYS = 7;
/** The digest goes Friday from this hour, fleet clock. */
const DIGEST_HOUR = 15;

export interface PortalMail {
  to: string;
  subject: string;
  text: string;
}

export interface WatchDeps {
  main: Db;
  /** Mails one client person; null = no client mail here (pings still go). */
  send: ((m: PortalMail) => Promise<void>) | null;
  /** The portal, for links: `https://app.<domain>`. */
  app: string;
  /** The fleet's clock: business days and Friday afternoon. */
  zone: string;
  notifier?: Notifier;
}

export interface WatchStats {
  welcomed: number;
  told: number;
  digests: number;
  pinged: number;
  /** Sends that failed; each is tried again next pass. */
  failed: number;
  lastError: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The calendar day `at` falls on in `zone`. */
export function dayIn(zone: string, at: Date): string {
  const w = wallClock(zone, at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Weekdays after `from` up to and including `to`, counted no higher than `enough`. */
export function workdaysAfter(from: string, to: string, enough: number): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to && n < enough; d = addDays(d, 1))
    if (weekday(d) % 6 !== 0) n += 1;
  return n;
}

const clip = (s: string, n: number) => {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.length > n ? `${line.slice(0, n - 1).trimEnd()}…` : line;
};
const money = (unit: string, v: number) =>
  unit === "usd"
    ? `$${v.toLocaleString("en-US")}`
    : unit === "hours"
      ? `${v.toLocaleString("en-US")} h`
      : v.toLocaleString("en-US");

type Live = { e: Engagement; clientName: string };
type Person = { m: ClientMember; mail: MemberMail | null; clientName: string };

/** One pass: mail, then pings. */
export async function watchPass(deps: WatchDeps, now: Date): Promise<WatchStats> {
  const { main } = deps;
  const today = dayIn(deps.zone, now);
  const stats: WatchStats = {
    welcomed: 0,
    told: 0,
    digests: 0,
    pinged: 0,
    failed: 0,
    lastError: null,
  };
  const live: Live[] = (
    await main
      .select({ e: engagements, clientName: clients.name })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(eq(engagements.status, "active"), eq(clients.demo, false)))
      .orderBy(asc(engagements.id))
  ).map((r) => ({ e: r.e, clientName: r.clientName }));
  const people: Person[] = await main
    .select({ m: clientMembers, mail: memberMail, clientName: clients.name })
    .from(clientMembers)
    .innerJoin(clients, eq(clients.id, clientMembers.clientId))
    .leftJoin(
      memberMail,
      and(
        eq(memberMail.clientId, clientMembers.clientId),
        eq(memberMail.email, clientMembers.email),
      ),
    )
    .where(eq(clients.demo, false));

  if (deps.send) await mailPeople(deps, deps.send, now, today, live, people, stats);
  await pingOperator(deps, now, today, live, people, stats);
  return stats;
}

// --- client mail (D9, D10) -----------------------------------------------------

async function mailPeople(
  deps: WatchDeps,
  send: (m: PortalMail) => Promise<void>,
  now: Date,
  today: string,
  live: Live[],
  people: Person[],
  stats: WatchStats,
): Promise<void> {
  const { main, app } = deps;
  const digestDue = weekday(today) === 5 && wallClock(deps.zone, now).hour >= DIGEST_HOUR;
  const digests = new Map<string, string | null>();
  const mark = (p: Person, set: Partial<MemberMail>) =>
    main
      .insert(memberMail)
      .values({ clientId: p.m.clientId, email: p.m.email, ...set })
      .onConflictDoUpdate({ target: [memberMail.clientId, memberMail.email], set });
  const trySend = async (m: PortalMail): Promise<boolean> => {
    try {
      await send(m);
      return true;
    } catch (err) {
      stats.failed += 1;
      stats.lastError = errorText(err);
      return false;
    }
  };
  const settings = (clientId: string) =>
    `Change what we email you: ${app}/work/settings?client=${clientId}`;

  for (const p of people) {
    const c = { id: p.m.clientId, name: p.clientName };
    if (!p.mail?.toldThrough) {
      const sent = await trySend({
        to: p.m.email,
        subject: `You're invited to ${c.name}'s project with Wren`,
        text: [
          `${p.m.invitedBy ?? "Wren"} added you to ${c.name}'s project with Wren.`,
          "",
          "See where things stand, what's next and what we need from you:",
          `${app}/work/home?client=${c.id}`,
          "",
          "Sign in with this email address: a code by email, Google, Microsoft or a password.",
          "",
          "Wren",
        ].join("\n"),
      });
      if (sent) {
        await mark(p, { toldThrough: now });
        stats.welcomed += 1;
      }
      continue;
    }
    const level = p.mail.level;
    const es = live.filter((l) => l.e.clientId === c.id).map((l) => l.e.id);

    // New asks and deliverables since we last told them, in one message.
    if (level === "all" && es.length > 0) {
      const since = p.mail.toldThrough;
      const [newAsks, newWork] = await Promise.all([
        main
          .select()
          .from(asks)
          .where(
            and(
              inArray(asks.engagementId, es),
              gt(asks.createdAt, since),
              lte(asks.createdAt, now),
              isNull(asks.answeredAt),
            ),
          )
          .orderBy(asc(asks.id)),
        main
          .select()
          .from(deliverables)
          .where(
            and(
              inArray(deliverables.engagementId, es),
              gt(deliverables.createdAt, since),
              lte(deliverables.createdAt, now),
              eq(deliverables.status, "waiting"),
            ),
          )
          .orderBy(asc(deliverables.id)),
      ]);
      if (newAsks.length + newWork.length > 0) {
        const lines: string[] = [];
        if (newAsks.length > 0) {
          lines.push("We need from you:");
          for (const a of newAsks)
            lines.push(`- ${clip(a.text, 200)}${a.dueOn ? ` (by ${a.dueOn})` : ""}`);
          lines.push(`Answer here: ${app}/work/needs-you?client=${c.id}`, "");
        }
        if (newWork.length > 0) {
          lines.push("Ready for you to look at:");
          for (const d of newWork)
            lines.push(`- ${clip(d.title, 200)}${d.version > 1 ? ` (version ${d.version})` : ""}`);
          lines.push(`Approve or ask for changes: ${app}/work/deliverables?client=${c.id}`, "");
        }
        lines.push(settings(c.id));
        const n = newAsks.length + newWork.length;
        const subject =
          newAsks.length > 0
            ? `${c.name}: ${n === 1 ? "1 thing needs" : `${n} things need`} you`
            : `${c.name}: ${n === 1 ? "something" : `${n} things`} ready to look at`;
        if (!(await trySend({ to: p.m.email, subject, text: lines.join("\n") }))) continue;
        stats.told += 1;
      }
    }
    await mark(p, { toldThrough: now });

    if (digestDue && level !== "off" && p.mail.digestOn !== today && es.length > 0) {
      if (!digests.has(c.id)) digests.set(c.id, await digestOf(deps, c.id, live, now, today));
      const body = digests.get(c.id);
      if (!body) continue;
      const sent = await trySend({
        to: p.m.email,
        subject: `${c.name}: your week with Wren`,
        text: `${body}\n\n${settings(c.id)}`,
      });
      if (sent) {
        await mark(p, { digestOn: today });
        stats.digests += 1;
      }
    }
  }
}

/** The Friday digest for one client: the week, what's next, what we need, results, the pulse. */
async function digestOf(
  deps: WatchDeps,
  clientId: string,
  live: Live[],
  now: Date,
  today: string,
): Promise<string | null> {
  const { main, app } = deps;
  const es = live.filter((l) => l.e.clientId === clientId).map((l) => l.e);
  if (es.length === 0) return null;
  const ids = es.map((e) => e.id);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [ups, ms, ds, as, rs] = await Promise.all([
    main
      .select()
      .from(updates)
      .where(
        and(
          inArray(updates.engagementId, ids),
          eq(updates.internal, false),
          isNull(updates.hiddenAt),
          gt(updates.createdAt, weekAgo),
        ),
      )
      .orderBy(desc(updates.createdAt)),
    main
      .select()
      .from(milestones)
      .where(inArray(milestones.engagementId, ids))
      .orderBy(asc(milestones.position)),
    main
      .select()
      .from(deliverables)
      .where(and(inArray(deliverables.engagementId, ids), gt(deliverables.createdAt, weekAgo))),
    main
      .select()
      .from(asks)
      .where(and(inArray(asks.engagementId, ids), isNull(asks.answeredAt))),
    main.select().from(results).where(inArray(results.engagementId, ids)),
  ]);
  const out: string[] = [];
  for (const e of es) {
    const offer = offerFor(e.offerId);
    if (es.length > 1) out.push(`== ${offer.name} ==`, "");
    const mine = <T extends { engagementId: number }>(rows: T[]) =>
      rows.filter((r) => r.engagementId === e.id);
    const week = [
      ...mine(ups)
        .slice(0, 5)
        .map((u) => `- ${clip(u.body, 160)}`),
      ...mine(ms)
        .filter((m) => m.doneOn && m.doneOn > addDays(today, -7))
        .map((m) => `- Done: ${m.name}`),
      ...mine(ds).map((d) => `- Delivered: ${clip(d.title, 120)}`),
    ];
    out.push("This week", ...(week.length > 0 ? week : ["- A quiet week on the page."]), "");
    const next = mine(ms).find((m) => !m.doneOn);
    if (next) out.push(`Next: ${next.name}${next.dueOn ? `, due ${next.dueOn}` : ""}.`);
    const open = mine(as);
    if (open.length > 0) {
      const late = open.filter((a) => a.dueOn && a.dueOn < today).length;
      out.push(
        `We need ${open.length} thing${open.length === 1 ? "" : "s"} from you${late ? ` (${late} overdue)` : ""}: ${app}/work/needs-you?client=${clientId}`,
      );
    }
    const figures = offer.measures.flatMap((m) => {
      const r = mine(rs).find((x) => x.key === m.key);
      return r ? [`${m.label}: ${money(m.unit, r.value)}`] : [];
    });
    if (figures.length > 0) out.push("", "Results so far", ...figures.map((f) => `- ${f}`));
    out.push(
      "",
      "How's it going? One tap:",
      ...[5, 4, 3, 2, 1].map(
        (n) => `${n} ${PULSE_WORDS[n]}: ${app}/work/home?client=${clientId}&e=${e.id}&pulse=${n}`,
      ),
      "",
    );
  }
  out.push(`The full picture: ${app}/work/home?client=${clientId}`);
  return out.join("\n");
}

// --- operator pings (D8) ---------------------------------------------------------

type Found = { engagementId: number; about: string; line: string };

async function pingOperator(
  deps: WatchDeps,
  now: Date,
  today: string,
  live: Live[],
  people: Person[],
  stats: WatchStats,
): Promise<void> {
  const { main } = deps;
  const started = live.filter((l) => l.e.startsOn <= today);
  const ids = started.map((l) => l.e.id);
  const found: Found[] = [];
  if (ids.length > 0) {
    const [lastUpdate, lastWork, late, overdue, low] = await Promise.all([
      main
        .select({ id: updates.engagementId, at: max(updates.createdAt) })
        .from(updates)
        .where(
          and(
            inArray(updates.engagementId, ids),
            eq(updates.internal, false),
            isNull(updates.hiddenAt),
          ),
        )
        .groupBy(updates.engagementId),
      main
        .select({ id: deliverables.engagementId, at: max(deliverables.createdAt) })
        .from(deliverables)
        .where(inArray(deliverables.engagementId, ids))
        .groupBy(deliverables.engagementId),
      main
        .select()
        .from(milestones)
        .where(
          and(
            inArray(milestones.engagementId, ids),
            isNull(milestones.doneOn),
            lt(milestones.dueOn, today),
          ),
        ),
      main
        .select()
        .from(asks)
        .where(
          and(inArray(asks.engagementId, ids), isNull(asks.answeredAt), lt(asks.dueOn, today)),
        ),
      main
        .select()
        .from(pulses)
        .where(
          and(
            inArray(pulses.engagementId, ids),
            lte(pulses.score, LOW_PULSE),
            gt(pulses.at, new Date(now.getTime() - 7 * DAY)),
          ),
        ),
    ]);
    for (const { e } of started) {
      const c = e.clientId;
      const at = [lastUpdate, lastWork]
        .map((rows) => rows.find((r) => r.id === e.id)?.at ?? null)
        .reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);
      const lastDay = at ? dayIn(deps.zone, at) : addDays(e.startsOn, -1);
      if (workdaysAfter(lastDay, today, QUIET_WORKDAYS) >= QUIET_WORKDAYS)
        found.push({
          engagementId: e.id,
          about: "quiet",
          line: `${c}: nothing new for the client in ${QUIET_WORKDAYS}+ business days`,
        });
      for (const m of late.filter((m) => m.engagementId === e.id))
        found.push({
          engagementId: e.id,
          about: `step:${m.key}`,
          line: `${c}: step "${m.name}" was due ${m.dueOn}`,
        });
      for (const a of overdue.filter((a) => a.engagementId === e.id))
        found.push({
          engagementId: e.id,
          about: `ask:${a.id}`,
          line: `${c}: ask #${a.id} overdue since ${a.dueOn}`,
        });
      for (const p of low.filter((p) => p.engagementId === e.id))
        found.push({
          engagementId: e.id,
          about: `pulse:${p.id}`,
          line: `${c}: pulse ${p.score}/5 this week`,
        });
      const theirs = people.filter((p) => p.m.clientId === c);
      const seen = theirs
        .map((p) => p.m.lastSeenAt ?? p.m.invitedAt)
        .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
      if (!seen)
        found.push({
          engagementId: e.id,
          about: "away",
          line: `${c}: nobody on their side can sign in`,
        });
      else if (seen.getTime() < now.getTime() - AWAY_DAYS * DAY)
        found.push({
          engagementId: e.id,
          about: "away",
          line: `${c}: no client visit in ${AWAY_DAYS}+ days`,
        });
    }
  }

  // Dedupe: a problem pings once, again after a week if it stands, and its row goes when it clears.
  const key = (r: { engagementId: number; about: string }) => `${r.engagementId} ${r.about}`;
  const known = await main.select().from(pings);
  const standing = new Set(found.map(key));
  for (const k of known.filter((k) => !standing.has(key(k))))
    await main
      .delete(pings)
      .where(and(eq(pings.engagementId, k.engagementId), eq(pings.about, k.about)));
  const pingedAt = new Map(known.map((k) => [key(k), k.pingedAt.getTime()]));
  const fresh = found.filter(
    (f) => (pingedAt.get(key(f)) ?? 0) <= now.getTime() - REPING_DAYS * DAY,
  );
  if (fresh.length === 0 || !deps.notifier) return;
  const told = await deps.notifier.notify(
    `Delivery: ${fresh.length} to look at`,
    fresh.map((f) => f.line).join("\n"),
    "warning",
  );
  if (!told) return;
  await main
    .insert(pings)
    .values(fresh.map((f) => ({ engagementId: f.engagementId, about: f.about, pingedAt: now })))
    .onConflictDoUpdate({
      target: [pings.engagementId, pings.about],
      set: { pingedAt: sql`excluded.pinged_at` },
    });
  stats.pinged = fresh.length;
}

// --- the loop --------------------------------------------------------------------

export function makeDeliveryWatch(deps: WatchDeps) {
  return makeLoopObject(WATCH, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return runPass<WatchStats>(ctx, deps.main, now, {
      name: "delivery watch",
      ledger: { command: WATCH_COMMAND, argv: { daemon: true } },
      body: () => watchPass(deps, now),
      delayAfter: () => HOUR,
      retryMs: HOUR,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
  });
}

export type DeliveryWatch = ReturnType<typeof makeDeliveryWatch>;

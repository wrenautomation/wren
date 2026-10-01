/**
 * DeliveryWatch/fleet (D8–D10): one pass an hour over every client's work. It
 * mails each client person (D9): a welcome when they're invited, new asks and
 * deliverables, and the Friday digest with the weekly pulse (D10). And it pings
 * the operator when a client could feel forgotten (D8). The demo is never
 * watched; only its sample project is kept fresh. Mail is per person and
 * marks itself done, so a failed send is tried again next hour and a sent one
 * never repeats.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type ClientMember, clientMembers, clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { errorText, makeLoopObject, runPass } from "@wren/core/restate";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import { offerFor } from "@wren/offers";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  max,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { addDays, weekday } from "./index.js";
import { PULSE_WORDS } from "./routes.js";
import { keepSampleFresh } from "./sample.js";
import {
  asks,
  comments,
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
  /** The demo's sample project was reseeded. */
  sample: boolean;
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

/** Every active engagement and every client person, the demo's left out. */
async function watched(main: Db): Promise<{ live: Live[]; people: Person[] }> {
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
  return { live, people };
}

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
    sample: false,
  };
  stats.sample = await keepSampleFresh(main, today);
  const { live, people } = await watched(main);
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

    // New asks, deliverables and Wren's replies since we last told them, in one message.
    if (level === "all" && es.length > 0) {
      const since = p.mail.toldThrough;
      const [newAsks, newWork, replies] = await Promise.all([
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
        repliesSince(main, es, since, now),
      ]);
      if (newAsks.length + newWork.length + replies.length > 0) {
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
        if (replies.length > 0) {
          lines.push("Wren replied:");
          for (const r of replies)
            lines.push(`- On "${clip(r.on ?? "", 80)}": ${clip(r.body, 200)}`);
          const page = replies.every((r) => r.update) ? "updates" : "deliverables";
          lines.push(`Read and reply: ${app}/work/${page}?client=${c.id}`, "");
        }
        lines.push(settings(c.id));
        const n = newAsks.length + newWork.length;
        const subject =
          newAsks.length > 0
            ? `${c.name}: ${n === 1 ? "1 thing needs" : `${n} things need`} you`
            : n > 0
              ? `${c.name}: ${n === 1 ? "something" : `${n} things`} ready to look at`
              : `${c.name}: Wren replied`;
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

/**
 * Wren's comments in these engagements in (since, now], each with what it hangs
 * under. A thread under an update the client can't see now is left out.
 */
function repliesSince(main: Db, es: number[], since: Date, now: Date) {
  return main
    .select({
      body: comments.body,
      update: comments.updateId,
      on: sql<string | null>`coalesce(${updates.body}, ${deliverables.title})`,
    })
    .from(comments)
    .leftJoin(updates, eq(updates.id, comments.updateId))
    .leftJoin(deliverables, eq(deliverables.id, comments.deliverableId))
    .where(
      and(
        inArray(comments.engagementId, es),
        eq(comments.fromWren, true),
        gt(comments.createdAt, since),
        lte(comments.createdAt, now),
        or(isNull(comments.updateId), and(eq(updates.internal, false), isNull(updates.hiddenAt))),
      ),
    )
    .orderBy(asc(comments.id));
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

type Found = { engagementId: number; clientId: string; about: string; what: string };

/** What could leave a client feeling forgotten (D8): the pings, and the ops board's risks. */
async function problems(
  main: Db,
  zone: string,
  now: Date,
  today: string,
  live: Live[],
  people: Person[],
): Promise<Found[]> {
  const started = live.filter((l) => l.e.startsOn <= today);
  const ids = started.map((l) => l.e.id);
  const found: Found[] = [];
  if (ids.length > 0) {
    const answer = alias(comments, "answer");
    const [lastUpdate, lastWork, late, overdue, low, unanswered] = await Promise.all([
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
      // The client wrote, and nobody at Wren has written in that thread since.
      main
        .select()
        .from(comments)
        .where(
          and(
            inArray(comments.engagementId, ids),
            eq(comments.fromWren, false),
            notExists(
              main
                .select({ id: answer.id })
                .from(answer)
                .where(
                  and(
                    eq(answer.fromWren, true),
                    gt(answer.id, comments.id),
                    sql`${answer.updateId} is not distinct from ${comments.updateId}`,
                    sql`${answer.deliverableId} is not distinct from ${comments.deliverableId}`,
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(comments.id)),
    ]);
    for (const { e } of started) {
      const c = e.clientId;
      const at = [lastUpdate, lastWork]
        .map((rows) => rows.find((r) => r.id === e.id)?.at ?? null)
        .reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);
      const lastDay = at ? dayIn(zone, at) : addDays(e.startsOn, -1);
      if (workdaysAfter(lastDay, today, QUIET_WORKDAYS) >= QUIET_WORKDAYS)
        found.push({
          engagementId: e.id,
          about: "quiet",
          clientId: c,
          what: `nothing new for the client in ${QUIET_WORKDAYS}+ business days`,
        });
      for (const m of late.filter((m) => m.engagementId === e.id))
        found.push({
          engagementId: e.id,
          about: `step:${m.key}`,
          clientId: c,
          what: `step "${m.name}" was due ${m.dueOn}`,
        });
      for (const a of overdue.filter((a) => a.engagementId === e.id))
        found.push({
          engagementId: e.id,
          about: `ask:${a.id}`,
          clientId: c,
          what: `ask #${a.id} overdue since ${a.dueOn}`,
        });
      for (const p of low.filter((p) => p.engagementId === e.id))
        found.push({
          engagementId: e.id,
          about: `pulse:${p.id}`,
          clientId: c,
          what: `pulse ${p.score}/5 this week`,
        });
      // One ping per thread, from its first unanswered line.
      const threads = new Set<string>();
      for (const k of unanswered.filter((k) => k.engagementId === e.id)) {
        const thread = k.updateId ? `u${k.updateId}` : `d${k.deliverableId}`;
        if (threads.has(thread)) continue;
        threads.add(thread);
        found.push({
          engagementId: e.id,
          about: `reply:${thread}`,
          clientId: c,
          what: `${k.author} wrote on ${k.updateId ? `update #${k.updateId}` : `deliverable #${k.deliverableId}`}, no reply yet: "${clip(k.body, 120)}"`,
        });
      }
      const theirs = people.filter((p) => p.m.clientId === c);
      const seen = theirs
        .map((p) => p.m.lastSeenAt ?? p.m.invitedAt)
        .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
      if (!seen)
        found.push({
          engagementId: e.id,
          about: "away",
          clientId: c,
          what: `nobody on their side can sign in`,
        });
      else if (seen.getTime() < now.getTime() - AWAY_DAYS * DAY)
        found.push({
          engagementId: e.id,
          about: "away",
          clientId: c,
          what: `no client visit in ${AWAY_DAYS}+ days`,
        });
    }
  }
  return found;
}

async function pingOperator(
  deps: WatchDeps,
  now: Date,
  today: string,
  live: Live[],
  people: Person[],
  stats: WatchStats,
): Promise<void> {
  const { main } = deps;
  const found = await problems(main, deps.zone, now, today, live, people);
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
    fresh.map((f) => `${f.clientId}: ${f.what}`).join("\n"),
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

// --- the ops board --------------------------------------------------------------

/** One running engagement on the ops board, or a client with none (offer null). */
export interface BoardRow {
  clientId: string;
  name: string;
  engagementId: number | null;
  offer: string | null;
  startsOn: string | null;
  /** The step under way: the first not done. */
  phase: string | null;
  stepsDone: number;
  steps: number;
  /** The first open step with a due date. */
  next: { name: string; dueOn: string } | null;
  /** The last update the client could see. */
  lastUpdateAt: string | null;
  openAsks: number;
  /** The last time anyone on their side opened the portal. */
  lastSeenAt: string | null;
  /** The latest weekly tap, 1-5, within a week. */
  pulse: number | null;
  /** What could leave them feeling forgotten (D8); empty = fine. */
  risks: string[];
}

/** Every client with its running work, at risk first (plan: ops board). The demo isn't on it. */
export async function opsBoard(main: Db, zone: string, now: Date): Promise<BoardRow[]> {
  const today = dayIn(zone, now);
  const { live, people } = await watched(main);
  const ids = live.map((l) => l.e.id);
  const none = ids.length === 0;
  const [all, steps, lastUpdate, open, taps, found] = await Promise.all([
    main.select().from(clients).where(eq(clients.demo, false)).orderBy(asc(clients.name)),
    none
      ? []
      : main
          .select()
          .from(milestones)
          .where(inArray(milestones.engagementId, ids))
          .orderBy(asc(milestones.position), asc(milestones.id)),
    none
      ? []
      : main
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
    none
      ? []
      : main
          .select({ id: asks.engagementId })
          .from(asks)
          .where(and(inArray(asks.engagementId, ids), isNull(asks.answeredAt))),
    none
      ? []
      : main
          .select()
          .from(pulses)
          .where(
            and(
              inArray(pulses.engagementId, ids),
              gt(pulses.at, new Date(now.getTime() - 7 * DAY)),
            ),
          )
          .orderBy(desc(pulses.at)),
    problems(main, zone, now, today, live, people),
  ]);
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  const rows = all.flatMap((c): BoardRow[] => {
    const seen = people
      .filter((p) => p.m.clientId === c.id && p.m.lastSeenAt)
      .map((p) => p.m.lastSeenAt as Date)
      .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
    const base = { clientId: c.id, name: c.name, lastSeenAt: iso(seen) };
    const mine = live.filter((l) => l.e.clientId === c.id);
    if (mine.length === 0)
      return [
        {
          ...base,
          engagementId: null,
          offer: null,
          startsOn: null,
          phase: null,
          stepsDone: 0,
          steps: 0,
          next: null,
          lastUpdateAt: null,
          openAsks: 0,
          pulse: null,
          risks: [],
        },
      ];
    return mine.map(({ e }) => {
      const its = steps.filter((m) => m.engagementId === e.id);
      const left = its.filter((m) => !m.doneOn);
      const due = left.find((m) => m.dueOn);
      return {
        ...base,
        engagementId: e.id,
        offer: offerFor(e.offerId).name,
        startsOn: e.startsOn,
        phase: left[0]?.name ?? null,
        stepsDone: its.length - left.length,
        steps: its.length,
        next: due?.dueOn ? { name: due.name, dueOn: due.dueOn } : null,
        lastUpdateAt: iso(lastUpdate.find((u) => u.id === e.id)?.at),
        openAsks: open.filter((a) => a.id === e.id).length,
        pulse: taps.find((t) => t.engagementId === e.id)?.score ?? null,
        risks: found.filter((f) => f.engagementId === e.id).map((f) => f.what),
      };
    });
  });
  return rows.sort((a, b) => Number(b.risks.length > 0) - Number(a.risks.length > 0));
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

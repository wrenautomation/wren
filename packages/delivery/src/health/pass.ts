/**
 * Each running client's health, read from what delivery already keeps, written as today's row
 * (designs/2026-10-07-health.md, "Scoring"). Runs on DeliveryWatch's hourly pass: the last pass
 * of the day stands, and every day's row is kept. Health's own flags come back for `syncFlags`.
 */
import { clientMembers, clients } from "@wren/core/clients";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import { offerFor } from "@wren/offers";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { addDays, pagePath } from "../index.js";
import { asks, deliverables, engagements, invoices, pulses, results } from "../schema.js";
import type { FlagFind } from "./flags.js";
import { healthDays, healthOverrides, healthRatings } from "./schema.js";
import {
  ageDays,
  bandOf,
  combine,
  DROP,
  expectedBy,
  type HealthInput,
  meanOf,
  moneyScore,
  PARTS,
  type Part,
  type PartScore,
  ratingScore,
  resultsScore,
  shareScore,
  shownScore,
  staleOf,
  VISITS_WANTED,
  visitsScore,
} from "./score.js";

const DAY = 86_400_000;
/** Visits count over this many days. */
const VISIT_DAYS = 30;
/** Approvals and answers count over this many days. */
const WORK_DAYS = 60;
/** A deliverable waiting this long counts against approvals. */
const WAITING_DAYS = 3;
/** Ahead of plan by this share, with at least `AHEAD_MIN` results, is an opportunity. */
const AHEAD = 1.25;
const AHEAD_MIN = 3;

const pad = (n: number) => String(n).padStart(2, "0");
const dayIn = (zone: string, at: Date) => {
  const w = wallClock(zone, at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
};
const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const newest = (ds: readonly (Date | null | undefined)[]) =>
  ds.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A client's page in the portal, opened in their workspace. */
const at = (path: string, client: string) => `${path}?client=${encodeURIComponent(client)}`;

/** One client's health as read now: each part, the rows behind it, and the plan's numbers. */
export interface HealthRead {
  clientId: string;
  parts: Record<Part, PartScore>;
  inputs: HealthInput[];
  /** Days with a visit in the last 30, today's among them when there was one. */
  visitDays: string[];
  results: { actual: number; expected: number } | null;
  override: number | null;
}

/** Clients whose work is running: an engagement onboarding or active, the portal installed. */
async function running(main: Db, only?: string) {
  return main
    .select({ e: engagements })
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        inArray(engagements.status, ["onboarding", "active"]),
        eq(clients.demo, false),
        sql`${clients.products} ? 'delivery.portal'`,
        only ? eq(clients.id, only) : undefined,
      ),
    );
}

/** Reads every running client's health now; `only` reads one. */
export async function readHealth(
  main: Db,
  zone: string,
  now: Date,
  only?: string,
): Promise<HealthRead[]> {
  const today = dayIn(zone, now);
  const live = await running(main, only);
  const ids = [...new Set(live.map((l) => l.e.clientId))];
  if (!ids.length) return [];
  const es = live.map((l) => l.e.id);
  const workSince = new Date(now.getTime() - WORK_DAYS * DAY);
  const visitSince = addDays(today, -VISIT_DAYS + 1);
  const [
    members,
    sessions,
    visited,
    got,
    decided,
    waiting,
    answered,
    overdue,
    taps,
    ratings,
    bills,
    overrides,
  ] = await Promise.all([
    main.select().from(clientMembers).where(inArray(clientMembers.clientId, ids)),
    main.execute<{ client: string; day: string }>(sql`
      select distinct m.client_id as client, to_char(s.created_at at time zone ${zone}, 'YYYY-MM-DD') as day
      from auth.session s
      join auth."user" u on u.id = s.user_id
      join client_members m on lower(m.email) = lower(u.email)
      where m.client_id = any(${`{${ids}}`}::text[])
        and s.created_at > ${new Date(now.getTime() - VISIT_DAYS * DAY).toISOString()}::timestamptz`),
    main
      .select({ client: healthDays.clientId, day: healthDays.day })
      .from(healthDays)
      .where(
        and(
          inArray(healthDays.clientId, ids),
          eq(healthDays.visited, true),
          gte(healthDays.day, visitSince),
        ),
      ),
    main.select().from(results).where(inArray(results.engagementId, es)),
    main
      .select()
      .from(deliverables)
      .where(and(inArray(deliverables.engagementId, es), gte(deliverables.decidedAt, workSince))),
    main
      .select()
      .from(deliverables)
      .where(
        and(
          inArray(deliverables.engagementId, es),
          eq(deliverables.status, "waiting"),
          lte(deliverables.createdAt, new Date(now.getTime() - WAITING_DAYS * DAY)),
        ),
      ),
    main
      .select()
      .from(asks)
      .where(and(inArray(asks.engagementId, es), gte(asks.answeredAt, workSince))),
    main
      .select()
      .from(asks)
      .where(
        and(inArray(asks.engagementId, es), isNull(asks.answeredAt), sql`${asks.dueOn} < ${today}`),
      ),
    // Each person's newest weekly rating, on any of the client's projects.
    main
      .selectDistinctOn([engagements.clientId, pulses.email], {
        client: engagements.clientId,
        email: pulses.email,
        score: pulses.score,
        at: pulses.at,
        offerId: engagements.offerId,
      })
      .from(pulses)
      .innerJoin(engagements, eq(engagements.id, pulses.engagementId))
      .where(inArray(engagements.clientId, ids))
      .orderBy(engagements.clientId, pulses.email, desc(pulses.at)),
    main
      .selectDistinctOn([healthRatings.clientId])
      .from(healthRatings)
      .where(inArray(healthRatings.clientId, ids))
      .orderBy(healthRatings.clientId, desc(healthRatings.at), desc(healthRatings.id)),
    // Every invoice of every project the client ever had: money is owed whatever runs.
    main
      .select({ i: invoices, client: engagements.clientId })
      .from(invoices)
      .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
      .where(and(inArray(engagements.clientId, ids), sql`${invoices.status} <> 'void'`)),
    main
      .select()
      .from(healthOverrides)
      .where(and(inArray(healthOverrides.clientId, ids), isNull(healthOverrides.clearedAt))),
  ]);

  return ids.map((clientId): HealthRead => {
    const mine = live.map((l) => l.e).filter((e) => e.clientId === clientId);
    const mineIds = new Set(mine.map((e) => e.id));
    const offers = mine.map((e) => e.offerId);
    const work = (page: string) => at(pagePath(offers, page), clientId);
    const inputs: HealthInput[] = [];

    // Results against the plan: the target's measure on each started project that has one.
    let actual = 0;
    let expected = 0;
    let measured = false;
    let resultsAt: Date | null = null;
    for (const e of mine) {
      const offer = offerFor(e.offerId);
      if (!offer.target || offer.days === null || e.status !== "active" || e.startsOn > today)
        continue;
      measured = true;
      const row = got.find((r) => r.engagementId === e.id && r.key === offer.target?.measure);
      const day = daysFrom(e.startsOn, today);
      const want = expectedBy(offer.target, offer.days, day);
      actual += row?.value ?? 0;
      expected += want;
      // No update yet: as old as the project.
      const since = row?.updatedAt ?? new Date(`${e.startsOn}T00:00:00Z`);
      resultsAt = newest([resultsAt, since]);
      const label = offer.measures.find((m) => m.key === offer.target?.measure)?.label;
      inputs.push({
        part: "results",
        what: `${label ?? offer.target.measure}, ${offer.name}`,
        value: `${row?.value ?? 0} of ${Math.round(want * 10) / 10} expected by day ${day}`,
        at: iso(row?.updatedAt),
        href: at(pagePath([e.offerId], "results"), clientId),
      });
    }
    const r = measured
      ? resultsScore(actual, expected)
      : { score: null, why: "No plan target to measure" };
    const resultsPart: PartScore = {
      ...r,
      at: iso(resultsAt),
      stale: r.score !== null && staleOf("results", iso(resultsAt), now),
    };

    // Engagement: days with a visit, approvals, answers.
    const people = members.filter((m) => m.clientId === clientId);
    const days = new Set<string>([
      ...sessions.filter((s) => s.client === clientId).map((s) => s.day),
      ...visited.filter((v) => v.client === clientId).map((v) => v.day),
      ...people.flatMap((m) => (m.lastSeenAt ? [dayIn(zone, m.lastSeenAt)] : [])),
    ]);
    const visitDays = [...days].filter((d) => d >= visitSince && d <= today).sort();
    const lastSeen = newest(people.map((m) => m.lastSeenAt));
    const ok = decided.filter((d) => mineIds.has(d.engagementId));
    const slow = waiting.filter((d) => mineIds.has(d.engagementId));
    const done = answered.filter((a) => mineIds.has(a.engagementId));
    const late = overdue.filter((a) => mineIds.has(a.engagementId));
    const approvals = shareScore(ok.length, slow.length);
    const answers = shareScore(done.length, late.length);
    const visits = people.length ? visitsScore(visitDays.length) : 0;
    inputs.push({
      part: "engagement",
      what: "Days with a visit",
      value: people.length
        ? `${visitDays.length} in the last ${VISIT_DAYS} (${VISITS_WANTED} wanted)`
        : "Nobody on their side can sign in",
      at: iso(lastSeen),
      href: at("/account/people", clientId),
    });
    if (approvals !== null)
      inputs.push({
        part: "engagement",
        what: "Approvals",
        value: `${ok.length} decided, ${slow.length} waiting over ${WAITING_DAYS} days`,
        at: iso(newest(ok.map((d) => d.decidedAt))),
        href: work("deliverables"),
      });
    if (answers !== null)
      inputs.push({
        part: "engagement",
        what: "Answers",
        value: `${done.length} answered, ${late.length} overdue`,
        at: iso(newest(done.map((a) => a.answeredAt))),
        href: work("needs-you"),
      });
    const engagementScore = people.length ? meanOf([visits, approvals, answers]) : 0;
    const engagementPart: PartScore = {
      score: engagementScore,
      why: people.length
        ? [
            `${plural(visitDays.length, "day")} with a visit`,
            approvals === null ? null : `approvals ${approvals}`,
            answers === null ? null : `answers ${answers}`,
          ]
            .filter(Boolean)
            .join(", ")
        : "Nobody on their side can sign in",
      at: iso(newest([lastSeen, ...ok.map((d) => d.decidedAt), ...done.map((a) => a.answeredAt)])),
      stale: false,
    };

    // Sentiment: each person's newest weekly rating and Wren's own.
    const theirs = taps.filter((t) => t.client === clientId);
    const ours = ratings.find((x) => x.clientId === clientId);
    for (const t of theirs)
      inputs.push({
        part: "sentiment",
        what: `Weekly rating, ${t.email}`,
        value: `${t.score} of 5`,
        at: iso(t.at),
        href: at("/account/people", clientId),
      });
    if (ours)
      inputs.push({
        part: "sentiment",
        what: "Wren's rating",
        value: `${ours.score} of 5${ours.note ? `: ${ours.note}` : ""}`,
        at: iso(ours.at),
        href: `/clients/health/${encodeURIComponent(clientId)}`,
      });
    const scores = [...theirs.map((t) => t.score), ...(ours ? [ours.score] : [])];
    const feltAt = iso(newest([...theirs.map((t) => t.at), ours?.at]));
    const felt = meanOf(scores.map(ratingScore));
    const sentimentPart: PartScore = {
      score: felt,
      why: scores.length
        ? `${plural(scores.length, "rating")}, averaging ${
            Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          } of 5`
        : "No ratings yet",
      at: feltAt,
      stale: felt !== null && staleOf("sentiment", feltAt, now),
    };

    // Money: the oldest unpaid invoice past its due day.
    const owed = bills.filter((b) => b.client === clientId).map((b) => b.i);
    const pastDue = owed
      .filter((i) => i.status === "open" && i.dueOn < today)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    for (const i of pastDue)
      inputs.push({
        part: "money",
        what: `Invoice ${i.number}`,
        value: `${plural(daysFrom(i.dueOn, today), "day")} late`,
        at: `${i.dueOn}T00:00:00.000Z`,
        href: at("/account/billing", clientId),
      });
    if (owed.length && !pastDue.length)
      inputs.push({
        part: "money",
        what: "Invoices",
        value: `None overdue, ${plural(owed.filter((i) => i.status === "paid").length, "paid")}`,
        at: null,
        href: at("/account/billing", clientId),
      });
    const oldest = pastDue[0];
    const moneyPart: PartScore = owed.length
      ? {
          score: moneyScore(oldest ? daysFrom(oldest.dueOn, today) : null),
          why: oldest
            ? `${plural(pastDue.length, "invoice")} overdue, the oldest ${plural(daysFrom(oldest.dueOn, today), "day")} late`
            : "Nothing overdue",
          at: null,
          stale: false,
        }
      : { score: null, why: "No invoices yet", at: null, stale: false };

    return {
      clientId,
      parts: {
        results: resultsPart,
        engagement: engagementPart,
        sentiment: sentimentPart,
        money: moneyPart,
      },
      inputs,
      visitDays,
      results: measured ? { actual, expected } : null,
      override: overrides.find((o) => o.clientId === clientId)?.score ?? null,
    };
  });
}

/**
 * Writes today's row for every running client (the last pass of a day stands), marks earlier
 * days visited that a late visit fell on, and returns health's flags.
 */
export async function healthPass(
  main: Db,
  zone: string,
  now: Date,
): Promise<{ scored: number; flags: FlagFind[] }> {
  const today = dayIn(zone, now);
  const reads = await readHealth(main, zone, now);
  const flags: FlagFind[] = [];
  const weekAgo = addDays(today, -7);
  const before = reads.length
    ? await main
        .selectDistinctOn([healthDays.clientId], {
          clientId: healthDays.clientId,
          score: healthDays.score,
          override: healthDays.override,
        })
        .from(healthDays)
        .where(
          and(
            inArray(
              healthDays.clientId,
              reads.map((r) => r.clientId),
            ),
            lte(healthDays.day, weekAgo),
          ),
        )
        .orderBy(healthDays.clientId, desc(healthDays.day))
    : [];
  for (const h of reads) {
    const { score, weights } = combine(h.parts);
    const stale = PARTS.filter((p) => h.parts[p].stale);
    const row = {
      score,
      band: bandOf(score),
      results: h.parts.results.score,
      engagement: h.parts.engagement.score,
      sentiment: h.parts.sentiment.score,
      money: h.parts.money.score,
      weights,
      why: Object.fromEntries(PARTS.map((p) => [p, h.parts[p].why])),
      ages: Object.fromEntries(
        PARTS.flatMap((p) => (h.parts[p].at ? [[p, h.parts[p].at as string]] : [])),
      ),
      stale,
      visited: h.visitDays.includes(today),
      override: h.override,
      inputs: h.inputs,
      at: now,
    };
    await main
      .insert(healthDays)
      .values({ clientId: h.clientId, day: today, ...row })
      .onConflictDoUpdate({ target: [healthDays.clientId, healthDays.day], set: row });
    // A visit late in a day the next pass saw: that day's row says so too.
    const earlier = h.visitDays.filter((d) => d < today);
    if (earlier.length)
      await main
        .update(healthDays)
        .set({ visited: true })
        .where(
          and(
            eq(healthDays.clientId, h.clientId),
            inArray(healthDays.day, earlier),
            eq(healthDays.visited, false),
          ),
        );

    const shown = shownScore(score, h.override);
    const base = { clientId: h.clientId, engagementId: null } as const;
    if (bandOf(shown) === "risk")
      flags.push({
        ...base,
        side: "risk",
        cause: "health:at-risk",
        what: `Health is ${shown}, at risk${h.override !== null ? " (set by hand)" : ""}`,
      });
    const was = before.find((b) => b.clientId === h.clientId);
    const then = was ? shownScore(was.score, was.override) : null;
    if (shown !== null && then !== null && then - shown >= DROP)
      flags.push({
        ...base,
        side: "risk",
        cause: "health:drop",
        what: `Health fell from ${then} to ${shown} in a week`,
      });
    if (
      h.results &&
      h.results.actual >= AHEAD_MIN &&
      h.results.actual >= AHEAD * h.results.expected
    )
      flags.push({
        ...base,
        side: "opportunity",
        cause: "health:ahead",
        what: `Results ahead of plan: ${h.results.actual} against ${Math.round(h.results.expected * 10) / 10} expected. A good time to ask for a review or a referral`,
      });
  }
  return { scored: reads.length, flags };
}

/** The age of an input in days, for the CLI. */
export const inputAge = (at: string | null, now: Date) => (at ? ageDays(at, now) : null);

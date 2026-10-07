/**
 * DeliveryWatch/fleet (D8–D10): one pass an hour over every client's work. It
 * mails each client person (D9): a welcome when they're invited, new asks and
 * deliverables, and the Friday digest with the weekly pulse (D10). What could
 * leave a client feeling forgotten (D8) goes on the flags list, beside each
 * client's health for the day (designs/2026-10-07-health.md). The demo is never
 * watched; only its sample project is kept fresh. Mail is per person and
 * marks itself done, so a failed send is tried again next hour and a sent one
 * never repeats.
 */
import type * as restate from "@restatedev/restate-sdk";
import { why } from "@wren/core/access";
import { type ClientMember, clientMembers, clients } from "@wren/core/clients";
import { grantsFor } from "@wren/core/grants";
import type { Notifier } from "@wren/core/notify";
import { errorText, makeLoopObject, runPass } from "@wren/core/restate";
import { clientMailAlerts } from "@wren/core/setup-alerts";
import type { Fired, FireTriggers } from "@wren/core/spine";
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
import { amount, WREN_PARTY } from "./contract.js";
import { type FlagFind, flagsToFire, syncFlags, tellFlags } from "./health/flags.js";
import { healthPass } from "./health/pass.js";
import {
  addDays,
  type Bill,
  billCents,
  billsDue,
  HALFWAY,
  LAST_WEEK,
  momentLabel,
  momentsReached,
  nextOffers,
  pagePath,
  weekday,
} from "./index.js";
import { PULSE_WORDS, REVIEW_WORDS } from "./routes.js";
import { keepSampleFresh } from "./sample.js";
import {
  accessRequests,
  agreements,
  asks,
  comments,
  deliverables,
  type Engagement,
  engagements,
  interests,
  invoices,
  type MemberMail,
  memberMail,
  milestones,
  moments,
  pulses,
  results,
  reviews,
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
/** Paperwork left this long is flagged: an unsigned contract, unanswered access. */
const PAPERWORK_DAYS = 3;
/** A problem still standing comes back in the digest after this long. */
const REPING_DAYS = 7;
/** Days before the 1st that its bills are previewed. */
const BILL_HEADS_UP_DAYS = 2;
/** The digest goes Friday from this hour, fleet clock. */
const DIGEST_HOUR = 15;
/** An open invoice is reminded once, this many days or fewer before it's due (D13)... */
const REMIND_DAYS = 5;
/** ...when it was issued at least this long before, so it isn't news... */
const REMIND_AFTER_DAYS = 3;
/** ...from this hour, fleet clock. */
const REMIND_HOUR = 9;

export interface PortalMail {
  to: string;
  subject: string;
  text: string;
}

export interface WatchDeps {
  main: Db;
  /** Mails one client person; null = no client mail here (flags still go). */
  send: ((m: PortalMail) => Promise<void>) | null;
  /** The portal, for links: `https://app.<domain>`. */
  app: string;
  /** The fleet's clock: business days and Friday afternoon. */
  zone: string;
  notifier?: Notifier;
  /** Tells the spine of each flag raised or cleared; unset where no Spine runs. */
  fire?: FireTriggers;
}

export interface WatchStats {
  welcomed: number;
  /** Signed contracts mailed out. */
  contracts: number;
  told: number;
  digests: number;
  /** Flags raised and cleared by themselves this pass, and how many alerts named. */
  raised: number;
  cleared: number;
  alerted: number;
  /** Clients whose health was written for the day. */
  scored: number;
  /** Flag changes for the spine, sent once the pass is journaled. */
  fired: Fired[];
  /** Moments mailed with a review ask (D13). */
  moments: number;
  /** Invoices reminded before they're due (D13). */
  reminded: number;
  /** New reviews and interests Wren was told about. */
  heard: number;
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

type Live = { e: Engagement; clientName: string; products: Record<string, unknown> };
type Person = { m: ClientMember; mail: MemberMail | null; clientName: string };

/** Clients with component `id` installed: a key in `clients.products`. */
const has = (id: string) => sql`${clients.products} ? ${id}`;

/**
 * Every running engagement (onboarding or active) and every client person, of the clients
 * with the portal installed; the demo's left out.
 */
async function watched(main: Db): Promise<{ live: Live[]; people: Person[] }> {
  const live: Live[] = await main
    .select({ e: engagements, clientName: clients.name, products: clients.products })
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        inArray(engagements.status, ["onboarding", "active"]),
        eq(clients.demo, false),
        has("delivery.portal"),
      ),
    )
    .orderBy(asc(engagements.id));
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
    .where(and(eq(clients.demo, false), has("delivery.portal")));
  return { live, people };
}

/** One pass: mail, then health and flags. */
export async function watchPass(deps: WatchDeps, now: Date): Promise<WatchStats> {
  const { main } = deps;
  const today = dayIn(deps.zone, now);
  const stats: WatchStats = {
    welcomed: 0,
    contracts: 0,
    told: 0,
    digests: 0,
    raised: 0,
    cleared: 0,
    alerted: 0,
    scored: 0,
    fired: [],
    moments: 0,
    reminded: 0,
    heard: 0,
    failed: 0,
    lastError: null,
    sample: false,
  };
  stats.sample = await keepSampleFresh(main, today);
  const { live, people } = await watched(main);
  if (deps.send) {
    await mailContracts(deps, deps.send, now, stats);
    await mailPeople(deps, deps.send, now, today, live, people, stats);
  }
  await markMoments(deps, today, live, people, stats);
  if (deps.send) await remindInvoices(deps, deps.send, now, today, stats);
  await flagClients(deps, now, today, live, people, stats);
  return stats;
}

// --- moments, reviews and what's next (D13) ------------------------------------

/**
 * Records the moments each running engagement reached, then mails its people the
 * newest unmailed one: a one-tap review and, from halfway, what's next. Moments
 * reached together send one mail.
 */
async function markMoments(
  deps: WatchDeps,
  today: string,
  live: Live[],
  people: Person[],
  stats: WatchStats,
): Promise<void> {
  const { main, app, send } = deps;
  const running = live.filter((l) => l.e.status === "active" && "delivery.reviews" in l.products);
  if (running.length === 0) return;
  const ids = running.map((l) => l.e.id);
  const [rs, known] = await Promise.all([
    main.select().from(results).where(inArray(results.engagementId, ids)),
    main.select().from(moments).where(inArray(moments.engagementId, ids)),
  ]);
  for (const { e, clientName } of running) {
    const offer = offerFor(e.offerId);
    const values = new Map(
      rs.filter((r) => r.engagementId === e.id).map((r) => [r.key, r.value] as const),
    );
    const reached = momentsReached(offer, e, values, today);
    const mine = known.filter((k) => k.engagementId === e.id);
    const fresh = reached.filter((m) => !mine.some((k) => k.moment === m));
    if (fresh.length > 0)
      await main
        .insert(moments)
        .values(fresh.map((moment) => ({ engagementId: e.id, moment, reachedOn: today })))
        .onConflictDoNothing();
    const unmailed = reached.filter(
      (m) => fresh.includes(m) || mine.some((k) => k.moment === m && !k.mailedAt),
    );
    const newest = unmailed.at(-1);
    if (!send || !newest) continue;

    const to = people.filter(
      (p) => p.m.clientId === e.clientId && p.mail?.toldThrough && p.mail.level !== "off",
    );
    const label = momentLabel(offer, newest) ?? newest;
    const link = (q = "") =>
      `${app}${pagePath([e.offerId], "overview")}?client=${e.clientId}&e=${e.id}${q && `&${q}`}`;
    const ups = newest === HALFWAY || newest === LAST_WEEK ? nextOffers(offer) : [];
    const text = [
      newest === HALFWAY
        ? `You're halfway through ${offer.name}.`
        : newest === LAST_WEEK
          ? `The final week of ${offer.name} starts now.`
          : `${label}.`,
      "",
      "How would you rate working with Wren so far? One tap:",
      ...[5, 4, 3, 2, 1].map(
        (n) => `${REVIEW_WORDS[n]}: ${link(`review=${encodeURIComponent(newest)}&score=${n}`)}`,
      ),
      "",
      `Say more, or let us quote you: ${link()}`,
      ...(ups.length > 0
        ? [
            "",
            "When you're ready for more:",
            ...ups.flatMap((o) => [
              `- ${o.name}: ${o.upsell?.pitch}`,
              `  Want to hear more? ${link(`next=${o.id}`)}`,
            ]),
          ]
        : []),
      "",
      mailSettings(app, e.clientId),
    ].join("\n");
    let ok = true;
    for (const p of to) {
      try {
        await send({ to: p.m.email, subject: `${clientName}: ${label}`, text });
      } catch (err) {
        ok = false;
        stats.failed += 1;
        stats.lastError = errorText(err);
      }
    }
    if (!ok) continue;
    await main
      .update(moments)
      .set({ mailedAt: new Date() })
      .where(and(eq(moments.engagementId, e.id), inArray(moments.moment, unmailed)));
    stats.moments += 1;
  }
}

/**
 * An open invoice due in the next few days gets one reminder to the client's
 * owners, like the signed contract: billing mail ignores mail settings.
 */
async function remindInvoices(
  deps: WatchDeps,
  send: (m: PortalMail) => Promise<void>,
  now: Date,
  today: string,
  stats: WatchStats,
): Promise<void> {
  const { main, app } = deps;
  if (wallClock(deps.zone, now).hour < REMIND_HOUR) return;
  const due = await main
    .select({ i: invoices, clientId: engagements.clientId, clientName: clients.name })
    .from(invoices)
    .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        eq(invoices.status, "open"),
        isNull(invoices.remindedAt),
        gt(invoices.dueOn, today),
        lte(invoices.dueOn, addDays(today, REMIND_DAYS)),
        lte(invoices.issuedOn, addDays(today, -REMIND_AFTER_DAYS)),
        eq(clients.demo, false),
        has("delivery.invoices"),
      ),
    );
  for (const { i, clientId, clientName } of due) {
    const owners = await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.role, "owner")));
    const days = Math.round((Date.parse(i.dueOn) - Date.parse(today)) / DAY);
    const text = [
      `Invoice ${i.number} for ${amount(i.cents, i.currency)} is due ${i.dueOn}, in ${days === 1 ? "1 day" : `${days} days`}.`,
      i.description,
      "",
      ...(i.link ? [`Pay with Wise: ${i.link}`] : []),
      `Your invoices: ${app}/account/billing?client=${clientId}`,
      "",
      "Paid already? Thank you, and ignore this.",
    ].join("\n");
    let ok = true;
    for (const { email } of owners) {
      try {
        await send({
          to: email,
          subject: `${clientName}: invoice ${i.number} due in ${days === 1 ? "1 day" : `${days} days`}`,
          text,
        });
      } catch (err) {
        ok = false;
        stats.failed += 1;
        stats.lastError = errorText(err);
      }
    }
    if (!ok) continue;
    await main.update(invoices).set({ remindedAt: now }).where(eq(invoices.id, i.id));
    stats.reminded += 1;
  }
}

/** Reviews in the quotable range: a happy client may be quoted. */
const QUOTE_FROM = 4;
/** A review this low is urgent. */
const LOW_REVIEW = 2;

/**
 * New reviews and interests as one-time flags: an interest and a quotable 4 or 5 are
 * opportunities, a review of 2 or lower is an urgent risk. Each is heard once (`toldAt`).
 */
async function heardFlags(main: Db): Promise<{ found: FlagFind[]; mark: () => Promise<void> }> {
  const [rv, it] = await Promise.all([
    main
      .select({ r: reviews, e: engagements })
      .from(reviews)
      .innerJoin(engagements, eq(engagements.id, reviews.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(isNull(reviews.toldAt), eq(clients.demo, false))),
    main
      .select({ i: interests, e: engagements })
      .from(interests)
      .innerJoin(engagements, eq(engagements.id, interests.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(isNull(interests.toldAt), eq(clients.demo, false))),
  ]);
  const found: FlagFind[] = [];
  for (const { r, e } of rv) {
    if (r.score === null) continue;
    const at = momentLabel(offerFor(e.offerId), r.moment) ?? r.moment;
    const words = r.words ? `: "${clip(r.words, 200)}"` : "";
    const base = { clientId: e.clientId, engagementId: e.id, cause: `review:${r.id}`, once: true };
    if (r.score <= LOW_REVIEW)
      found.push({
        ...base,
        side: "risk",
        urgent: true,
        what: `${r.email} rated ${r.score}/5 at "${at}"${words}`,
      });
    else if (r.score >= QUOTE_FROM && r.mayQuote !== "private")
      found.push({
        ...base,
        side: "opportunity",
        what: `${r.email} rated ${r.score}/5 at "${at}" and may be quoted (${r.mayQuote})${words}`,
      });
  }
  for (const { i, e } of it)
    found.push({
      clientId: e.clientId,
      engagementId: e.id,
      cause: `interest:${i.id}`,
      once: true,
      urgent: true,
      side: "opportunity",
      what: `${i.email} wants to hear about ${offerFor(i.offerId).name}`,
    });
  const mark = async () => {
    const now = new Date();
    if (rv.length)
      await main
        .update(reviews)
        .set({ toldAt: now })
        .where(
          inArray(
            reviews.id,
            rv.map(({ r }) => r.id),
          ),
        );
    if (it.length)
      await main
        .update(interests)
        .set({ toldAt: now })
        .where(
          inArray(
            interests.id,
            it.map(({ i }) => i.id),
          ),
        );
  };
  return { found, mark };
}

// --- client mail (D9, D10) -----------------------------------------------------

/**
 * A signed contract goes to the signer, the account's owners and Wren, with the
 * signature on it. It's marked mailed once every copy went.
 * ponytail: one failed copy resends them all next pass; mark per address if that bites.
 */
async function mailContracts(
  deps: WatchDeps,
  send: (m: PortalMail) => Promise<void>,
  now: Date,
  stats: WatchStats,
): Promise<void> {
  const { main, app } = deps;
  const due = await main
    .select({
      a: agreements,
      clientId: engagements.clientId,
      offerId: engagements.offerId,
      clientName: clients.name,
    })
    .from(agreements)
    .innerJoin(engagements, eq(engagements.id, agreements.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        sql`${agreements.signedAt} is not null`,
        isNull(agreements.mailedAt),
        eq(clients.demo, false),
        has("delivery.contract"),
      ),
    );
  for (const { a, clientId, offerId, clientName } of due) {
    const owners = await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.role, "owner")));
    const to = [
      ...new Set([a.signerEmail ?? "", ...owners.map((o) => o.email), WREN_PARTY.email]),
    ].filter(Boolean);
    const at = a.signedAt?.toISOString().replace("T", " ").slice(0, 16);
    const text = [
      `${clientName}'s contract with Wren is signed. Your copy is below. It's also in your portal: ${app}${pagePath([offerId], "contract")}?client=${clientId}`,
      "",
      a.body,
      "",
      "Signed",
      `- For ${clientName}: ${a.signerName}${a.signerTitle ? `, ${a.signerTitle}` : ""} (${a.signerEmail}), ${at} UTC${a.signedIp ? `, from ${a.signedIp}` : ""}`,
      `- For Wren: ${WREN_PARTY.name}, issued ${a.issuedAt.toISOString().slice(0, 10)}`,
      `- Version ${a.version}, fingerprint ${a.sha256}`,
    ].join("\n");
    let ok = true;
    for (const email of to) {
      try {
        await send({ to: email, subject: `${clientName}: your signed contract with Wren`, text });
      } catch (err) {
        ok = false;
        stats.failed += 1;
        stats.lastError = errorText(err);
      }
    }
    if (!ok) continue;
    await main.update(agreements).set({ mailedAt: now }).where(eq(agreements.id, a.id));
    stats.contracts += 1;
  }
}

/** Does this person's role, or a grant, reach the Account app at their client? */
async function reachesAccounts(main: Db, p: Person): Promise<boolean> {
  const client = p.m.clientId;
  const grants = await grantsFor(main, p.m.email, p.m.role, client);
  const who = { member: p.m.role, client, ...(grants.length ? { grants } : {}) };
  return why(who, "read", { client, app: "account" }).length > 0;
}

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
  const settings = (clientId: string) => mailSettings(app, clientId);

  for (const p of people) {
    const c = { id: p.m.clientId, name: p.clientName };
    const theirs = live.filter((l) => l.e.clientId === c.id).map((l) => l.e.offerId);
    const page = (name: string) => `${app}${pagePath(theirs, name)}?client=${c.id}`;
    if (!p.mail?.toldThrough) {
      const sent = await trySend({
        to: p.m.email,
        subject: `You're invited to ${c.name}'s project with Wren`,
        text: [
          `${p.m.invitedBy ?? "Wren"} added you to ${c.name}'s project with Wren.`,
          "",
          ...(live.some((l) => l.e.clientId === c.id && l.e.status === "onboarding")
            ? [
                p.m.role === "owner"
                  ? "First, the paperwork: read and sign the contract, and answer our access requests."
                  : "First, the paperwork: see what's left before we start.",
                page("paperwork"),
              ]
            : ["See where things stand, what's next and what we need from you:", page("overview")]),
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
          lines.push(`Answer here: ${page("needs-you")}`, "");
        }
        if (newWork.length > 0) {
          lines.push("Ready for you to look at:");
          for (const d of newWork)
            lines.push(`- ${clip(d.title, 200)}${d.version > 1 ? ` (version ${d.version})` : ""}`);
          lines.push(`Approve or ask for changes: ${page("deliverables")}`, "");
        }
        if (replies.length > 0) {
          lines.push("Wren replied:");
          for (const r of replies)
            lines.push(`- On "${clip(r.on ?? "", 80)}": ${clip(r.body, 200)}`);
          const on = replies.every((r) => r.update) ? "updates" : "deliverables";
          lines.push(`Read and reply: ${page(on)}`, "");
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
    // A setup step theirs to do, a fact lost, a part paused: only to people whose role or grants
    // reach the Account app, where they act on it.
    if (level === "all") {
      const alerts = await clientMailAlerts(main, c.id, p.mail.toldThrough, now);
      if (alerts.length > 0 && (await reachesAccounts(main, p))) {
        const lines = ["Your accounts with Wren:"];
        for (const a of alerts) lines.push(`- ${a.title}${a.why ? `: ${clip(a.why, 200)}` : ""}`);
        lines.push(`See and mark them done: ${app}/account/accounts?client=${c.id}`, "");
        lines.push(settings(c.id));
        const subject = `${c.name}: ${alerts.length === 1 ? "an account needs" : `${alerts.length} account steps need`} you`;
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
        subject: recapSubject(c.name),
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

const mailSettings = (app: string, clientId: string) =>
  `Change what we email you: ${app}/account/you?client=${clientId}`;
const recapSubject = (client: string) => `${client}: your week with Wren`;

/** This Friday's digest for one client as it would go now; null when nothing's active. */
export async function recapOf(
  deps: Pick<WatchDeps, "main" | "app" | "zone">,
  clientId: string,
  now: Date,
): Promise<{ subject: string; text: string } | null> {
  const live: Live[] = await deps.main
    .select({ e: engagements, clientName: clients.name, products: clients.products })
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(and(eq(engagements.clientId, clientId), eq(engagements.status, "active")))
    .orderBy(asc(engagements.id));
  const name = live[0]?.clientName;
  const body = name ? await digestOf(deps, clientId, live, now, dayIn(deps.zone, now)) : null;
  return name && body
    ? { subject: recapSubject(name), text: `${body}\n\n${mailSettings(deps.app, clientId)}` }
    : null;
}

/** The Friday digest for one client: the week, what's next, what we need, results, the pulse. */
async function digestOf(
  deps: Pick<WatchDeps, "main" | "app">,
  clientId: string,
  live: Live[],
  now: Date,
  today: string,
): Promise<string | null> {
  const { main, app } = deps;
  const es = live
    .filter((l) => l.e.clientId === clientId && l.e.status === "active")
    .map((l) => l.e);
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
    if (next) out.push(`Next: ${next.name}${next.dueOn ? `, due ${dayWords(next.dueOn)}` : ""}.`);
    const open = mine(as);
    if (open.length > 0) {
      const late = open.filter((a) => a.dueOn && a.dueOn < today).length;
      out.push(
        `We need ${open.length} thing${open.length === 1 ? "" : "s"} from you${late ? ` (${late} overdue)` : ""}: ${app}${pagePath([e.offerId], "needs-you")}?client=${clientId}`,
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
        (n) =>
          `${n} ${PULSE_WORDS[n]}: ${app}${pagePath([e.offerId], "overview")}?client=${clientId}&e=${e.id}&pulse=${n}`,
      ),
      "",
    );
  }
  out.push(
    `The full picture: ${app}${pagePath(
      es.map((e) => e.offerId),
      "overview",
    )}?client=${clientId}`,
  );
  return out.join("\n");
}

// --- what needs a look (D8) ---------------------------------------------------------

type Found = {
  engagementId: number;
  clientId: string;
  about: string;
  what: string;
  /** Comes back in the digest after this many days while it stands; a week by default. */
  everyDays?: number;
  /** What to do, for the alert only: it may name a command. */
  how?: string;
  /** Told on the next pass, not in the morning digest. */
  urgent?: boolean;
};

/** What could leave a client feeling forgotten (D8): flags, and the ops board's risks. */
async function problems(
  main: Db,
  zone: string,
  now: Date,
  today: string,
  live: Live[],
  people: Person[],
): Promise<Found[]> {
  const started = live.filter((l) => l.e.status === "active" && l.e.startsOn <= today);
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
          what: `weekly rating ${p.score}/5`,
          urgent: p.score <= LOW_REVIEW,
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
  // Paperwork: a contract left unsigned, a setup invoice not sent, access refused or unanswered.
  const stale = new Date(now.getTime() - PAPERWORK_DAYS * DAY);
  const [waiting, access] = await Promise.all([
    main
      .select({ a: agreements, clientId: engagements.clientId })
      .from(agreements)
      .innerJoin(engagements, eq(engagements.id, agreements.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(eq(engagements.status, "onboarding"), eq(clients.demo, false))),
    main
      .select({ r: accessRequests, clientId: engagements.clientId })
      .from(accessRequests)
      .innerJoin(engagements, eq(engagements.id, accessRequests.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(
        and(
          inArray(engagements.status, ["onboarding", "active"]),
          eq(clients.demo, false),
          or(
            eq(accessRequests.status, "declined"),
            and(eq(accessRequests.status, "open"), lt(accessRequests.createdAt, stale)),
          ),
        ),
      ),
  ]);
  const setupSent = new Set(
    (
      await main
        .select({ id: invoices.engagementId })
        .from(invoices)
        .where(
          and(
            eq(invoices.setup, true),
            inArray(invoices.engagementId, waiting.map((w) => w.a.engagementId).concat(0)),
          ),
        )
    ).map((r) => r.id),
  );
  for (const { a, clientId } of waiting) {
    const base = { engagementId: a.engagementId, clientId };
    if (!a.signedAt && a.issuedAt < stale)
      found.push({
        ...base,
        about: "contract",
        what: `contract unsigned since ${a.issuedAt.toISOString().slice(0, 10)}`,
      });
    if (a.terms.setupCents > 0 && !setupSent.has(a.engagementId))
      found.push({
        ...base,
        about: "setup",
        what: `no setup invoice on record (${amount(a.terms.setupCents, a.terms.currency)})`,
        how: "Send it through Wise, then `wren delivery invoice --setup`",
      });
  }
  for (const { r, clientId } of access)
    found.push({
      engagementId: r.engagementId,
      clientId,
      about: `access:${r.id}`,
      what:
        r.status === "declined"
          ? `declined access to ${r.system}: "${clip(r.note ?? "", 120)}"`
          : `access to ${r.system} unanswered since ${r.createdAt.toISOString().slice(0, 10)}`,
    });
  // Money owed past its due day, whether or not the work is still running.
  const unpaid = await main
    .select({ i: invoices, clientId: engagements.clientId })
    .from(invoices)
    .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
    .where(and(eq(invoices.status, "open"), lt(invoices.dueOn, today)))
    .orderBy(asc(invoices.dueOn));
  for (const { i, clientId } of unpaid)
    found.push({
      engagementId: i.engagementId,
      about: `invoice:${i.id}`,
      clientId,
      what: `invoice ${i.number} (${i.currency} ${(i.cents / 100).toFixed(2)}) unpaid, due ${i.dueOn}`,
    });
  found.push(...(await billing(main, today)));
  return found;
}

/**
 * The 1st's bills (D15): a heads-up two days before, then from the 1st a ping each day of
 * the first week, weekly after, until the invoice is on record with its month.
 */
async function billing(main: Db, today: string): Promise<Found[]> {
  const period = today.slice(0, 7);
  const day = Number(today.slice(8));
  const next = addDays(`${period}-01`, 32).slice(0, 7);
  const soon = addDays(today, BILL_HEADS_UP_DAYS) >= `${next}-01`;
  const said = (b: Bill) =>
    [
      b.monthlyCents ? `${amount(b.monthlyCents, b.currency)} monthly` : "",
      b.units ? `${b.units} × ${b.unit ?? "unit"} at ${amount(b.unitCents, b.currency)}` : "",
    ]
      .filter(Boolean)
      .join(" + ");
  const now = (await billsDue(main, period)).map(
    (b): Found => ({
      engagementId: b.engagementId,
      clientId: b.clientId,
      about: `bill:${period}`,
      everyDays: day <= 7 ? 1 : REPING_DAYS,
      what: `bill ${period}: ${said(b)} = ${amount(billCents(b), b.currency)}`,
      how: `Send it through Wise, then \`wren --client ${b.clientId} delivery invoice <number> ${billCents(b) / 100} --for "${monthName(period)}" --due ${addDays(today, b.payDays)} --period ${period}${b.units ? ` --units ${b.units}` : ""}\``,
    }),
  );
  const ahead = soon
    ? (await billsDue(main, next)).map(
        (b): Found => ({
          engagementId: b.engagementId,
          clientId: b.clientId,
          about: `bill-soon:${next}`,
          what: `bills on the 1st for ${next}: ${said(b)} so far = ${amount(billCents(b), b.currency)}`,
        }),
      )
    : [];
  return [...now, ...ahead];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** A day as a person says it: "2026-10-09" to "October 9". */
const dayWords = (day: string) =>
  `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
const monthName = (period: string) =>
  `${MONTH_NAMES[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;

/** Causes told on the next pass, not in the morning digest: a client waiting on us. */
const URGENT = /^reply:/;

/**
 * DeliveryWatch's problems and the new reviews and interests onto the flags list, health's
 * day and its flags, then the alerts and the spine's outbox (designs/2026-10-07-health.md).
 */
async function flagClients(
  deps: WatchDeps,
  now: Date,
  today: string,
  live: Live[],
  people: Person[],
  stats: WatchStats,
): Promise<void> {
  const { main } = deps;
  const found = await problems(main, deps.zone, now, today, live, people);
  const heard = await heardFlags(main);
  const delivery = await syncFlags(
    main,
    "delivery",
    [
      ...found.map(
        (f): FlagFind => ({
          clientId: f.clientId,
          engagementId: f.engagementId,
          side: "risk",
          cause: f.about,
          what: f.what,
          how: f.how ?? null,
          urgent: f.urgent ?? URGENT.test(f.about),
          remindDays: f.everyDays ?? REPING_DAYS,
        }),
      ),
      ...heard.found,
    ],
    now,
  );
  await heard.mark();
  stats.heard = heard.found.length;
  const health = await healthPass(main, deps.zone, now);
  const fromHealth = await syncFlags(main, "health", health.flags, now);
  stats.scored = health.scored;
  stats.raised = delivery.raised + fromHealth.raised;
  stats.cleared = delivery.cleared + fromHealth.cleared;
  if (deps.notifier) {
    const told = await tellFlags(main, deps.notifier, today, wallClock(deps.zone, now).hour, now);
    stats.alerted = told.urgent + told.digest;
  }
  if (deps.fire) stats.fired = await flagsToFire(main, now);
}

// --- the ops board --------------------------------------------------------------

/** One running engagement on the ops board, or a client with none (offer null). */
export interface BoardRow {
  clientId: string;
  name: string;
  engagementId: number | null;
  offer: string | null;
  /** Where its plan opens: the paperwork while onboarding. */
  path: string;
  /** Onboarding: the paperwork comes first. */
  status: Engagement["status"] | null;
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
          path: pagePath([], "overview"),
          status: null,
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
        path: pagePath([e.offerId], e.status === "onboarding" ? "paperwork" : "overview"),
        status: e.status,
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
    }).then((outcome) => {
      // Journaled with the pass: each flag change reaches the spine once.
      for (const f of outcome.stats?.fired ?? []) deps.fire?.(ctx, f);
      return outcome;
    });
  });
}

export type DeliveryWatch = ReturnType<typeof makeDeliveryWatch>;

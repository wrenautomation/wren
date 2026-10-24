/** Moments a client reaches, their reviews, the next offers put to them, and what mail they get (D9, D13). */
import type { Queryable } from "@wren/db";
import { type Offer, offerFor } from "@wren/offers";
import { and, eq } from "drizzle-orm";
import { addDays, bad, missing, textIn } from "./rows.js";
import {
  type Engagement,
  interests,
  MAIL_LEVELS,
  type MailLevel,
  memberMail,
  moments,
  QUOTE_CONSENTS,
  type QuoteConsent,
  reviews,
} from "./schema.js";

/** The generic app: every engagement's plan and paperwork, for offers with no app of their own (D14). */
export const WORK_APP = "work";

/** The portal app an offer runs in; its plan and paperwork live there too. */
export const appOf = (offerId: string): string => offerFor(offerId).app ?? WORK_APP;

/**
 * A portal page for these offers' engagements: their app when they share one, else `work`,
 * which holds them all. Every app names the plan's pages alike ("overview", "needs-you").
 */
export function pagePath(offerIds: readonly string[], page: string): string {
  const apps = new Set(offerIds.map(appOf));
  const [only] = apps;
  return `/${apps.size === 1 && only ? only : WORK_APP}/${page}`;
}

export const HALFWAY = "halfway";

export const LAST_WEEK = "last_week";

const firstOf = (measure: string) => `first:${measure}`;

/** What the client calls a moment, or null for one this offer doesn't have. */
export function momentLabel(offer: Offer, moment: string): string | null {
  if (moment === HALFWAY) return "Halfway there";
  if (moment === LAST_WEEK) return "The final week";
  return offer.reviewAfterFirst?.find((f) => firstOf(f.measure) === moment)?.moment ?? null;
}

/**
 * The moments a running engagement has reached by `today`: each first result the
 * offer names, day `days`/2 and the last 7 days. Onboarding or done reaches none.
 */
export function momentsReached(
  offer: Offer,
  e: Pick<Engagement, "status" | "startsOn">,
  values: ReadonlyMap<string, number | null>,
  today: string,
): string[] {
  if (e.status !== "active" || e.startsOn > today) return [];
  const out = (offer.reviewAfterFirst ?? [])
    .filter((f) => (values.get(f.measure) ?? 0) >= 1)
    .map((f) => firstOf(f.measure));
  if (offer.days !== null) {
    if (addDays(e.startsOn, Math.floor(offer.days / 2)) <= today) out.push(HALFWAY);
    if (addDays(e.startsOn, offer.days - 7) <= today) out.push(LAST_WEEK);
  }
  return out;
}

/** Offers put to a client on this one: live, in its `next`, with an upsell pitch. */
export const nextOffers = (offer: Offer): Offer[] =>
  offer.next.map((id) => offerFor(id)).filter((o) => o.status === "live" && o.upsell);

/** A client person's review at a moment they reached; again replaces it. No score: "not now". */
export async function recordReview(
  db: Queryable,
  e: Engagement,
  input: {
    email: string;
    moment: string;
    score: number | null;
    words?: string | undefined;
    mayQuote?: string | undefined;
  },
): Promise<void> {
  const reached = await db
    .select()
    .from(moments)
    .where(and(eq(moments.engagementId, e.id), eq(moments.moment, input.moment)));
  if (reached.length === 0) throw missing("moment");
  if (
    input.score !== null &&
    (!Number.isInteger(input.score) || input.score < 1 || input.score > 5)
  )
    throw bad("a review is 1 to 5");
  const mayQuote = (input.mayQuote ?? "private") as QuoteConsent;
  if (!QUOTE_CONSENTS.includes(mayQuote)) throw bad(`may quote is ${QUOTE_CONSENTS.join(", ")}`);
  const words = input.words?.trim() ? textIn(input.words, "the review", 4000) : null;
  const row = { score: input.score, words, mayQuote, at: new Date(), toldAt: null };
  // Again replaces it, but only what was sent: a new star keeps the words and consent given.
  await db
    .insert(reviews)
    .values({ engagementId: e.id, moment: input.moment, email: input.email, ...row })
    .onConflictDoUpdate({
      target: [reviews.engagementId, reviews.moment, reviews.email],
      set: {
        score: row.score,
        at: row.at,
        toldAt: null,
        ...(input.words !== undefined ? { words } : {}),
        ...(input.mayQuote !== undefined ? { mayQuote } : {}),
      },
    });
}

/** A client person wants to hear about a next offer; Wren is pinged once. */
export async function recordInterest(
  db: Queryable,
  e: Engagement,
  input: { email: string; offerId: string },
): Promise<void> {
  if (!nextOffers(offerFor(e.offerId)).some((o) => o.id === input.offerId)) throw missing("offer");
  await db
    .insert(interests)
    .values({ engagementId: e.id, offerId: input.offerId, email: input.email })
    .onConflictDoNothing();
}

/** What mail a person gets about this client (D9). */
export async function setMailLevel(
  db: Queryable,
  clientId: string,
  email: string,
  level: string,
): Promise<MailLevel> {
  if (!MAIL_LEVELS.includes(level as MailLevel))
    throw bad(`mail is one of ${MAIL_LEVELS.join(", ")}`);
  const set = { level: level as MailLevel };
  await db
    .insert(memberMail)
    .values({ clientId, email, ...set })
    .onConflictDoUpdate({ target: [memberMail.clientId, memberMail.email], set });
  return set.level;
}

export async function mailLevelOf(
  db: Queryable,
  clientId: string,
  email: string,
): Promise<MailLevel> {
  const [row] = await db
    .select({ level: memberMail.level })
    .from(memberMail)
    .where(and(eq(memberMail.clientId, clientId), eq(memberMail.email, email)));
  return row?.level ?? "all";
}

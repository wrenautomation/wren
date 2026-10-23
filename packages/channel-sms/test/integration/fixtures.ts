import { companies } from "@wren/core";
import type { NotifyLevel } from "@wren/core/notify";
import { templates } from "@wren/core/schema";
import { emailRef, saveLive } from "@wren/core/templates";
import type { Db } from "@wren/db";
import { runContacts } from "@wren/research/enrichment";
import { documents } from "@wren/research/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { type LiftOptions, type LiftStats, liftPhones } from "../../src/lift.js";
import { countryOf } from "../../src/phone.js";
import { DEFAULT_POLICY, type SmsPolicy } from "../../src/policy.js";
import type { FakeProvider } from "../../src/provider.js";
import { smsNumbers } from "../../src/schema.js";
import { liveTexts, TEXTS_SYSTEM, textRef } from "../../src/template-store.js";
import { checkSequence, type SmsSequence } from "../../src/templates.js";

export const TABLES = [
  "consent_events",
  "consents",
  "topics",
  "sms_push_subscriptions",
  "operators",
  "templates",
  "template_versions",
  "sms_events",
  "sms_messages",
  "sms_contacts",
  "sms_numbers",
  "suppression_events",
  "suppressions",
  "contact_points",
  "enrichments",
  "documents",
  "people",
  "companies",
  "runs",
];

export const SEQ: SmsSequence = checkSequence({
  name: "recruiting-sms",
  steps: [
    { step: 1, afterDays: 0 },
    { step: 2, afterDays: 3 },
  ],
});
export const SEQUENCES = new Map([[SEQ.name, SEQ]]);

/** Test words for SEQ's two steps (the real ones are William's, in prod's template store). */
export const BODIES: Record<string, string> = {
  "recruiting-sms#1":
    "hi {first_name|there}, {sender} here. saw {company|your site}. reply STOP to opt out",
  "recruiting-sms#2": "{sender} again, worth a quick chat?",
};

export async function fillTemplates(
  db: Db,
  bodies: Record<string, string> = BODIES,
): Promise<void> {
  for (const [key, body] of Object.entries(bodies))
    await saveLive(db, textRef(key), body, { by: "test" });
}

/**
 * Test words for the nodes the flows ask for. Wren ships no text or email copy (the real words are
 * William's, in prod's template store), so a test that needs a node live seeds it here.
 */
export const TEXT_WORDS: Record<string, string> = {
  "follow-up#1":
    "Hi {first_name|there}, {sender} here. Still want to set up a time? Reply with a day that works.",
  "follow-up#2":
    "Hi {first_name|there}, last text from me. If now isn't the time, no problem. Reply STOP and I won't text again.",
  "form-fit#1":
    "Hi {first_name|there}, it's William from Wren Automation. Got your form. Want to grab a quick call this week? Reply with a day that works, or book here: {booking_link} Reply STOP to opt out.",
  "form-not-fit#1":
    "Hi {first_name|there}, it's William from Wren Automation. Got your form. Want to grab a quick call this week? Reply with a day that works, or book here: {booking_link} Reply STOP to opt out.",
  "missed-call-known":
    "Hi {first_name|there}, it's {sender}. Sorry we missed your call. What can we help with?",
  "missed-call-new":
    "Hi, it's {sender}. Sorry we missed your call. How can we help? Reply here. Text STOP to opt out.",
  "nurture#1":
    "Hi {first_name|there}, {sender} here. Checking in. Anything change on your end? Reply STOP to opt out.",
  "nurture#2":
    "Hi {first_name|there}, {sender} again. Happy to help when the timing's right. Just reply here. Reply STOP to opt out.",
  "review-ask":
    "Hi {first_name|there}, thanks for choosing {sender}. Would you leave us a quick Google review? {review_link} Text STOP to opt out.",
  "review-feedback": "Anything we could do better? Tell us here: {feedback_link}",
  "review-reminder":
    "Hi {first_name|there}, {sender} again. If you have a minute, a review would mean a lot: {review_link}",
};

/** Email words by `system/name`, as the flows ask for them. */
export const EMAIL_WORDS: Record<string, string> = {
  "follow/follow-up":
    "Hi {first_name|there},\n\nFollowing up on my last note. Still worth a short call? Reply with a day that works, or say no and I will stop.",
  "follow/nurture":
    "Hi {first_name|there},\n\nChecking in. If now is a better time to talk, reply and we will set something up. If not, no reply needed.",
  "forms/form-booking-no-text":
    "subject: Your form on wrenautomation.com\n\nHi {first_name|there},\n\nThanks for filling out the form. Here's my calendar, pick any time that works: {booking_link}\n\nWilliam",
  "forms/form-booking":
    "subject: Your form on wrenautomation.com\n\nHi {first_name|there},\n\nThanks for filling out the form. I just texted you too. Here's my calendar, pick any time that works: {booking_link}\n\nWilliam",
  "reviews/review-ask":
    "subject: A quick review for {sender}?\n\nHi {first_name|there},\n\nThanks for choosing {sender}. If you have a minute, would you leave us a Google review? It helps people nearby find us.\n\n{review_link}\n\nThank you,\n{sender}",
  "reviews/review-feedback": "Anything we could do better? Tell us privately here: {feedback_link}",
  "reviews/review-reminder":
    "subject: Still have a minute for {sender}?\n\nHi {first_name|there},\n\n{sender} again. If you get a minute, a short Google review would mean a lot to us.\n\n{review_link}\n\nThank you,\n{sender}",
};

/** Every text and email node live: the store as an operator who wrote all of it would leave it. */
export async function fillCopy(db: Db): Promise<void> {
  await fillTemplates(db, TEXT_WORDS);
  for (const [key, source] of Object.entries(EMAIL_WORDS)) {
    const [system, name] = key.split("/") as [string, string];
    await saveLive(db, emailRef(system, name), source, { by: "test" });
  }
}

/** Empty the given text slots (all of them by default): nothing live, so nothing sends. */
export async function emptyTemplates(db: Db, keys?: readonly string[]): Promise<void> {
  await db
    .update(templates)
    .set({ liveVersionId: null, draftVersionId: null })
    .where(
      and(
        eq(templates.kind, "sms"),
        eq(templates.system, TEXTS_SYSTEM),
        keys ? inArray(templates.name, [...keys]) : undefined,
      ),
    );
}

/** The slots with live words. */
export async function liveKeys(db: Db): Promise<string[]> {
  const rows = await db
    .select({ name: templates.name })
    .from(templates)
    .where(and(eq(templates.kind, "sms"), isNotNull(templates.liveVersionId)));
  return rows.map((r) => r.name).sort();
}

export { liveTexts };

/** Every basis on, tiny ramp, no gap: tests pick what they need. */
export const POLICY: SmsPolicy = {
  ...DEFAULT_POLICY,
  bases: ["published", "opt_in"],
  gapSeconds: 0,
};

// Tue 2026-09-29 18:00Z = 14:00 ET = 11:00 PT: open everywhere.
export const OPEN = new Date("2026-09-29T18:00:00Z");
// Tue 2026-09-29 12:30Z = 08:30 ET: shut.
export const SHUT = new Date("2026-09-29T12:30:00Z");

export async function company(
  db: Db,
  name: string,
  opts: { niche?: string; timezone?: string; html?: string; text?: string } = {},
): Promise<number> {
  const [c] = await db
    .insert(companies)
    .values({
      name,
      domain: `${name.toLowerCase().replace(/\W+/g, "")}.test`,
      niche: opts.niche ?? "agencies",
      ...(opts.timezone ? { timezone: opts.timezone } : {}),
    })
    .returning({ id: companies.id });
  const id = c?.id as number;
  if (opts.html !== undefined || opts.text !== undefined) {
    await db.insert(documents).values({
      companyId: id,
      url: `https://${name.toLowerCase().replace(/\W+/g, "")}.test/contact`,
      kind: "webpage",
      contentHash: `h-${id}`,
      text: opts.text ?? "",
      html: opts.html ?? null,
    });
  }
  return id;
}

/** The pool's `contacts` stage, then the lift: prod runs them in two loops. */
export async function lift(db: Db, opts: LiftOptions): Promise<LiftStats> {
  await runContacts(db);
  return liftPhones(db, opts);
}

/** Numbers in the pool, US ones already on the campaign unless `registered: false`. */
export async function numbers(
  db: Db,
  provider: FakeProvider,
  e164s: string[],
  rampStartedOn = "2026-09-01",
  opts: { registered?: boolean } = {},
) {
  provider.numbers = e164s.map((e164, i) => ({ e164, providerId: `n${i}` }));
  for (const e164 of e164s) {
    await db.insert(smsNumbers).values({
      e164,
      provider: "fake",
      providerId: e164,
      rampStartedOn,
      country: countryOf(e164) ?? "US",
      registeredAt: opts.registered === false ? null : new Date("2026-08-31T12:00:00Z"),
    });
  }
}

export function notes() {
  const seen: { title: string; body: string; level?: string }[] = [];
  return {
    seen,
    notifier: {
      name: "test",
      notify: async (title: string, body = "", level?: NotifyLevel) => {
        seen.push({ title, body, ...(level ? { level } : {}) });
        return true;
      },
    },
  };
}

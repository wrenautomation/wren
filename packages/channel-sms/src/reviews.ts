/**
 * Review requests (designs/2026-10-07-missed-call-and-reviews.md). Every customer is asked: a
 * deal won, an appointment done, an invoice paid through the door, or one added by hand. Nobody
 * is filtered by how happy they seem. The text carries a counted link (`/r/<client>/<token>` on
 * the phone Worker) that goes on to the client's Google review form; one reminder follows after
 * the wire's wait unless the link was opened. An optional private feedback form is offered to
 * everyone in the same text, never in place of the review link.
 *
 * By email: the same counted link, reminder and feedback line, mailed from portal@ under the
 * client's name, with a fixed line (and `List-Unsubscribe`) that stops them. `via` picks the
 * first channel; a customer with only the other is asked on that one.
 *
 * Off switches as for every text: with `WREN_SMS_LIVE`, the client's texts or its sends off, a
 * text ask records "would send" and nothing is queued. An email ask waits only on the client's
 * sends and a mailer here.
 */
import { randomBytes } from "node:crypto";
import { activeSuppressionOf, addSuppression } from "@wren/core";
import { leadOf } from "@wren/core/door";
import { linkPeople } from "@wren/core/leads";
import { accountFacts, clientAccounts } from "@wren/core/setup-schema";
import { factKeys, renderKind } from "@wren/core/slots";
import type { SpineEvent, Step } from "@wren/core/spine";
import type { TemplateRef } from "@wren/core/templates";
import { liveOrDefault } from "@wren/core/templates/defaults";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { countryOf, toPhoneE164 } from "./phone.js";
import { pickNumber } from "./pool.js";
import {
  type AnswerState,
  type ReviewAsk,
  type ReviewSource,
  type ReviewVia,
  reviewAsks,
  smsContacts,
  smsMessages,
} from "./schema.js";
import { reviewUrl } from "./setups.js";
import { fieldsFor, textRef } from "./template-store.js";
import { firstName, render, textSeed } from "./templates.js";

export const REVIEW_ASK = "review-ask";
export const REVIEW_REMINDER = "review-reminder";
export const REVIEW_FEEDBACK = "review-feedback";

/** Where the counted links live: the phone Worker. */
export const LINK_ORIGIN = "https://phone.wrenautomation.com";

/** Thread states no ask goes to. */
const ENDED = new Set(["opted_out", "unreachable", "stopped"]);

/** One ask per person in this many days, unless the client's setting says otherwise. */
export const ONCE_EVERY_DAYS = 90;

/** The counted link a text carries: the click is counted, then Google's form opens. */
export const reviewLink = (origin: string, client: string, token: string) =>
  `${origin}/r/${encodeURIComponent(client)}/${token}`;
export const feedbackLink = (origin: string, client: string, token: string) =>
  `${reviewLink(origin, client, token)}/feedback`;
/** An email's stop link: a page with one button, and the `List-Unsubscribe` one-click target. */
export const stopLink = (origin: string, client: string, token: string) =>
  `${reviewLink(origin, client, token)}/stop`;

/** The email copy's place in the template store: kind email, system `reviews`, same keys. */
export const REVIEW_EMAILS = "reviews";
export const reviewEmailRef = (key: string): TemplateRef => ({
  kind: "email",
  system: REVIEW_EMAILS,
  name: key,
});

/** Plain mail from portal@ under the client's name (the worker's `bookerMailer`). */
export type SendMail = (m: {
  to: string;
  subject: string;
  text: string;
  headers?: readonly (readonly [string, string])[];
}) => Promise<void>;

/** How an email ask goes: `send` null means no mailer here; `why` set means it may not go now. */
export interface MailOptions {
  send: SendMail | null;
  why: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** An address trimmed and lowercased, or null when it isn't one. */
export const cleanEmail = (raw: string | null | undefined): string | null => {
  const e = raw?.trim().toLowerCase() ?? "";
  return EMAIL.test(e) && e.length <= 254 ? e : null;
};

/** The channel an ask goes on: the one `via` names, else the one they have. */
export function channelOf(via: ReviewVia, phone: string | null, email: string | null) {
  if (via === "email") return email ? "email" : phone ? "text" : null;
  return phone ? "text" : email ? "email" : null;
}

/** 22 url-safe random characters. It only counts a click and opens a public page: kept plain. */
export const newToken = () => randomBytes(16).toString("base64url");

/** Who to ask and why: the customer's facts as they arrived. */
export interface Customer {
  subject: string;
  source: ReviewSource;
  name: string | null;
  phone: string | null;
  email: string | null;
  zone: string | null;
}

export interface AskOptions {
  /** `WREN_SMS_LIVE`, the client's texts and its sends all on. */
  live: boolean;
  why: string | null;
  senderName: string;
  /** The client's Google Place ID; null until the setup found it. */
  placeId: string | null;
  /** The first channel to ask on; a customer with only the other is asked there. */
  via: ReviewVia;
  /** The email side: portal@ under the client's name. */
  mail: MailOptions;
  /** Add the private feedback line to every ask. */
  feedback: boolean;
  onceEvery: number;
  client: string;
  origin: string;
  now: Date;
}

/** The customer read from a spine event: a door's lead, or a call's name and email. */
export function customerOf(e: SpineEvent, source: ReviewSource): Customer {
  const lead = (e.data.lead as ReturnType<typeof leadOf> | undefined) ?? leadOf(e.data);
  return {
    subject: e.subject.slice(0, 200),
    source,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    zone: lead.zone,
  };
}

/** The customer's text thread: by phone, else one under their email. Running ones first. */
async function threadOf(db: Queryable, e164: string | null, email: string | null) {
  const by = [
    ...(e164 ? [eq(smsContacts.e164, e164)] : []),
    ...(email ? [sql`lower(${smsContacts.email}) = ${email.toLowerCase()}`] : []),
  ];
  if (!by.length) return null;
  const [row] = await db
    .select()
    .from(smsContacts)
    .where(or(...by))
    .orderBy(
      sql`CASE WHEN ${smsContacts.state} = 'enrolled' THEN 0 ELSE 1 END`,
      desc(smsContacts.id),
    )
    .limit(1);
  return row ?? null;
}

/** The words of an ask or a reminder for one contact, the feedback line after when it's on. */
async function wordsFor(
  db: Queryable,
  key: string,
  contact: Parameters<typeof fieldsFor>[1] & { id: number },
  links: { review: string; feedback: string | null },
  senderName: string,
) {
  const words = await liveOrDefault(db, textRef(key));
  if (!words) return null;
  const fields = {
    ...(await fieldsFor(db, contact, senderName)),
    review_link: links.review,
    feedback_link: links.feedback,
  };
  const text = render(words.template, fields, textSeed(contact.id));
  if (!links.feedback) return text;
  const more = await liveOrDefault(db, textRef(REVIEW_FEEDBACK));
  if (!more) return text;
  return {
    ...text,
    body: `${text.body} ${render(more.template, fields, textSeed(contact.id)).body}`,
  };
}

/**
 * Ask one customer, once per subject: the row is made first, so every way it doesn't go is kept
 * on it (`ask`, `ask_detail`). A retry finds the row and changes nothing.
 */
export async function askReview(db: Db, c: Customer, o: AskOptions): Promise<ReviewAsk> {
  const [have] = await db.select().from(reviewAsks).where(eq(reviewAsks.subject, c.subject));
  // A queued email that never went (its send failed): the retry sends it.
  if (have?.via === "email" && have.ask === "queued" && !have.sentAt) return mailAsk(db, have, o);
  if (have) return have;
  const email = cleanEmail(c.email);
  const e164 = c.phone ? toPhoneE164(c.phone) : null;
  const thread = await threadOf(db, e164, email);
  const to = e164 ?? thread?.e164 ?? null;
  const via = channelOf(o.via, to, email);
  const row = async (ask: AnswerState, detail: string | null, contactId: number | null) => {
    const [made] = await db
      .insert(reviewAsks)
      .values({
        subject: c.subject,
        source: c.source,
        name: c.name,
        phone: c.phone?.slice(0, 64) ?? null,
        e164: to,
        email,
        via: via ?? o.via,
        token: newToken(),
        placeId: o.placeId,
        contactId,
        ask,
        askAt: o.now,
        askDetail: detail,
      })
      .onConflictDoNothing()
      .returning();
    if (made) return made;
    const [again] = await db.select().from(reviewAsks).where(eq(reviewAsks.subject, c.subject));
    return again as ReviewAsk;
  };
  if (!o.placeId) return row("refused", "no Google review link yet", null);
  if (!via) return row("skipped", "no phone number or email", null);
  if (via === "email" && email && (await activeSuppressionOf(db, "email", email)))
    return row("refused", "the email opted out", null);
  if (via === "text" && to && (await activeSuppressionOf(db, "phone", to)))
    return row("refused", "the phone opted out", null);
  const same = [
    ...(to ? [eq(reviewAsks.e164, to)] : []),
    ...(email ? [eq(reviewAsks.email, email)] : []),
  ];
  const [recent] = await db
    .select({ at: reviewAsks.askAt })
    .from(reviewAsks)
    .where(
      and(
        or(...same),
        ne(reviewAsks.subject, c.subject),
        inArray(reviewAsks.ask, ["queued", "would_send"]),
        gt(reviewAsks.askAt, new Date(o.now.getTime() - o.onceEvery * 86_400_000)),
      ),
    )
    .limit(1);
  if (recent) return row("skipped", `asked on ${recent.at.toISOString().slice(0, 10)}`, null);
  if (via === "email") {
    const off = mailOff(o);
    if (off) return row("would_send", off, thread?.id ?? null);
    const asked = await row("queued", null, thread?.id ?? null);
    if (asked.ask !== "queued" || asked.via !== "email" || asked.sentAt) return asked;
    return mailAsk(db, asked, o);
  }
  if (!to) throw new Error(`no phone for ${c.subject}`);
  if (thread && ENDED.has(thread.state))
    return row("refused", `their texts ended: ${thread.state}`, thread.id);
  if (!o.live) return row("would_send", o.why ?? "texts are off", thread?.id ?? null);
  let contact = thread;
  if (!contact) {
    const country = countryOf(to);
    const number = country ? await pickNumber(db, country) : null;
    if (!number) return row("refused", "no texting number for their country", null);
    const [made] = await db
      .insert(smsContacts)
      .values({
        e164: to,
        name: c.name,
        email: c.email,
        sourceKind: "customer",
        sourceRef: c.subject.slice(0, 64),
        basis: "opt_in",
        basisDetail: `a customer: ${c.source}`,
        numberId: number.id,
        zone: c.zone,
      })
      .onConflictDoNothing()
      .returning();
    contact = made ?? (await threadOf(db, to, null));
    if (!contact) throw new Error(`no contact for ${c.subject}`);
    await linkPeople(db, "sms_contacts", [contact.id]);
  }
  if (!contact.numberId) return row("refused", "no number of ours on their thread", contact.id);
  const asked = await row("queued", null, contact.id);
  if (asked.ask !== "queued" || asked.contactId !== contact.id) return asked;
  const text = await wordsFor(
    db,
    REVIEW_ASK,
    contact,
    {
      review: reviewLink(o.origin, o.client, asked.token),
      feedback: o.feedback ? feedbackLink(o.origin, o.client, asked.token) : null,
    },
    o.senderName,
  );
  if (!text) {
    const [r] = await db
      .update(reviewAsks)
      .set({ ask: "refused", askDetail: `template ${REVIEW_ASK} is empty` })
      .where(eq(reviewAsks.id, asked.id))
      .returning();
    return r as ReviewAsk;
  }
  await db
    .insert(smsMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: "review",
      template: REVIEW_ASK,
      templateVersion: text.provenance.version,
      provenance: text.provenance,
      ref: `review:${asked.id}`,
      numberId: contact.numberId,
      toE164: contact.e164,
      body: text.body,
      state: "queued",
      dueAt: o.now,
    })
    .onConflictDoNothing();
  return asked;
}

/** The one reminder: only after a queued ask whose link nobody opened. */
export async function remindReview(
  db: Db,
  id: number,
  o: Pick<
    AskOptions,
    "live" | "why" | "senderName" | "feedback" | "client" | "origin" | "now" | "mail"
  >,
): Promise<ReviewAsk> {
  const [a] = await db.select().from(reviewAsks).where(eq(reviewAsks.id, id));
  if (!a) throw new Error(`no review ask ${id}`);
  if (a.reminder !== null) return a;
  const done = async (state: AnswerState, detail: string | null) => {
    const [r] = await db
      .update(reviewAsks)
      .set({ reminder: state, reminderAt: o.now, reminderDetail: detail })
      .where(and(eq(reviewAsks.id, id), sql`${reviewAsks.reminder} IS NULL`))
      .returning();
    return r ?? ((await db.select().from(reviewAsks).where(eq(reviewAsks.id, id)))[0] as ReviewAsk);
  };
  if (a.ask !== "queued") return done("skipped", "the ask didn't go");
  if (a.clicks > 0) return done("skipped", "they opened the link");
  if (a.via === "email") {
    if (!a.email) return done("skipped", "no email");
    if (await activeSuppressionOf(db, "email", a.email))
      return done("refused", "the email opted out");
    const off = mailOff(o);
    if (off) return done("would_send", off);
    const why = await mailTo(db, a, REVIEW_REMINDER, o);
    return why ? done("refused", why) : done("queued", null);
  }
  if (!a.contactId) return done("skipped", "no text thread");
  const [c] = await db.select().from(smsContacts).where(eq(smsContacts.id, a.contactId));
  if (!c?.numberId) return done("skipped", "no text thread");
  if (ENDED.has(c.state)) return done("refused", `their texts ended: ${c.state}`);
  if (await activeSuppressionOf(db, "phone", c.e164)) return done("refused", "the phone opted out");
  if (!o.live) return done("would_send", o.why ?? "texts are off");
  const text = await wordsFor(
    db,
    REVIEW_REMINDER,
    c,
    {
      review: reviewLink(o.origin, o.client, a.token),
      feedback: o.feedback ? feedbackLink(o.origin, o.client, a.token) : null,
    },
    o.senderName,
  );
  if (!text) return done("refused", `template ${REVIEW_REMINDER} is empty`);
  await db
    .insert(smsMessages)
    .values({
      contactId: c.id,
      direction: "out",
      kind: "review",
      template: REVIEW_REMINDER,
      templateVersion: text.provenance.version,
      provenance: text.provenance,
      ref: `review:${a.id}:2`,
      numberId: c.numberId,
      toE164: c.e164,
      body: text.body,
      state: "queued",
      dueAt: o.now,
    })
    .onConflictDoNothing();
  return done("queued", null);
}

/** Why an email may not go now, or null. */
const mailOff = (o: Pick<AskOptions, "mail">): string | null =>
  o.mail.why ?? (o.mail.send ? null : "no mailer here: WREN_PORTAL_FROM is unset");

type MailOpts = Pick<AskOptions, "senderName" | "feedback" | "client" | "origin" | "mail">;

/**
 * One review email to an ask's address: the template's words, the feedback line when it's on,
 * then the fixed stop line. Null once it went; why not when the copy can't go. A failed send
 * throws, so the step retries.
 */
async function mailTo(db: Queryable, a: ReviewAsk, key: string, o: MailOpts) {
  const send = o.mail.send;
  if (!send || !a.email) return "no mailer here";
  const words = await liveOrDefault(db, reviewEmailRef(key));
  if (!words) return `email template ${key} is empty`;
  if (!factKeys(words.template).has("review_link"))
    return `email template ${key} has no {review_link}`;
  const stop = stopLink(o.origin, o.client, a.token);
  const fields = {
    first_name: firstName(a.name),
    sender: o.senderName,
    review_link: reviewLink(o.origin, o.client, a.token),
    feedback_link: o.feedback ? feedbackLink(o.origin, o.client, a.token) : null,
  };
  const seed = `review:${a.id}`;
  const out = renderKind("email", words.template, fields, seed);
  const parts = [out.body];
  if (o.feedback) {
    const more = await liveOrDefault(db, reviewEmailRef(REVIEW_FEEDBACK));
    if (more) parts.push(renderKind("email", more.template, fields, seed).body);
  }
  parts.push(`--\nDon't want these emails from ${o.senderName}? ${stop}`);
  await send({
    to: a.email,
    subject: out.subject ?? `A review for ${o.senderName}`,
    text: parts.join("\n\n"),
    headers: [
      ["List-Unsubscribe", `<${stop}>`],
      ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
    ],
  });
  return null;
}

/** The ask's email: sent and stamped, or refused with why. */
async function mailAsk(db: Db, a: ReviewAsk, o: MailOpts & Pick<AskOptions, "now">) {
  const why = await mailTo(db, a, REVIEW_ASK, o);
  const [r] = await db
    .update(reviewAsks)
    .set(why ? { ask: "refused", askDetail: why } : { sentAt: o.now })
    .where(eq(reviewAsks.id, a.id))
    .returning();
  return r as ReviewAsk;
}

/**
 * A click on a counted link: counted, and where it goes. Null for a token we never gave, or an
 * ask with no Place ID (nothing to open).
 */
export async function clickReview(db: Queryable, token: string, now: Date) {
  const [a] = await db
    .update(reviewAsks)
    .set({
      clicks: sql`${reviewAsks.clicks} + 1`,
      clickedAt: sql`coalesce(${reviewAsks.clickedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(eq(reviewAsks.token, token))
    .returning({ placeId: reviewAsks.placeId });
  return a?.placeId ? reviewUrl(a.placeId) : null;
}

/** The private feedback form's words, kept on the ask. False for a token we never gave. */
export async function saveFeedback(db: Queryable, token: string, words: string, now: Date) {
  const [a] = await db
    .update(reviewAsks)
    .set({ feedback: words.trim().slice(0, 4000), feedbackAt: now })
    .where(eq(reviewAsks.token, token))
    .returning({ id: reviewAsks.id });
  return !!a;
}

/**
 * The stop link of a review email: the address is suppressed in the client's database, so no
 * ask, reminder or other mail of theirs reaches it. False for a token we never gave.
 */
export async function stopReview(db: Queryable, token: string, now: Date) {
  const [a] = await db.select().from(reviewAsks).where(eq(reviewAsks.token, token));
  if (!a) return false;
  if (a.email)
    await addSuppression(db, {
      kind: "email",
      value: a.email,
      reason: "opt_out",
      evidence: { source: "review email", ask: a.id, at: now.toISOString() },
    });
  return true;
}

/** What the step needs for one client's asks. */
export type ReviewDeps = Omit<AskOptions, "now" | "client"> & {
  db: Db;
  nudge: (idempotencyKey: string) => Promise<void>;
};

/** The source an event's subject says: a call's outcome, by hand, else the door. */
export function sourceOf(e: SpineEvent): ReviewSource {
  const s = e.data.source;
  if (s === "won" || s === "done" || s === "paid" || s === "hand") return s;
  return "door";
}

/**
 * `reviews.ask` on the spine. The ask node (round 1) asks; the remind node (`with.round` 2)
 * reminds the same ask after its wire's wait. `asked` carries on only a queued ask, as
 * `review:<id>`; the rest leave by `unasked`.
 */
export const reviewStep =
  (depsFor: (client: string) => Promise<ReviewDeps>): Step =>
  async (_port, e, at) => {
    if (at.client === null) throw new Error("review requests are per client");
    const { db, nudge, ...o } = await depsFor(at.client);
    const now = new Date();
    if (Number(at.with.round) === 2) {
      const id = Number(e.data.review);
      if (!Number.isInteger(id)) throw new Error(`${e.subject} is no review ask`);
      const r = await remindReview(db, id, { ...o, client: at.client, now });
      if (r.reminder === "queued" && r.via === "text") await nudge(`review:${at.workflow}:${id}:2`);
      const data = { ...e.data, reminder: r.reminder, why: r.reminderDetail };
      return [{ port: r.reminder === "queued" ? "asked" : "unasked", event: { ...e, data } }];
    }
    const a = await askReview(db, customerOf(e, sourceOf(e)), { ...o, client: at.client, now });
    const data = { ...e.data, review: a.id, ask: a.ask, via: a.via, why: a.askDetail };
    if (a.ask !== "queued") return [{ port: "unasked", event: { ...e, data } }];
    if (a.via === "text") await nudge(`review:${at.workflow}:${a.id}`);
    return [{ port: "asked", event: { subject: `review:${a.id}`, kind: "lead", data } }];
  };

/** The client's Place ID: its Google Business account whose review link the setup found. */
export async function placeIdOf(main: Queryable, client: string): Promise<string | null> {
  const [row] = await main
    .select({ ref: clientAccounts.ref })
    .from(clientAccounts)
    .innerJoin(accountFacts, eq(accountFacts.accountId, clientAccounts.id))
    .where(
      and(
        eq(clientAccounts.client, client),
        eq(clientAccounts.site, "google_business"),
        eq(accountFacts.fact, "google_business.place_id"),
        eq(accountFacts.state, "ok"),
      ),
    )
    .limit(1);
  return row?.ref ?? null;
}

/** A review ask by hand: its subject, one per press. */
export const handSubject = (id: string) => `hand:${id}`;

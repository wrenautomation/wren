/**
 * Texts for people who asked on the site. The lander's form has an unticked
 * texts box; an application with it ticked and a phone becomes an `opt_in`
 * contact here, read from the lander's export on every SmsWatch pass.
 *
 * The first text waits FIRST_TEXT_AFTER_MS, so the applicant has time to book
 * from the page; a booking under their email ends the thread before anything
 * is sent. Fits and the rest get different texts (`form-fit`,
 * `form-not-fit`), each empty until William writes it, and an empty one sends
 * nothing. An application older than FIRST_TEXT_WITHIN_MS still becomes a
 * contact (the consent record) but gets no first text.
 *
 * Every pass reads the site, but the booking check and the text happen only
 * inside the texting window, so the check is minutes before the text, never a
 * weekend before it. Every application is handled once: a form contact never
 * stays `new` past its first in-window pass, except on a lookup or
 * booking-check error, which the next pass retries.
 */
import { linkPeople } from "@wren/core/leads";
import type { Db, Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import type { Bookings } from "./bookings.js";
import { enroll } from "./enroll.js";
import { countryOf, toPhoneE164 } from "./phone.js";
import { inWindow, type SmsPolicy } from "./policy.js";
import type { SmsProvider } from "./provider.js";
import { type SmsContact, smsContacts } from "./schema.js";
import { liveTexts } from "./template-store.js";
import { type SmsSequence, stepKey } from "./templates.js";

export const FIRST_TEXT_AFTER_MS = 20 * 60 * 1000;
// Long enough for a Friday-evening applicant to hear back on Monday.
export const FIRST_TEXT_WITHIN_MS = 4 * 86_400_000;
const PAGE = 500;
const MAX_PAGES = 20;

const FIRST_GOES =
  "Half an hour after they apply on the site with the texts box ticked; none if they booked a call by then";

export const FORM_FIT = "form-fit";
export const FORM_NOT_FIT = "form-not-fit";

/** Core sequences, registered next to every niche's (niches/src/index.ts). */
export const FORM_SEQUENCES: readonly SmsSequence[] = [
  {
    name: FORM_FIT,
    label: "Applicant who fits",
    steps: [{ step: 1, afterDays: 0 }],
    firstGoes: FIRST_GOES,
    fields: ["first_name", "sender"],
  },
  {
    name: FORM_NOT_FIT,
    label: "Applicant who doesn't fit",
    steps: [{ step: 1, afterDays: 0 }],
    firstGoes: FIRST_GOES,
    fields: ["first_name", "sender"],
  },
];

/** The lander's export (`/api/export?table=applications`), bearer `WREN_SITE_EXPORT_TOKEN`. */
export interface SiteSource {
  baseUrl: string;
  exportToken: string;
  fetch?: typeof fetch;
}

/** The columns of one lander application this reads. */
export interface FormApplication {
  id: number;
  ts: string;
  offer: string;
  name: string | null;
  email: string;
  phone: string | null;
  sms_consent: number;
  fit: number;
  page: string;
}

export async function readApplications(
  site: SiteSource,
  since: number,
): Promise<FormApplication[]> {
  const fetchImpl = site.fetch ?? globalThis.fetch;
  const out: FormApplication[] = [];
  let after = since;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${site.baseUrl.replace(/\/+$/, "")}/api/export`);
    url.searchParams.set("table", "applications");
    url.searchParams.set("since", String(after));
    url.searchParams.set("limit", String(PAGE));
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${site.exportToken}` } });
    // Named without either value: the token never reaches a log line.
    if (res.status === 401)
      throw new Error(
        "the site refused WREN_SITE_EXPORT_TOKEN (must equal the lander's EXPORT_TOKEN)",
      );
    if (res.status !== 200) throw new Error(`the site's export answered ${res.status}`);
    const rows = ((await res.json()) as { applications?: unknown }).applications;
    if (!Array.isArray(rows)) throw new Error("the site's export has no applications");
    out.push(...(rows as FormApplication[]));
    if (rows.length < PAGE) return out;
    after = (rows[rows.length - 1] as FormApplication).id;
  }
  throw new Error(`more than ${PAGE * MAX_PAGES} new applications in one pass`);
}

export interface FormStats {
  /** Applications read past the cursor. */
  read: number;
  /** New contacts: ticked the box and gave a US or Canadian phone. */
  added: number;
  texted: number;
  booked: number;
  /** Their template was empty: nothing sent. */
  empty: number;
  tooOld: number;
  /** Ended without a text for another reason (landline, opted out, no number, a running thread). */
  ended: number;
  /** Too fresh: their first text waits for a later pass. */
  waiting: number;
  /** Outside the texting window: applicants recorded, nobody checked or texted. */
  outOfWindow: boolean;
  errors: string[];
}

export interface FormOptions {
  site: SiteSource;
  /** Null = no booking check: everyone due gets their first text. */
  bookings: Bookings | null;
  sequences: ReadonlyMap<string, SmsSequence>;
  policy: SmsPolicy;
  provider: SmsProvider;
  senderName: string;
  heldNiches: readonly string[];
  now: Date;
  runId?: string | null;
}

/** Read from the oldest form contact still `new` (a retry), else after the newest. */
async function cursor(db: Queryable): Promise<number> {
  const [row] = await db
    .select({
      since: sql<number>`coalesce(min((${smsContacts.sourceRef})::int) filter (where ${smsContacts.state} = 'new') - 1, max((${smsContacts.sourceRef})::int), 0)`,
    })
    .from(smsContacts)
    .where(eq(smsContacts.sourceKind, "form"));
  return Number(row?.since ?? 0);
}

async function formContact(
  db: Queryable,
  app: FormApplication,
  e164: string,
  baseUrl: string,
): Promise<{ contact: SmsContact; created: boolean }> {
  const site = new URL(baseUrl);
  const [made] = await db
    .insert(smsContacts)
    .values({
      e164,
      sourceKind: "form",
      sourceRef: String(app.id),
      sourceUrl: new URL(app.page || "/", site).toString(),
      basis: "opt_in",
      basisDetail: `ticked the texts box on ${site.host}${app.page || "/"} at ${app.ts} (application ${app.id}, offer ${app.offer})`,
      name: app.name?.trim() || null,
      email: app.email,
    })
    .onConflictDoNothing()
    .returning();
  if (made) {
    // An applicant who's a lead already gets their person, for the copy and the other channels.
    if (!(await linkPeople(db, "sms_contacts", [made.id]))) return { contact: made, created: true };
    const [linked] = await db.select().from(smsContacts).where(eq(smsContacts.id, made.id));
    return { contact: linked as SmsContact, created: true };
  }
  const [have] = await db
    .select()
    .from(smsContacts)
    .where(and(eq(smsContacts.sourceKind, "form"), eq(smsContacts.sourceRef, String(app.id))));
  return { contact: have as SmsContact, created: false };
}

async function finish(db: Queryable, contactId: number, reason: string, now: Date) {
  await db
    .update(smsContacts)
    .set({ state: "finished", stateReason: reason, endedAt: now })
    .where(and(eq(smsContacts.id, contactId), eq(smsContacts.state, "new")));
}

export async function followUpForms(db: Db, opts: FormOptions): Promise<FormStats> {
  const stats: FormStats = {
    read: 0,
    added: 0,
    texted: 0,
    booked: 0,
    empty: 0,
    tooOld: 0,
    ended: 0,
    waiting: 0,
    outOfWindow: false,
    errors: [],
  };
  // No company, so no time zone: texts go inside the window on both US coasts. The site
  // is read every pass anyway, so applicants show up (and a broken read shows) at once.
  stats.outOfWindow = !inWindow(null, opts.now, opts.policy);
  const apps = await readApplications(opts.site, await cursor(db));
  stats.read = apps.length;
  for (const app of apps) {
    const e164 = app.sms_consent === 1 && app.phone ? toPhoneE164(app.phone) : null;
    if (!e164) continue;
    const age = opts.now.getTime() - Date.parse(app.ts);
    // Oldest first: once one is too fresh, the rest are too.
    if (age < FIRST_TEXT_AFTER_MS) {
      stats.waiting = apps.filter((a) => a.id >= app.id && a.sms_consent === 1 && a.phone).length;
      break;
    }
    const { contact, created } = await formContact(db, app, e164, opts.site.baseUrl);
    if (created) stats.added += 1;
    if (contact.state !== "new") continue;
    if (age > FIRST_TEXT_WITHIN_MS) {
      await finish(
        db,
        contact.id,
        `applied ${app.ts.slice(0, 10)}: too long ago for a first text`,
        opts.now,
      );
      stats.tooOld += 1;
      continue;
    }
    // Asked about bookings at text time, not before.
    if (stats.outOfWindow) continue;
    if (opts.bookings) {
      let booked: boolean;
      try {
        booked = await opts.bookings.booked(app.email);
      } catch (err) {
        // Not knowing is not "no": a text to someone who booked is the mistake this check exists for.
        stats.errors.push(
          `application ${app.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      if (booked) {
        await finish(
          db,
          contact.id,
          `booked a call on ${opts.bookings.name} before the first text`,
          opts.now,
        );
        stats.booked += 1;
        continue;
      }
    }
    const name = app.fit === 1 ? FORM_FIT : FORM_NOT_FIT;
    const sequence = opts.sequences.get(name);
    if (!sequence) throw new Error(`sms sequence ${name} is not registered`);
    const key = stepKey(name, 1);
    if (!(await liveTexts(db, [key])).has(key)) {
      await finish(db, contact.id, `template ${key} was empty: nothing sent`, opts.now);
      stats.empty += 1;
      continue;
    }
    const got = await enroll(db, {
      sequence,
      contactIds: [contact.id],
      policy: opts.policy,
      provider: opts.provider,
      senderName: opts.senderName,
      heldNiches: opts.heldNiches,
      limit: 1,
      now: opts.now,
      runId: opts.runId ?? null,
    });
    if (got.enrolled === 1) {
      stats.texted += 1;
      continue;
    }
    if (got.lookupErrors.length > 0) {
      stats.errors.push(...got.lookupErrors);
      continue;
    }
    // Enroll ended it (landline, opted out) or left it: say why it stops here.
    const why =
      got.considered === 0
        ? `the policy does not text ${contact.basis} contacts (WREN_SMS_BASES)`
        : got.noNumber
          ? `no pool number texts ${countryOf(e164)} phones`
          : got.companyBusy > 0
            ? "this phone is already in a running thread"
            : null;
    if (why) await finish(db, contact.id, why, opts.now);
    stats.ended += 1;
  }
  return stats;
}

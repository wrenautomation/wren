/**
 * Texts for people who asked on the site. The lander's form has an unticked texts box; an
 * application with it ticked and a phone becomes an `opt_in` contact here and gets its first
 * text about two minutes later, inside the texting window on their own clock (their number's
 * country names the zone; the US and Canada must be open on both coasts). Outside the window it
 * goes when the window next opens. An email with the booking link follows a few minutes after
 * the text (form-after.ts), then `follow-up#1` on day 1 and `follow-up#2` two days after that,
 * stopping on a reply, a booking or STOP (follow.ts).
 *
 * Two ways in, one step (`formStep`). The lander pushes each application through the phone
 * Worker (`SmsForms/applied`), which runs the step at once and again when the text is due. The
 * SmsWatch pass (`followUpForms`) reads the lander's export every 30 minutes as the net under
 * the push. A booking under their email ends the thread before anything is sent; fits and the
 * rest get different texts (`form-fit`, `form-not-fit`), and an empty one sends nothing. The
 * phone may be in any country `WREN_SMS_FORM_COUNTRIES` lists; cold texts stay US and Canada.
 *
 * Every application has a speed run (`site.forms`, `site:applications:<id>`): when the first
 * text was due and left, the email, and why not when it didn't. An applicant who ticked the box
 * but got no text 10 minutes after it was due gets one notice saying why (form-after.ts).
 *
 * Texts start with the first pass after this ships: when no run exists yet, the pass records
 * every application already on the site as before its time and texts none of them.
 */
import { linkPeople } from "@wren/core/leads";
import { noteContacts } from "@wren/core/profiles-backfill";
import type { Db, Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import type { Bookings } from "./bookings.js";
import { enroll } from "./enroll.js";
import { bookedRun } from "./follow.js";
import { phoneCountry, toPhoneE164, zoneOfPhone } from "./phone.js";
import { nextOpen, policyFor, type SmsPolicy } from "./policy.js";
import type { SmsProvider } from "./provider.js";
import {
  type FirstTouch,
  PHONE_COUNTRIES,
  type SmsContact,
  type SpeedRun,
  smsContacts,
  speedRuns,
} from "./schema.js";
import { liveTexts } from "./template-store.js";
import { type SmsSequence, stepTemplate } from "./templates.js";

/** Long enough to book from the page they're on; short enough to be the first thing they hear. */
export const FIRST_TEXT_AFTER_MS = 2 * 60 * 1000;
// Long enough for a Friday-evening applicant to hear back on Monday.
export const FIRST_TEXT_WITHIN_MS = 4 * 86_400_000;
const PAGE = 500;
const MAX_PAGES = 20;

/** The speed run's workflow for a site application. */
export const FORM_WORKFLOW = "site.forms";
export const formSubject = (id: number) => `site:applications:${id}`;

const FIRST_GOES =
  "Two minutes after they apply on the site with the texts box ticked, in texting hours on their clock; none if they booked a call by then";

export const FORM_FIT = "form-fit";
export const FORM_NOT_FIT = "form-not-fit";

/** After the first text: the Follow-up's two texts, on day 1 and day 3. */
const FOLLOW_STEPS = [
  { step: 2, afterDays: 1, template: "follow-up#1" },
  { step: 3, afterDays: 2, template: "follow-up#2" },
] as const;

/** Core sequences, registered next to every niche's (niches/src/index.ts). */
export const FORM_SEQUENCES: readonly SmsSequence[] = [
  {
    name: FORM_FIT,
    label: "Applicant who fits",
    steps: [{ step: 1, afterDays: 0 }, ...FOLLOW_STEPS],
    firstGoes: FIRST_GOES,
    fields: ["first_name", "sender", "booking_link"],
  },
  {
    name: FORM_NOT_FIT,
    label: "Applicant who doesn't fit",
    steps: [{ step: 1, afterDays: 0 }, ...FOLLOW_STEPS],
    firstGoes: FIRST_GOES,
    fields: ["first_name", "sender", "booking_link"],
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

async function readPage(site: SiteSource, since: number, limit: number) {
  const fetchImpl = site.fetch ?? globalThis.fetch;
  const url = new URL(`${site.baseUrl.replace(/\/+$/, "")}/api/export`);
  url.searchParams.set("table", "applications");
  url.searchParams.set("since", String(since));
  url.searchParams.set("limit", String(limit));
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${site.exportToken}` } });
  // Named without either value: the token never reaches a log line.
  if (res.status === 401)
    throw new Error(
      "the site refused WREN_SITE_EXPORT_TOKEN (must equal the lander's EXPORT_TOKEN)",
    );
  if (res.status !== 200) throw new Error(`the site's export answered ${res.status}`);
  const rows = ((await res.json()) as { applications?: unknown }).applications;
  if (!Array.isArray(rows)) throw new Error("the site's export has no applications");
  return rows as FormApplication[];
}

export async function readApplications(
  site: SiteSource,
  since: number,
): Promise<FormApplication[]> {
  const out: FormApplication[] = [];
  let after = since;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await readPage(site, after, PAGE);
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = (rows[rows.length - 1] as FormApplication).id;
  }
  throw new Error(`more than ${PAGE * MAX_PAGES} new applications in one pass`);
}

/** One application by id, as the push names it; null when the site has none by that id. */
export async function readApplication(
  site: SiteSource,
  id: number,
): Promise<FormApplication | null> {
  const [row] = await readPage(site, id - 1, 1);
  return row?.id === id ? row : null;
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
  /** Countries an applicant's phone may be in (`WREN_SMS_FORM_COUNTRIES`); unset = US and Canada. */
  countries?: readonly string[];
  now: Date;
  runId?: string | null;
}

/** What one application came to on this run of its step. */
export type FormOutcome =
  /** Didn't tick the box, or gave no phone. */
  | { kind: "no_consent" }
  /** Ticked it, but the phone is no number we text (`why` says which). */
  | { kind: "no_phone"; why: string }
  /** Settled before this run: texted, ended or recorded as before texts were on. */
  | { kind: "done" }
  /** Its first text is due at `due`: run the step again then. */
  | { kind: "waiting"; due: Date }
  | { kind: "texted"; contactId: number }
  | { kind: "booked" }
  /** Ended without a text: too old, an empty template, a landline, no number. */
  | { kind: "ended"; why: string }
  /** A lookup or the booking check failed: the next run retries. */
  | { kind: "error"; why: string };

/** The run of an application, made once; a second call finds the first. */
async function runOf(
  db: Queryable,
  app: FormApplication,
  touch: FirstTouch,
  set: { e164?: string | null; zone?: string | null; detail?: string | null; due?: Date | null },
): Promise<SpeedRun> {
  const consent = app.sms_consent === 1;
  const [made] = await db
    .insert(speedRuns)
    .values({
      workflow: FORM_WORKFLOW,
      subject: formSubject(app.id),
      leadAt: new Date(app.ts),
      name: app.name?.trim() || null,
      phone: app.phone?.slice(0, 64) || null,
      e164: set.e164 ?? null,
      email: app.email,
      source: `site ${app.page || "/"}`,
      consent,
      consentDetail: consent ? `ticked the texts box (application ${app.id})` : null,
      zone: set.zone ?? null,
      firstTouch: touch,
      firstTouchDetail: set.detail ?? null,
      firstDueAt: set.due ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (made) return made;
  const [have] = await db
    .select()
    .from(speedRuns)
    .where(and(eq(speedRuns.workflow, FORM_WORKFLOW), eq(speedRuns.subject, formSubject(app.id))));
  return have as SpeedRun;
}

/** Its run says how the first text ended, once: a run already settled keeps its first word. */
async function settle(db: Queryable, runId: number, touch: FirstTouch, detail: string | null) {
  await db
    .update(speedRuns)
    .set({ firstTouch: touch, firstTouchDetail: detail })
    .where(and(eq(speedRuns.id, runId), eq(speedRuns.firstTouch, "queued")));
}

/** `<site>/book/<offer>?application=<id>`: the lander's own booking page, tagged. */
export function formBookingLink(baseUrl: string, app: Pick<FormApplication, "id" | "offer">) {
  const url = new URL(`/book/${encodeURIComponent(app.offer)}`, baseUrl);
  url.searchParams.set("application", String(app.id));
  return url.toString();
}

async function formContact(
  db: Queryable,
  app: FormApplication,
  e164: string,
  baseUrl: string,
  zone: string | null,
): Promise<SmsContact> {
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
      zone,
      bookingLink: formBookingLink(baseUrl, app),
    })
    .onConflictDoNothing()
    .returning();
  if (made) {
    // An applicant who's a lead already gets their person, for the copy and the other channels.
    const linked = await linkPeople(db, "sms_contacts", [made.id]);
    await noteContacts(db, [made.id]);
    if (!linked) return made;
  }
  const [have] = await db
    .select()
    .from(smsContacts)
    .where(and(eq(smsContacts.sourceKind, "form"), eq(smsContacts.sourceRef, String(app.id))));
  return have as SmsContact;
}

async function finish(db: Queryable, contactId: number, reason: string, now: Date) {
  await db
    .update(smsContacts)
    .set({ state: "finished", stateReason: reason, endedAt: now })
    .where(and(eq(smsContacts.id, contactId), eq(smsContacts.state, "new")));
}

const failure = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A phone that won't get texts, in plain words. */
function noPhoneWhy(raw: string, countries: readonly string[]): string {
  const country = phoneCountry(raw);
  return country
    ? `a ${country} number, and form texts go only to ${countries.join(", ")} (WREN_SMS_FORM_COUNTRIES)`
    : "not a phone number we can read";
}

/**
 * One application, as far as it can go now: its run and contact recorded, and its first text
 * queued when it's due and nothing stops it. Safe to run any number of times, from the push
 * and the pass alike: each step is claimed once.
 */
export async function formStep(
  db: Db,
  app: FormApplication,
  opts: FormOptions,
): Promise<FormOutcome> {
  const countries = opts.countries ?? PHONE_COUNTRIES;
  const appliedAt = new Date(app.ts);
  if (app.sms_consent !== 1 || !app.phone?.trim()) {
    await runOf(db, app, "no_consent", {
      detail: app.sms_consent === 1 ? "ticked the texts box but gave no phone" : null,
    });
    return { kind: "no_consent" };
  }
  const e164 = toPhoneE164(app.phone, countries);
  // Ticked the box: from here, a miss is noticed 10 minutes after the text was due.
  const soonest = new Date(appliedAt.getTime() + FIRST_TEXT_AFTER_MS);
  if (!e164) {
    const why = noPhoneWhy(app.phone, countries);
    const run = await runOf(db, app, "no_phone", { detail: why, due: soonest });
    return run.firstTouch === "no_phone" ? { kind: "no_phone", why } : { kind: "done" };
  }
  const zone = zoneOfPhone(e164);
  const due = nextOpen(zone, soonest, policyFor("form", opts.policy));
  const run = await runOf(db, app, "queued", { e164, zone, due: due ?? soonest });
  if (run.firstTouch !== "queued") return { kind: "done" };
  const contact = await formContact(db, app, e164, opts.site.baseUrl, zone);
  if (run.smsContactId === null)
    await db.update(speedRuns).set({ smsContactId: contact.id }).where(eq(speedRuns.id, run.id));
  if (contact.state !== "new") return { kind: "done" };
  const end = async (why: string, touch: FirstTouch = "refused"): Promise<FormOutcome> => {
    await finish(db, contact.id, why, opts.now);
    await settle(db, run.id, touch, why);
    return { kind: "ended", why };
  };
  if (opts.now.getTime() - appliedAt.getTime() > FIRST_TEXT_WITHIN_MS)
    return end(`applied ${app.ts.slice(0, 10)}: too long ago for a first text`);
  if (!due) return end("the texting window never opens on their clock (WREN_SMS_FORM_DAYS)");
  if (opts.now < due) return { kind: "waiting", due };
  // Asked about bookings at text time, not before.
  if (opts.bookings) {
    let booked: boolean;
    try {
      booked = await opts.bookings.booked(app.email);
    } catch (err) {
      // Not knowing is not "no": a text to someone who booked is the mistake this check exists for.
      return { kind: "error", why: `application ${app.id}: ${failure(err)}` };
    }
    if (booked) {
      await end(`booked a call on ${opts.bookings.name} before the first text`, "booked");
      await bookedRun(db, contact.id, opts.now);
      return { kind: "booked" };
    }
  }
  const name = app.fit === 1 ? FORM_FIT : FORM_NOT_FIT;
  const sequence = opts.sequences.get(name);
  if (!sequence) throw new Error(`sms sequence ${name} is not registered`);
  const key = stepTemplate(sequence, 1);
  if (!(await liveTexts(db, [key])).has(key)) return end(`the ${key} template is empty`);
  // Enroll takes no one into a sequence with an empty step: name it here, plainly.
  const rest = sequence.steps.map((s) => stepTemplate(sequence, s.step)).filter((k) => k !== key);
  const live = await liveTexts(db, rest);
  const empty = rest.filter((k) => !live.has(k));
  if (empty.length > 0) return end(`the ${empty.join(", ")} template is empty`);
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
  if (got.enrolled === 1) return { kind: "texted", contactId: contact.id };
  if (got.lookupErrors.length > 0) return { kind: "error", why: got.lookupErrors.join("; ") };
  // Enroll ended it (landline, opted out) or left it: say why it stops here.
  const [after] = await db.select().from(smsContacts).where(eq(smsContacts.id, contact.id));
  if (after && after.state !== "new") {
    const why =
      after.state === "unreachable" && after.stateReason?.startsWith("line type")
        ? `not a mobile: ${after.stateReason}`
        : (after.stateReason ?? after.state);
    await settle(db, run.id, "refused", why);
    return { kind: "ended", why };
  }
  if (got.considered === 0)
    return end(`the policy does not text ${contact.basis} contacts (WREN_SMS_BASES)`);
  if (got.noNumber) return end(`no pool number texts ${phoneCountry(e164) ?? "their"} phones`);
  if (got.companyBusy > 0) return end("this phone is already in a running thread");
  // Another run enrolled it at the same moment: that one texts.
  return { kind: "done" };
}

export interface FormStats {
  /** Applications read past the cursor. */
  read: number;
  /** Applications recorded as before texts were on (the first pass after shipping). */
  seeded: number;
  /** New runs this pass. */
  added: number;
  texted: number;
  booked: number;
  /** Ticked the box with a phone we don't text (a country the list leaves out). */
  noPhone: number;
  /** Ended without a text (too old, an empty template, a landline, no number). */
  ended: number;
  /** Not due yet: a later run texts them. */
  waiting: number;
  errors: string[];
}

/**
 * Where the pass reads from: just before the oldest application still waiting (a retry), else
 * after the newest run. Null = no run yet: this is the first pass.
 */
async function cursor(db: Queryable): Promise<number | null> {
  const id = sql<number>`split_part(${speedRuns.subject}, ':', 3)::int`;
  const [row] = await db
    .select({
      waiting: sql<
        number | null
      >`min(${id}) filter (where ${speedRuns.firstTouch} = 'queued' and ${smsContacts.state} = 'new')`,
      newest: sql<number | null>`max(${id})`,
    })
    .from(speedRuns)
    .leftJoin(smsContacts, eq(smsContacts.id, speedRuns.smsContactId))
    .where(eq(speedRuns.workflow, FORM_WORKFLOW));
  if (row?.waiting !== null && row?.waiting !== undefined) return Number(row.waiting) - 1;
  return row?.newest === null || row?.newest === undefined ? null : Number(row.newest);
}

/** The first pass: every application already on the site, recorded and never texted. */
async function seed(db: Queryable, apps: readonly FormApplication[]) {
  for (const app of apps)
    await runOf(db, app, app.sms_consent === 1 ? "refused" : "no_consent", {
      detail: "applied before form texts were on: not texted",
    });
}

/** The net under the push: every application past the cursor, each through `formStep`. */
export async function followUpForms(db: Db, opts: FormOptions): Promise<FormStats> {
  const stats: FormStats = {
    read: 0,
    seeded: 0,
    added: 0,
    texted: 0,
    booked: 0,
    noPhone: 0,
    ended: 0,
    waiting: 0,
    errors: [],
  };
  const since = await cursor(db);
  const apps = await readApplications(opts.site, since ?? 0);
  stats.read = apps.length;
  if (since === null) {
    await seed(db, apps);
    stats.seeded = apps.length;
    return stats;
  }
  for (const app of apps) {
    const [had] = await db
      .select({ id: speedRuns.id })
      .from(speedRuns)
      .where(
        and(eq(speedRuns.workflow, FORM_WORKFLOW), eq(speedRuns.subject, formSubject(app.id))),
      );
    if (!had) stats.added += 1;
    let got: FormOutcome;
    try {
      got = await formStep(db, app, opts);
    } catch (err) {
      stats.errors.push(`application ${app.id}: ${failure(err)}`);
      continue;
    }
    if (got.kind === "texted") stats.texted += 1;
    else if (got.kind === "booked") stats.booked += 1;
    else if (got.kind === "no_phone") stats.noPhone += 1;
    else if (got.kind === "ended") stats.ended += 1;
    else if (got.kind === "waiting") stats.waiting += 1;
    else if (got.kind === "error") stats.errors.push(got.why);
  }
  return stats;
}

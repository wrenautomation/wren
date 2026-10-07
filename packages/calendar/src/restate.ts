/**
 * Booking (designs/2026-10-06-calendar.md), two services over one set of steps:
 *
 * - `Calendar`: Wren's own, public through the phone Worker's `/calendar/<handler>` door. The
 *   lander signs each booking after its bot check (`bookSig`).
 * - `ClientCalendar`: a client's, reached only by the portal Worker (ingress auth) from the
 *   client's booking page, each call naming its client. The client is read fresh every call:
 *   the part installed, its settings, its Google account, its sends flag, its live host.
 *
 * - `slots`: the open start times, from the part's settings, Google's busy times and our calls.
 * - `book`: claims the slot, mirrors it into `call_bookings` (stops follow-ups, counts the call,
 *   fires Booking triggers), makes the Google event with Meet, mails a confirmation with the
 *   manage link, and queues the reminders.
 * - `booking`, `reschedule`, `cancel`: the manage link's token is the only login.
 * - `remind`: private, sent to itself with a delay for 24 h and 1 h before. A reminder whose
 *   call moved or was cancelled does nothing; the moved call queued its own.
 *
 * Sends: Wren's always go. A client's mail and Google's invite go only with its sends flag on
 * (and a mailer on the worker); off, the event holds the slot on the client's calendar with no
 * guest, and the booker gets the page's answer and nothing else.
 *
 * Google and mail are capped at three tries each and never undo a booking: the row is the call.
 * Texts go through SmsWatch's reminder pass, which reads these calls next to cal.com's.
 */
import * as restate from "@restatedev/restate-sdk";
import { bookingEmit, bookingFired } from "@wren/channel-email/calls";
import { type Client, findClient, isLive, listDomains, sendsOn } from "@wren/core/clients";
import { serviceHandler } from "@wren/core/restate";
import { type FireTriggers, spineEmit } from "@wren/core/spine";
import { canonicalZone } from "@wren/core/time";
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type Booker,
  bookedCalls,
  bookingById,
  cancelBooking,
  claim,
  mirror,
  moveBooking,
  SlotTaken,
  setEvent,
  Unchangeable,
} from "./book.js";
import { type CalendarHost, eventIdOf } from "./google.js";
import { bookSigned, manageUrl, readManage } from "./links.js";
import { type Kind, mailFor, titleFor } from "./mail.js";
import { CALENDAR, rulesOf } from "./rules.js";
import { bookings, type CalendarBooking } from "./schema.js";
import { openSlots, type Span } from "./slots.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CAPPED = { maxRetryAttempts: 3 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CALENDAR_SERVICE = { name: "Calendar" } as const;
export const CLIENT_CALENDAR_SERVICE = { name: "ClientCalendar" } as const;

export type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;

export interface CalendarDeps {
  db: Db;
  /** Whose calendar this books, the bookings' `calendar` column: "wren", or a client's id. */
  calendar: string;
  /** The client it books for; unset or null is Wren. Scopes manage links, the spine, reminders. */
  client?: string | null;
  /** The `calendar.booking` settings block, read fresh each call. */
  settings: () => Promise<unknown>;
  /** Where events land; null = no events, no busy times (tests, or no key). */
  host: CalendarHost | null;
  /** The signing secret. Unset = booking and manage links are off. */
  shared: string | null;
  /** The booking page's site: the lander for Wren, the client's host for a client. */
  site: string;
  /** Sends the booker's mail; null = no mail. */
  send: SendMail | null;
  /** Google invites the booker and mails its updates. Unset is true (Wren). */
  notify?: boolean;
  /** Who signs the booker's mail; unset is Wren. */
  signer?: string;
  /** Each booking, move and cancel to the spine's Booking triggers (`spineFire`). */
  fire?: FireTriggers;
  /** How long before a call each reminder goes, read at booking; tests shorten them. */
  leads?: { day: number; hour: number };
}

/** A booking as the booker's page sees it: JSON, so a journaled step can return it. */
export interface BookingView {
  id: number;
  state: "booked" | "cancelled";
  start: string;
  end: string;
  name: string;
  /** The booker's zone. */
  zone: string;
  title: string;
  offer: string | null;
  meetUrl: string | null;
  /** True while it can still move or be cancelled. */
  open: boolean;
}

/** The open times as the booking page reads them. */
export interface SlotsView {
  /** The owner's zone. */
  zone: string;
  length: number;
  /** The call's name, `{name}` left in. */
  title: string;
  slots: string[];
}

const viewOf = (b: CalendarBooking, title: string, now: Date): BookingView => ({
  id: b.id,
  state: b.state,
  start: b.start.toISOString(),
  end: b.end.toISOString(),
  name: b.name,
  zone: b.zone,
  title: titleFor(title, b.name),
  offer: b.offer,
  meetUrl: b.meetUrl,
  open: b.state === "booked" && b.start > now,
});

const spansJson = (s: Span[]) =>
  s.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() }));
const spansOf = (s: { start: string; end: string }[]): Span[] =>
  s.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));

const refuse = (message: string, errorCode: number) =>
  new restate.TerminalError(message, { errorCode });

export type Reminder = "day" | "hour";
interface RemindRequest {
  id: number;
  /** The start it was queued for; a moved call ignores it. */
  start: string;
  kind: Reminder;
  /** A client's call; unset is Wren's. */
  client?: string;
}
type RemindService = {
  remind: (ctx: restate.Context, req: RemindRequest) => Promise<{ sent: boolean }>;
};
export type CalendarService = RemindService;

/** A call as the spine hears it after a change: who booked rides along. */
interface Changed {
  id: number;
  state: "booked" | "cancelled";
  start: string;
  email: string;
  name: string;
  offer: string | null;
}

/** What a booker asks for, checked. */
export interface BookAsk {
  /** The page it was booked on: Wren's offer, or a client page's tag. */
  offer: string | null;
  start: string;
  name: string;
  email: string;
  zone: string;
  code?: string | undefined;
  application?: string | undefined;
  source?: Record<string, string> | undefined;
}

const SOURCE_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "ref",
  "visitor",
  "page",
] as const;

/** What `Calendar`, `ClientCalendar` and `CalendarConsole` do to a booking. */
export function calendarFlows(deps: CalendarDeps) {
  const { db } = deps;
  const client = deps.client ?? null;
  const scope = client ?? undefined;
  const notify = deps.notify ?? true;
  const rulesNow = async (ctx: restate.Context) => {
    const block = await ctx.run("rules", async () => (await deps.settings()) ?? {});
    try {
      return rulesOf(block);
    } catch (err) {
      throw refuse(`the calendar's settings don't parse: ${(err as Error).message}`, 503);
    }
  };
  const shared = (): string => {
    if (!deps.shared) throw refuse("booking is off: no shared secret", 503);
    return deps.shared;
  };
  const busyAround = async (
    ctx: restate.Context,
    account: string | null,
    from: Date,
    to: Date,
  ): Promise<Span[]> => {
    const host = deps.host;
    if (!host || !account) return [];
    // Capped and fail-closed: a slot offered without the owner's busy times could double-book
    // him, and an endless retry would hang the page.
    try {
      return spansOf(
        await ctx.run("busy", async () => spansJson(await host.busy(account, from, to)), CAPPED),
      );
    } catch (err) {
      ctx.console.warn(`calendar: busy times failed: ${(err as Error).message}`);
      throw refuse("calendar unavailable", 503);
    }
  };
  const manage = (id: number) => manageUrl(deps.site, shared(), id, scope);
  const bookingOf = (token: unknown): number => {
    const id = typeof token === "string" ? readManage(shared(), token, scope) : null;
    if (id === null) throw refuse("this link isn't valid", 404);
    return id;
  };

  /** Tell the spine: a booked or moved call enters `close`; every change fires Booking triggers. */
  const tell = (ctx: restate.Context, call: Changed | null) => {
    if (!call) return;
    const emit = bookingEmit(call);
    if (emit) spineEmit(ctx, { client, ...emit });
    deps.fire?.(ctx, bookingFired(client, call, call));
  };
  const changed = (row: CalendarBooking, state: "booked" | "cancelled"): Changed => ({
    id: row.id,
    state,
    start: row.start.toISOString(),
    email: row.email,
    name: row.name,
    offer: row.offer,
  });

  /** One mail, capped; a failure is logged, never undoes the change. */
  const mail = async (ctx: restate.Context, kind: Kind, id: number, title: string) => {
    const send = deps.send;
    if (!send) return false;
    try {
      return await ctx.run(
        `mail ${kind}`,
        async () => {
          const b = await bookingById(db, id);
          if (!b) return false;
          await send(
            mailFor(kind, b, {
              title,
              manage: manage(id),
              rebook: b.offer ? `${deps.site.replace(/\/+$/, "")}/book/${b.offer}` : null,
              ...(deps.signer ? { signer: deps.signer } : {}),
            }),
          );
          return true;
        },
        CAPPED,
      );
    } catch (err) {
      ctx.console.warn(
        `calendar: ${kind} mail for booking ${id} failed: ${(err as Error).message}`,
      );
      return false;
    }
  };

  /** Queue the day and hour reminders for this start; ones already past are skipped. */
  const queueReminders = (ctx: restate.Context, id: number, start: Date, now: Date) => {
    const leads = deps.leads ?? { day: DAY, hour: HOUR };
    for (const [kind, before] of [
      ["day", leads.day],
      ["hour", leads.hour],
    ] as const) {
      const delay = start.getTime() - before - now.getTime();
      if (delay <= 0) continue;
      const req: RemindRequest = { id, start: start.toISOString(), kind };
      ctx
        .serviceSendClient<RemindService>(client ? CLIENT_CALENDAR_SERVICE : CALENDAR_SERVICE)
        .remind(client ? { ...req, client } : req, restate.rpc.sendOpts({ delay }));
    }
  };

  /** Google, capped: a failure leaves the booking without an event and says so in the log. */
  const google = async <T>(ctx: restate.Context, name: string, fn: () => Promise<T>) => {
    try {
      return await ctx.run(name, fn, CAPPED);
    } catch (err) {
      ctx.console.warn(`calendar: ${name} failed: ${(err as Error).message}`);
      return null;
    }
  };

  const view = async (ctx: restate.Context, id: number): Promise<BookingView> => {
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    return ctx.run("view", async () => {
      const b = await bookingById(db, id);
      if (!b) throw refuse("no such call", 404);
      return viewOf(b, rules.title, now);
    });
  };

  const slots = async (ctx: restate.Context): Promise<SlotsView> => {
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    const to = new Date(now.getTime() + (rules.days + 1) * DAY);
    const busy = await busyAround(ctx, rules.account, now, to);
    const calls = spansOf(
      await ctx.run("calls", async () => spansJson(await bookedCalls(db, deps.calendar, now, to))),
    );
    return {
      zone: rules.zone,
      length: rules.length,
      title: rules.title,
      slots: openSlots(rules, { from: now, to, now, busy, calls }).map((s) => s.toISOString()),
    };
  };

  const book = async (
    ctx: restate.Context,
    req: BookAsk,
  ): Promise<BookingView & { manage: string }> => {
    const secret = shared();
    const start = new Date(String(req.start));
    const email = String(req.email ?? "")
      .trim()
      .toLowerCase();
    if (Number.isNaN(start.getTime())) throw refuse("no such time", 400);
    if (!EMAIL.test(email)) throw refuse("that isn't an email address", 400);
    const name = String(req.name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name) throw refuse("a name, please", 400);
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    const busy = await busyAround(
      ctx,
      rules.account,
      new Date(start.getTime() - DAY),
      new Date(start.getTime() + DAY),
    );
    const source: Record<string, string> = {};
    for (const k of SOURCE_KEYS) {
      const v = req.source?.[k];
      if (typeof v === "string" && v.trim()) source[k] = v.trim().slice(0, 200);
    }
    const booker: Booker = {
      name,
      email,
      zone: canonicalZone(req.zone) ?? rules.zone,
      offer: req.offer?.trim() || null,
      code: req.code?.trim() || null,
      application: req.application?.trim() || null,
      source,
    };
    const id = await ctx.run("claim", async () => {
      try {
        const row = await claim(db, { calendar: deps.calendar, rules, start, booker, now, busy });
        return row.id;
      } catch (err) {
        if (err instanceof SlotTaken) throw refuse(err.message, 409);
        throw err;
      }
    });
    const mirrored = await ctx.run("mirror", async () => {
      const row = await bookingById(db, id);
      if (!row) return null;
      const done = await mirror(db, row, "created", now);
      return { ...changed(row, done.state), id: done.id };
    });
    // The call enters `close`: its brief is built now and pinged before it starts.
    tell(ctx, mirrored);
    const host = deps.host;
    const account = rules.account;
    if (host && account)
      await google(ctx, "event create", async () => {
        const row = await bookingById(db, id);
        if (!row) return null;
        const made = await host.create(account, {
          id: eventIdOf(row.id, row.createdAt),
          title: titleFor(rules.title, row.name),
          start: row.start,
          end: row.end,
          zone: rules.zone,
          attendee: { email: row.email, name: row.name },
          description: [
            `Booked at ${deps.site.replace(/^https?:\/\//, "")}.`,
            ...(notify ? [] : [`Booker: ${row.name} <${row.email}>`]),
            `Move or cancel: ${manageUrl(deps.site, secret, row.id, scope)}`,
          ].join("\n"),
          notify,
        });
        await setEvent(db, row.id, made);
        return made;
      });
    await mail(ctx, "booked", id, rules.title);
    queueReminders(ctx, id, start, now);
    return ctx.run("view", async () => {
      const b = await bookingById(db, id);
      if (!b) throw new Error(`booking ${id} is gone`);
      return { ...viewOf(b, rules.title, now), manage: manageUrl(deps.site, secret, id, scope) };
    });
  };

  const reschedule = async (ctx: restate.Context, id: number, at: string) => {
    const start = new Date(String(at));
    if (Number.isNaN(start.getTime())) throw refuse("no such time", 400);
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    const busy = await busyAround(
      ctx,
      rules.account,
      new Date(start.getTime() - DAY),
      new Date(start.getTime() + DAY),
    );
    const moved = await ctx.run("move", async () => {
      try {
        const { before, after } = await moveBooking(db, { id, rules, start, now, busy });
        const changes = before.start.getTime() !== after.start.getTime();
        const done = changes ? await mirror(db, after, "rescheduled", now) : null;
        return {
          changed: changes,
          event: after.googleEventId,
          call: done && { ...changed(after, done.state), id: done.id },
        };
      } catch (err) {
        if (err instanceof SlotTaken) throw refuse(err.message, 409);
        if (err instanceof Unchangeable) throw refuse(err.message, 409);
        throw err;
      }
    });
    // A moved call is a new arrival in `close`: its brief is rebuilt for the new time.
    tell(ctx, moved.call);
    const host = deps.host;
    if (moved.changed && host && rules.account && moved.event) {
      const [account, event] = [rules.account, moved.event];
      await google(ctx, "event move", async () => {
        const made = await host.move(
          account,
          event,
          start,
          new Date(start.getTime() + rules.length * MIN),
          rules.zone,
          notify,
        );
        await setEvent(db, id, made);
        return made;
      });
    }
    if (moved.changed) {
      await mail(ctx, "moved", id, rules.title);
      queueReminders(ctx, id, start, now);
    }
    return ctx.run("view", async () => {
      const b = await bookingById(db, id);
      if (!b) throw refuse("no such call", 404);
      return viewOf(b, rules.title, now);
    });
  };

  const cancel = async (
    ctx: restate.Context,
    id: number,
    o: { by: string; reason: string | null },
  ): Promise<BookingView> => {
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    const done = await ctx.run("cancel", async () => {
      try {
        const { row, changed: changes } = await cancelBooking(db, { id, ...o, now });
        const call = changes ? await mirror(db, row, "cancelled", now) : null;
        return {
          changed: changes,
          event: row.googleEventId,
          call: call && { ...changed(row, "cancelled"), id: call.id },
        };
      } catch (err) {
        if (err instanceof Unchangeable) throw refuse(err.message, 404);
        throw err;
      }
    });
    tell(ctx, done.call);
    const host = deps.host;
    if (done.changed && host && rules.account && done.event) {
      const [account, event] = [rules.account, done.event];
      await google(ctx, "event remove", () => host.remove(account, event, notify));
    }
    if (done.changed) await mail(ctx, "cancelled", id, rules.title);
    return ctx.run("view", async () => {
      const b = await bookingById(db, id);
      if (!b) throw refuse("no such call", 404);
      return viewOf(b, rules.title, now);
    });
  };

  /** A day or an hour before: mail the booker, once, if the call still starts then. */
  const remind = async (ctx: restate.Context, req: RemindRequest): Promise<{ sent: boolean }> => {
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    const due = await ctx.run("due", async () => {
      const b = await bookingById(db, req.id);
      if (!b || b.state !== "booked" || b.start.toISOString() !== req.start) return false;
      if (b.start <= now) return false;
      return (req.kind === "day" ? b.remindedDayAt : b.remindedHourAt) === null;
    });
    if (!due) return { sent: false };
    const sent = await mail(ctx, req.kind, req.id, rules.title);
    if (sent)
      await ctx.run("mark", async () => {
        await db
          .update(bookings)
          .set(req.kind === "day" ? { remindedDayAt: now } : { remindedHourAt: now })
          .where(eq(bookings.id, req.id));
      });
    return { sent };
  };

  return {
    rulesNow,
    shared,
    busyAround,
    mail,
    queueReminders,
    google,
    bookingOf,
    view,
    slots,
    book,
    reschedule,
    cancel,
    remind,
  };
}

const BOOKER = {
  start: z.string().describe("The slot, ISO"),
  name: z.string().min(1).max(200),
  email: z.string().max(320),
  zone: z.string().max(64).describe("The booker's IANA zone"),
  code: z.string().max(40).optional().describe("The link's ?r= code"),
  application: z.string().max(64).optional(),
  source: z.record(z.string(), z.string()).optional().describe("utm_*, ref, visitor, page"),
};
const BOOK = z.looseObject({
  offer: z.string().min(1).max(64).describe("The offer whose page it was booked on"),
  ...BOOKER,
  sig: z.string().describe("bookSig(shared, offer, start, email), from the lander"),
});
type BookRequest = z.infer<typeof BOOK>;
const TOKEN = z.looseObject({ token: z.string().describe("The manage link's token") });
const MOVE = z.looseObject({ token: z.string(), start: z.string().describe("The new slot, ISO") });
const CANCEL = z.looseObject({ token: z.string(), reason: z.string().max(500).optional() });
const REMIND = {
  id: z.number().int(),
  start: z.string(),
  kind: z.enum(["day", "hour"]),
};

export function makeCalendar(deps: CalendarDeps) {
  const f = calendarFlows(deps);
  return restate.service({
    name: CALENDAR_SERVICE.name,
    handlers: {
      /** Open start times, ISO, for the next `days` days. */
      slots: serviceHandler(
        { input: z.looseObject({ offer: z.string().optional() }).optional() },
        async (ctx: restate.Context) => f.slots(ctx),
      ),

      book: serviceHandler(
        { input: BOOK, effect: "sends" },
        async (ctx: restate.Context, req: BookRequest) => {
          const start = new Date(String(req?.start));
          if (Number.isNaN(start.getTime())) throw refuse("no such time", 400);
          const email = String(req?.email ?? "")
            .trim()
            .toLowerCase();
          if (
            !bookSigned(f.shared(), String(req?.sig ?? ""), req.offer, start.toISOString(), email)
          )
            throw refuse("unsigned booking", 401);
          return f.book(ctx, req);
        },
      ),

      /** The manage page's call. */
      booking: serviceHandler(
        { input: TOKEN },
        async (ctx: restate.Context, req: { token: string }) =>
          f.view(ctx, f.bookingOf(req?.token)),
      ),

      reschedule: serviceHandler(
        { input: MOVE, effect: "sends" },
        async (ctx: restate.Context, req: { token: string; start: string }) =>
          f.reschedule(ctx, f.bookingOf(req?.token), req.start),
      ),

      cancel: serviceHandler(
        { input: CANCEL, effect: "sends" },
        async (ctx: restate.Context, req: { token: string; reason?: string }) =>
          f.cancel(ctx, f.bookingOf(req?.token), {
            by: "booker",
            reason: req.reason?.trim() || null,
          }),
      ),

      remind: serviceHandler(
        { input: z.looseObject(REMIND), effect: "sends", ingressPrivate: true },
        async (ctx: restate.Context, req: RemindRequest) => f.remind(ctx, req),
      ),
    },
  });
}

export type Calendar = ReturnType<typeof makeCalendar>;

export interface ClientCalendarDeps {
  /** Main: the client registry and its domains. */
  main: Db;
  /** A client's own database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  host: CalendarHost | null;
  shared: string | null;
  /** The portal's origin: a client with no live domain books at `<portal>/c/<client>`. */
  portal: string;
  /** Mail from a sender name; null = no mail on this worker, whatever a client's flag says. */
  mailer: ((from: string) => SendMail) | null;
  fire?: FireTriggers;
  leads?: { day: number; hour: number };
}

/** A client as its booking page needs it, read in one journaled step. */
export interface CalendarOwner {
  id: string;
  database: string;
  name: string;
  settings: Record<string, unknown>;
  /** The Google account (`accounts.google_calendar`); null = no busy times, no events. */
  account: string | null;
  /** Its booking page's site: its first live domain, else its place on the portal. */
  site: string;
  /** Its sends flag for the part. */
  sends: boolean;
}

/** The client behind a page, or the refusal: never a demo, the part installed. */
export async function calendarOwner(main: Db, portal: string, id: string): Promise<CalendarOwner> {
  const c = await findClient(main, id);
  if (!c || c.demo || !Object.hasOwn(c.products ?? {}, CALENDAR))
    throw refuse("no booking page here", 404);
  const block = c.products[CALENDAR];
  const live = (await listDomains(main, c.id)).find(isLive);
  const account = c.accounts?.google_calendar;
  return {
    id: c.id,
    database: c.database,
    name: c.name,
    settings: block && typeof block === "object" ? (block as Record<string, unknown>) : {},
    account: typeof account === "string" && account.trim() ? account.trim().toLowerCase() : null,
    site: live ? `https://${live.hostname}` : `${portal.replace(/\/+$/, "")}/c/${c.id}`,
    sends: sendsOn(c, CALENDAR),
  };
}

/** One client's calendar deps: its database, its calendar, its account, its gate. */
export function ownerDeps(d: ClientCalendarDeps, o: CalendarOwner): CalendarDeps {
  const send = o.sends && d.mailer ? d.mailer(o.name) : null;
  // A client's account is the one it connected; the block's own `account` is Wren's field.
  const { account: _ignored, ...settings } = o.settings;
  return {
    db: d.open(o),
    calendar: o.id,
    client: o.id,
    settings: async () => ({ ...settings, ...(o.account ? { account: o.account } : {}) }),
    host: d.host,
    shared: d.shared,
    site: o.site,
    send,
    notify: send !== null,
    signer: o.name,
    ...(d.fire ? { fire: d.fire } : {}),
    ...(d.leads ? { leads: d.leads } : {}),
  };
}

const CLIENT = { client: z.string().min(1).max(40).describe("The client whose page it is") };
const CLIENT_BOOK = z.looseObject({
  ...CLIENT,
  tag: z.string().max(64).optional().describe("The page's tag, /book/<tag>"),
  ...BOOKER,
});

/** The client's booking page, through the portal Worker only. */
export function makeClientCalendar(deps: ClientCalendarDeps) {
  const flowsFor = async (ctx: restate.Context, client: unknown) => {
    const id = typeof client === "string" ? client : "";
    const owner = await ctx.run("client", () => calendarOwner(deps.main, deps.portal, id));
    return { owner, f: calendarFlows(ownerDeps(deps, owner)) };
  };
  return restate.service({
    name: CLIENT_CALENDAR_SERVICE.name,
    handlers: {
      /** The page's header and open times: the client's name (`owner`), the call, length, zone. */
      slots: serviceHandler(
        { input: z.looseObject({ ...CLIENT, tag: z.string().optional() }) },
        async (ctx: restate.Context, req: { client: string }) => {
          const { owner, f } = await flowsFor(ctx, req?.client);
          return { owner: owner.name, ...(await f.slots(ctx)) };
        },
      ),

      book: serviceHandler(
        { input: CLIENT_BOOK, effect: "sends" },
        async (ctx: restate.Context, req: z.infer<typeof CLIENT_BOOK>) => {
          const { f } = await flowsFor(ctx, req?.client);
          return f.book(ctx, { ...req, offer: req.tag?.trim() || null });
        },
      ),

      booking: serviceHandler(
        { input: z.looseObject({ ...CLIENT, token: z.string() }) },
        async (ctx: restate.Context, req: { client: string; token: string }) => {
          const { owner, f } = await flowsFor(ctx, req?.client);
          return { owner: owner.name, ...(await f.view(ctx, f.bookingOf(req?.token))) };
        },
      ),

      reschedule: serviceHandler(
        {
          input: z.looseObject({ ...CLIENT, token: z.string(), start: z.string() }),
          effect: "sends",
        },
        async (ctx: restate.Context, req: { client: string; token: string; start: string }) => {
          const { f } = await flowsFor(ctx, req?.client);
          return f.reschedule(ctx, f.bookingOf(req?.token), req.start);
        },
      ),

      cancel: serviceHandler(
        {
          input: z.looseObject({
            ...CLIENT,
            token: z.string(),
            reason: z.string().max(500).optional(),
          }),
          effect: "sends",
        },
        async (ctx: restate.Context, req: { client: string; token: string; reason?: string }) => {
          const { f } = await flowsFor(ctx, req?.client);
          return f.cancel(ctx, f.bookingOf(req?.token), {
            by: "booker",
            reason: req.reason?.trim() || null,
          });
        },
      ),

      remind: serviceHandler(
        { input: z.looseObject({ ...REMIND, ...CLIENT }), effect: "sends", ingressPrivate: true },
        async (ctx: restate.Context, req: RemindRequest) => {
          // A client gone or uninstalled since: nothing to remind.
          let flows: Awaited<ReturnType<typeof flowsFor>>;
          try {
            flows = await flowsFor(ctx, req?.client);
          } catch (err) {
            if (err instanceof restate.TerminalError) return { sent: false };
            throw err;
          }
          return flows.f.remind(ctx, req);
        },
      ),
    },
  });
}

export type ClientCalendar = ReturnType<typeof makeClientCalendar>;

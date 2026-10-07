/**
 * `Calendar`: our own booking (designs/2026-10-06-calendar.md), public through the phone
 * Worker's `/calendar/<handler>` door.
 *
 * - `slots`: the open start times, from the part's settings, Google's busy times and our calls.
 * - `book`: the lander signs it after its bot check (`bookSig`). Claims the slot, mirrors it into
 *   `call_bookings` (stops follow-ups, counts the call), makes the Google event with Meet (Google
 *   mails the invite), mails a confirmation with the manage link, and queues the reminders.
 * - `booking`, `reschedule`, `cancel`: the manage link's token is the only login.
 * - `remind`: private, sent to itself with a delay for 24 h and 1 h before. A reminder whose
 *   call moved or was cancelled does nothing; the moved call queued its own.
 *
 * Google and mail are capped at three tries each and never undo a booking: the row is the call.
 * Texts go through SmsWatch's reminder pass, which reads these calls next to cal.com's.
 */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
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
import { rulesOf } from "./rules.js";
import { bookings, type CalendarBooking } from "./schema.js";
import { openSlots, type Span } from "./slots.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CAPPED = { maxRetryAttempts: 3 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CALENDAR_SERVICE = { name: "Calendar" } as const;

export interface CalendarDeps {
  db: Db;
  /** Whose calendar this service books: "wren". */
  calendar: string;
  /** The `calendar.booking` settings block, read fresh each call. */
  settings: () => Promise<unknown>;
  /** Where events land; null = no events, no busy times (tests, or no key). */
  host: CalendarHost | null;
  /** The secret the lander and Wren share. Unset = booking and manage links are off. */
  shared: string | null;
  /** The lander, e.g. https://wrenautomation.com. */
  site: string;
  /** Sends the booker's mail; null = no mail (Google's invite still goes). */
  send: ((m: { to: string; subject: string; text: string }) => Promise<void>) | null;
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
}
export type CalendarService = {
  remind: (ctx: restate.Context, req: RemindRequest) => Promise<{ sent: boolean }>;
};

/** What `Calendar` and `CalendarConsole` both do to a booking. */
export function calendarFlows(deps: CalendarDeps) {
  const { db } = deps;
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
  const manage = (id: number) => manageUrl(deps.site, shared(), id);

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
      ctx
        .serviceSendClient<CalendarService>(CALENDAR_SERVICE)
        .remind({ id, start: start.toISOString(), kind }, restate.rpc.sendOpts({ delay }));
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

  const cancel = async (
    ctx: restate.Context,
    id: number,
    o: { by: string; reason: string | null },
  ): Promise<BookingView> => {
    const rules = await rulesNow(ctx);
    const now = new Date(await ctx.date.now());
    const done = await ctx.run("cancel", async () => {
      try {
        const { row, changed } = await cancelBooking(db, { id, ...o, now });
        if (changed) await mirror(db, row, "cancelled", now);
        return { changed, event: row.googleEventId };
      } catch (err) {
        if (err instanceof Unchangeable) throw refuse(err.message, 404);
        throw err;
      }
    });
    const host = deps.host;
    if (done.changed && host && rules.account && done.event) {
      const [account, event] = [rules.account, done.event];
      await google(ctx, "event remove", () => host.remove(account, event));
    }
    if (done.changed) await mail(ctx, "cancelled", id, rules.title);
    return ctx.run("view", async () => {
      const b = await bookingById(db, id);
      if (!b) throw refuse("no such call", 404);
      return viewOf(b, rules.title, now);
    });
  };

  return { rulesNow, shared, busyAround, mail, queueReminders, google, cancel };
}

const BOOK = z.looseObject({
  offer: z.string().min(1).max(64).describe("The offer whose page it was booked on"),
  start: z.string().describe("The slot, ISO"),
  name: z.string().min(1).max(200),
  email: z.string().max(320),
  zone: z.string().max(64).describe("The booker's IANA zone"),
  code: z.string().max(40).optional().describe("The link's ?r= code"),
  application: z.string().max(64).optional(),
  source: z.record(z.string(), z.string()).optional().describe("utm_*, ref, visitor, page"),
  sig: z.string().describe("bookSig(shared, offer, start, email), from the lander"),
});
type BookRequest = z.infer<typeof BOOK>;
const TOKEN = z.looseObject({ token: z.string().describe("The manage link's token") });

const SOURCE_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "ref",
  "visitor",
  "page",
] as const;

export function makeCalendar(deps: CalendarDeps) {
  const { db } = deps;
  const f = calendarFlows(deps);
  const bookingOf = (token: unknown): number => {
    const id = typeof token === "string" ? readManage(f.shared(), token) : null;
    if (id === null) throw refuse("this link isn't valid", 404);
    return id;
  };

  return restate.service({
    name: CALENDAR_SERVICE.name,
    handlers: {
      /** Open start times, ISO, for the next `days` days. */
      slots: serviceHandler(
        { input: z.looseObject({ offer: z.string().optional() }).optional() },
        async (ctx: restate.Context) => {
          const rules = await f.rulesNow(ctx);
          const now = new Date(await ctx.date.now());
          const to = new Date(now.getTime() + (rules.days + 1) * DAY);
          const busy = await f.busyAround(ctx, rules.account, now, to);
          const calls = spansOf(
            await ctx.run("calls", async () =>
              spansJson(await bookedCalls(db, deps.calendar, now, to)),
            ),
          );
          return {
            zone: rules.zone,
            length: rules.length,
            slots: openSlots(rules, { from: now, to, now, busy, calls }).map((s) =>
              s.toISOString(),
            ),
          };
        },
      ),

      book: serviceHandler(
        { input: BOOK, effect: "sends" },
        async (
          ctx: restate.Context,
          req: BookRequest,
        ): Promise<BookingView & { manage: string }> => {
          const shared = f.shared();
          const start = new Date(String(req?.start));
          const email = String(req?.email ?? "")
            .trim()
            .toLowerCase();
          if (Number.isNaN(start.getTime())) throw refuse("no such time", 400);
          const iso = start.toISOString();
          if (!bookSigned(shared, String(req?.sig ?? ""), req.offer, iso, email))
            throw refuse("unsigned booking", 401);
          if (!EMAIL.test(email)) throw refuse("that isn't an email address", 400);
          const name = req.name.trim().replace(/\s+/g, " ");
          if (!name) throw refuse("a name, please", 400);
          const rules = await f.rulesNow(ctx);
          const now = new Date(await ctx.date.now());
          const busy = await f.busyAround(
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
            offer: req.offer,
            code: req.code?.trim() || null,
            application: req.application?.trim() || null,
            source,
          };
          const id = await ctx.run("claim", async () => {
            try {
              const row = await claim(db, {
                calendar: deps.calendar,
                rules,
                start,
                booker,
                now,
                busy,
              });
              return row.id;
            } catch (err) {
              if (err instanceof SlotTaken) throw refuse(err.message, 409);
              throw err;
            }
          });
          await ctx.run("mirror", async () => {
            const row = await bookingById(db, id);
            if (row) await mirror(db, row, "created", now);
          });
          const host = deps.host;
          const account = rules.account;
          if (host && account)
            await f.google(ctx, "event create", async () => {
              const row = await bookingById(db, id);
              if (!row) return null;
              const made = await host.create(account, {
                id: eventIdOf(row.id, row.createdAt),
                title: titleFor(rules.title, row.name),
                start: row.start,
                end: row.end,
                zone: rules.zone,
                attendee: { email: row.email, name: row.name },
                description: `Booked at ${deps.site.replace(/^https?:\/\//, "")}.\nMove or cancel: ${manageUrl(deps.site, shared, row.id)}`,
              });
              await setEvent(db, row.id, made);
              return made;
            });
          await f.mail(ctx, "booked", id, rules.title);
          f.queueReminders(ctx, id, start, now);
          return ctx.run("view", async () => {
            const b = await bookingById(db, id);
            if (!b) throw new Error(`booking ${id} is gone`);
            return { ...viewOf(b, rules.title, now), manage: manageUrl(deps.site, shared, id) };
          });
        },
      ),

      /** The manage page's call. */
      booking: serviceHandler(
        { input: TOKEN },
        async (ctx: restate.Context, req: { token: string }) => {
          const id = bookingOf(req?.token);
          const rules = await f.rulesNow(ctx);
          const now = new Date(await ctx.date.now());
          return ctx.run("view", async () => {
            const b = await bookingById(db, id);
            if (!b) throw refuse("no such call", 404);
            return viewOf(b, rules.title, now);
          });
        },
      ),

      reschedule: serviceHandler(
        {
          input: z.looseObject({
            token: z.string(),
            start: z.string().describe("The new slot, ISO"),
          }),
          effect: "sends",
        },
        async (ctx: restate.Context, req: { token: string; start: string }) => {
          const id = bookingOf(req?.token);
          const start = new Date(String(req?.start));
          if (Number.isNaN(start.getTime())) throw refuse("no such time", 400);
          const rules = await f.rulesNow(ctx);
          const now = new Date(await ctx.date.now());
          const busy = await f.busyAround(
            ctx,
            rules.account,
            new Date(start.getTime() - DAY),
            new Date(start.getTime() + DAY),
          );
          const moved = await ctx.run("move", async () => {
            try {
              const { before, after } = await moveBooking(db, { id, rules, start, now, busy });
              const changed = before.start.getTime() !== after.start.getTime();
              if (changed) await mirror(db, after, "rescheduled", now);
              return { changed, event: after.googleEventId };
            } catch (err) {
              if (err instanceof SlotTaken) throw refuse(err.message, 409);
              if (err instanceof Unchangeable) throw refuse(err.message, 409);
              throw err;
            }
          });
          const host = deps.host;
          if (moved.changed && host && rules.account && moved.event) {
            const [account, event] = [rules.account, moved.event];
            await f.google(ctx, "event move", async () => {
              const made = await host.move(
                account,
                event,
                start,
                new Date(start.getTime() + rules.length * MIN),
                rules.zone,
              );
              await setEvent(db, id, made);
              return made;
            });
          }
          if (moved.changed) {
            await f.mail(ctx, "moved", id, rules.title);
            f.queueReminders(ctx, id, start, now);
          }
          return ctx.run("view", async () => {
            const b = await bookingById(db, id);
            if (!b) throw refuse("no such call", 404);
            return viewOf(b, rules.title, now);
          });
        },
      ),

      cancel: serviceHandler(
        {
          input: z.looseObject({ token: z.string(), reason: z.string().max(500).optional() }),
          effect: "sends",
        },
        async (ctx: restate.Context, req: { token: string; reason?: string }) =>
          f.cancel(ctx, bookingOf(req?.token), {
            by: "booker",
            reason: req.reason?.trim() || null,
          }),
      ),

      /** A day or an hour before: mail the booker, once, if the call still starts then. */
      remind: serviceHandler(
        {
          input: z.looseObject({
            id: z.number().int(),
            start: z.string(),
            kind: z.enum(["day", "hour"]),
          }),
          effect: "sends",
          ingressPrivate: true,
        },
        async (ctx: restate.Context, req: RemindRequest): Promise<{ sent: boolean }> => {
          const rules = await f.rulesNow(ctx);
          const now = new Date(await ctx.date.now());
          const due = await ctx.run("due", async () => {
            const b = await bookingById(db, req.id);
            if (!b || b.state !== "booked" || b.start.toISOString() !== req.start) return false;
            if (b.start <= now) return false;
            return (req.kind === "day" ? b.remindedDayAt : b.remindedHourAt) === null;
          });
          if (!due) return { sent: false };
          const sent = await f.mail(ctx, req.kind, req.id, rules.title);
          if (sent)
            await ctx.run("mark", async () => {
              await db
                .update(bookings)
                .set(req.kind === "day" ? { remindedDayAt: now } : { remindedHourAt: now })
                .where(eq(bookings.id, req.id));
            });
          return { sent };
        },
      ),
    },
  });
}

export type Calendar = ReturnType<typeof makeCalendar>;

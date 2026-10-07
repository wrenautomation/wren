/**
 * The tools' ports on Postgres: who a number is (the SMS contact behind it), our calendar
 * (`@wren/calendar`'s exported functions, nothing else), and messages. Node only.
 *
 * Booking claims the slot in `calendar.bookings` and mirrors it into `call_bookings`, so
 * follow-ups stop and the call counts. The Google event and the booker's mail are the Calendar
 * service's steps after a claim; a live call needs them too, through that service, at setup.
 */
import {
  type Booker,
  bookedCalls,
  claim,
  mirror,
  openSlots,
  rulesOf,
  SlotTaken,
  type Span,
} from "@wren/calendar";
import { smsContacts } from "@wren/channel-sms/schema";
import { companies, people } from "@wren/core/schema";
import type { Db } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { type LeadPort, type MessagePort, TimeTaken, type VoiceCalendar } from "./tools.js";
import type { LeadContext } from "./types.js";

const DAY = 86_400_000;

/** The newest SMS contact on the number, with its person and firm. */
export function leadsIn(db: Db): LeadPort {
  return {
    async byPhone(e164: string): Promise<LeadContext | null> {
      const [row] = await db
        .select({
          contact: smsContacts.name,
          person: people.fullName,
          email: smsContacts.email,
          company: companies.name,
          state: smsContacts.state,
        })
        .from(smsContacts)
        .leftJoin(people, eq(people.id, smsContacts.personId))
        .leftJoin(companies, eq(companies.id, smsContacts.companyId))
        .where(eq(smsContacts.e164, e164))
        .orderBy(desc(smsContacts.createdAt))
        .limit(1);
      if (!row) return null;
      return {
        name: row.person ?? row.contact ?? null,
        company: row.company ?? null,
        email: row.email ?? null,
        zone: null,
        notes: `Text thread: ${row.state}.`,
      };
    },
  };
}

export interface CalendarDeps {
  /** Whose calendar: "wren", as `calendar.bookings.calendar` holds it. */
  calendar: string;
  /** The calendar part's settings block, as the Calendar service reads it. */
  settings: () => Promise<unknown>;
  /** The owner's busy times. Must fail closed: a throw offers nothing. */
  busy: (account: string, from: Date, to: Date) => Promise<Span[]>;
}

/** Our calendar for a call: open times and a claim, through `@wren/calendar`. */
export function calendarIn(db: Db, deps: CalendarDeps): VoiceCalendar {
  const rulesNow = async () => rulesOf((await deps.settings()) ?? {});
  const busyFor = async (account: string | null, from: Date, to: Date) =>
    account ? deps.busy(account, from, to) : [];
  return {
    async open({ now, max }) {
      const rules = await rulesNow();
      const to = new Date(now.getTime() + Math.min(rules.days, 14) * DAY);
      const [busy, calls] = await Promise.all([
        busyFor(rules.account, now, to),
        bookedCalls(db, deps.calendar, new Date(now.getTime() - DAY), new Date(to.getTime() + DAY)),
      ]);
      return openSlots(rules, { from: now, to, now, busy, calls }).slice(0, max);
    },
    async book({ start, name, email, zone, now }) {
      const rules = await rulesNow();
      const busy = await busyFor(
        rules.account,
        new Date(start.getTime() - DAY),
        new Date(start.getTime() + DAY),
      );
      const booker: Booker = {
        name,
        email,
        zone,
        offer: null,
        code: null,
        application: null,
        source: { utm_source: "voice" },
      };
      try {
        const row = await claim(db, { calendar: deps.calendar, rules, start, booker, now, busy });
        await mirror(db, row, "created", now);
        return { id: row.id, start: row.start };
      } catch (err) {
        if (err instanceof SlotTaken) throw new TimeTaken();
        throw err;
      }
    },
  };
}

/**
 * Messages stay on the call's row (`voice_calls.message`), which the Voice app lists. Posting
 * them to the lead's SMS thread and notifying the team is a setup step.
 */
export const messagesOnCall: MessagePort = { take: async () => {} };

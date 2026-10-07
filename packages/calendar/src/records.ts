/**
 * Calls booked on our calendar, as console records: the portal's Calendar app lists them by
 * status, and its buttons (CalendarConsole) say how a past one went or cancel an upcoming one.
 * Its detail is the pre-call brief of its mirror in `call_bookings`. Wren's own calls, so Wren's
 * team.
 */
import { briefOf } from "@wren/channel-email/calls";
import { callBookings } from "@wren/channel-email/schema";
import { MEETING_OUTCOMES, outcomeStatus } from "@wren/core/calls";
import { date, defineRecord, link, name, status, text } from "@wren/core/records";
import { eq } from "drizzle-orm";
import { mirrorUid } from "./book.js";

export const BOOKING_STATUS = {
  upcoming: { label: "Upcoming", tone: "warn" },
  past: { label: "Say how it went", tone: "neutral" },
  ...outcomeStatus(MEETING_OUTCOMES),
  cancelled: { label: "Cancelled", tone: "neutral" },
} as const;
const DONE = [...MEETING_OUTCOMES];

export const bookingRecord = defineRecord({
  id: "calendar.booking",
  app: "calendar",
  channel: null,
  name: { one: "call", many: "calls" },
  view: "calendar.booking_records",
  key: "id",
  title: "name",
  subtitle: "email",
  fields: {
    name: name("Who"),
    email: text("Email"),
    status: status(BOOKING_STATUS),
    start: date("When"),
    zone: text("Their zone"),
    offer: text("Offer"),
    source: text("Source"),
    code: text("Link code"),
    meet: link("Meet"),
    booked: date("Booked"),
    cancelledAt: date("Cancelled"),
    reason: text("Why cancelled"),
    outcomeReason: text("Why"),
    markedBy: text("Marked by"),
    marked: date("Marked"),
  },
  views: [
    {
      id: "upcoming",
      label: "Upcoming",
      where: { status: "upcoming" },
      sort: "start",
      at: "booked",
    },
    {
      id: "past",
      label: "Past",
      where: { status: ["past", ...DONE] },
      sort: "-start",
      at: "start",
    },
    { id: "no_show", label: "No-shows", where: { status: "no_show" }, sort: "-start", at: "start" },
    {
      id: "cancelled",
      label: "Cancelled",
      where: { status: "cancelled" },
      sort: "-start",
      at: "cancelledAt",
    },
    {
      id: "booked",
      label: "All booked",
      where: { status: ["upcoming", "past", ...DONE] },
      sort: "-booked",
      at: "booked",
    },
  ],
  actions: [
    "calendar.won",
    "calendar.notYet",
    "calendar.noShow",
    "calendar.notFit",
    "calendar.cancel",
  ],
  // The brief of its mirror: the same one cal.com's calls get.
  load: async (db, id) => {
    const n = Number(id);
    if (!Number.isSafeInteger(n)) return null;
    const [m] = await db
      .select({ id: callBookings.id })
      .from(callBookings)
      .where(eq(callBookings.uid, mirrorUid(n)));
    return m ? briefOf(db, String(m.id)) : null;
  },
});

export const CALENDAR_RECORDS = [bookingRecord];

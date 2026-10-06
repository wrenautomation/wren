/**
 * Calls booked on our calendar, as console records: the portal's Calendar app lists them by
 * status, and its buttons (CalendarConsole) say how a past one went or cancel an upcoming one.
 * Wren's own calls, so Wren's team.
 */
import { date, defineRecord, link, name, status, text } from "@wren/core/records";

export const BOOKING_STATUS = {
  upcoming: { label: "Upcoming", tone: "warn" },
  past: { label: "Say how it went", tone: "neutral" },
  held: { label: "Held", tone: "good" },
  no_show: { label: "No-show", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
} as const;

export const bookingRecord = defineRecord({
  id: "calendar.booking",
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
      where: { status: ["past", "held", "no_show"] },
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
      where: { status: ["upcoming", "past", "held", "no_show"] },
      sort: "-booked",
      at: "booked",
    },
  ],
  actions: ["calendar.held", "calendar.noShow", "calendar.cancel"],
});

export const CALENDAR_RECORDS = [bookingRecord];

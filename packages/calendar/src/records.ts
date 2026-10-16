/**
 * Calls booked on our calendar, as console records: the portal's Calendar app lists them by
 * status, and its buttons (CalendarConsole) say how a past one went or cancel an upcoming one.
 * Its detail is the pre-call brief of its mirror in `call_bookings`. Wren's own calls, so Wren's
 * team.
 */
import { briefOf, type CallNotes, type Segment } from "@wren/channel-email/calls";
import { callBookings, callRecordings } from "@wren/channel-email/schema";
import { MEETING_OUTCOMES, outcomeStatus } from "@wren/core/calls";
import { date, defineRecord, link, name, number, status, text } from "@wren/core/records";
import { eq, sql } from "drizzle-orm";
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

/** What a recording's page plays and reads: the mp4 signed for a few minutes, the notes, the words. */
export interface RecordingDetail {
  url: string | null;
  notes: CallNotes | null;
  model: string | null;
  segments: Segment[];
  booking: number | null;
}

/**
 * Calls recorded on William's Mac (designs/2026-10-16-call-recording.md), newest first: who, when,
 * how long and the summary. Opening one signs its mp4 (`signGet`, the files bucket); with no
 * bucket here the page still shows the notes and transcript.
 */
export const recordingRecord = (signGet?: (key: string) => Promise<string>) =>
  defineRecord({
    id: "calendar.recording",
    app: "calendar",
    channel: null,
    name: { one: "recording", many: "recordings" },
    rows: async (db) =>
      await db.execute<Record<string, unknown>>(sql`
        select r.id, r.started_at started, round(r.duration_s / 60.0)::int mins, r.by::text by,
          r.notes->>'summary' summary, cb.email::text email,
          coalesce(nullif(cb.name, ''), cb.email, 'Not a booked call')::text who
        from call_recordings r left join call_bookings cb on cb.id = r.call_booking_id`),
    key: "id",
    title: "who",
    subtitle: "email",
    fields: {
      who: name("Who"),
      started: date("When"),
      mins: number("Minutes"),
      summary: text("Summary"),
      by: status({
        desk: { label: "Booked call", tone: "neutral" },
        manual: { label: "Record now", tone: "neutral" },
      }, "Started by"),
      email: text("Email"),
    },
    views: [{ id: "all", label: "All", sort: "-started", at: "started" }],
    load: async (db, id): Promise<RecordingDetail | null> => {
      const n = Number(id);
      if (!Number.isSafeInteger(n) || n <= 0) return null;
      const [r] = await db.select().from(callRecordings).where(eq(callRecordings.id, n));
      if (!r) return null;
      return {
        url: signGet ? await signGet(r.fileKey) : null,
        notes: (r.notes as CallNotes | null) ?? null,
        model: r.model,
        segments: (r.segments as Segment[]) ?? [],
        booking: r.callBookingId,
      };
    },
  });

export const CALENDAR_RECORDS = [bookingRecord];

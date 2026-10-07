/**
 * The booker's mail: booked, moved, cancelled, and the reminders a day and an hour before.
 * Plain text from Wren's portal address, every time on the booker's own clock, and every mail
 * but the cancel carries their signed links to reschedule and to cancel. Google sends its own invite besides.
 */
import { canonicalZone } from "@wren/core/time";
import type { CalendarBooking } from "./schema.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Kind = "booked" | "moved" | "cancelled" | "day" | "hour";

/** The call's name: `{name}` in the title is the booker's. */
export const titleFor = (title: string, name: string) => title.replaceAll("{name}", name.trim());

/** "Tuesday, October 6 at 11:00 AM EDT" on `zone`'s clock; Toronto's when it isn't a zone. */
export function whenOn(zone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: canonicalZone(zone) ?? "America/Toronto",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
    .format(at)
    .replace(/\s/g, " ");
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** One mail about `b`. `manage` is its signed link; `rebook` is where to book again. */
export function mailFor(
  kind: Kind,
  b: CalendarBooking,
  o: { title: string; manage: string; rebook: string | null },
): Mail {
  const title = titleFor(o.title, b.name);
  const when = whenOn(b.zone, b.start);
  const join = b.meetUrl ? `Join: ${b.meetUrl}` : "The calendar invite has the link.";
  const hi = firstName(b.name) ? `Hi ${firstName(b.name)},` : "Hi,";
  // Both links carry the booking's signed token; the page opens on the one asked for.
  const change = [`Reschedule: ${o.manage}?do=move`, `Cancel: ${o.manage}?do=cancel`].join("\n");
  const lines: Record<Kind, { subject: string; body: string[] }> = {
    booked: {
      subject: `Booked: ${title}, ${when}`,
      body: [`You're booked for ${title}.`, "", `When: ${when}`, join, "", change],
    },
    moved: {
      subject: `Moved: ${title}, ${when}`,
      body: [`${title} has a new time.`, "", `When: ${when}`, join, "", change],
    },
    cancelled: {
      subject: `Cancelled: ${title}`,
      body: [
        `Your call on ${when} is cancelled.`,
        ...(o.rebook ? ["", `Book another time: ${o.rebook}`] : []),
      ],
    },
    day: {
      subject: `Tomorrow: ${title}`,
      body: [`${title} is tomorrow.`, "", `When: ${when}`, join, "", change],
    },
    hour: {
      subject: `In an hour: ${title}`,
      body: [`${title} starts in an hour.`, "", `When: ${when}`, join, "", change],
    },
  };
  const { subject, body } = lines[kind];
  return { to: b.email, subject, text: [hi, "", ...body, "", "Wren"].join("\n") };
}

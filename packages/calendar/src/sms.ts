/**
 * Our calls as SmsWatch reads bookings, so its reminder pass texts them with the consent,
 * number and cap checks it already has. The uid carries the start, so a moved call gets its own
 * texts. `AllBookings` reads ours next to cal.com's while both take bookings.
 */
import type { Booking, Bookings } from "@wren/channel-sms";
import type { Queryable } from "@wren/db";
import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { bookings } from "./schema.js";

export class CalendarBookings implements Bookings {
  readonly name = "calendar";
  constructor(
    private readonly db: Queryable,
    private readonly calendar = "wren",
    private readonly now: () => Date = () => new Date(),
  ) {}

  async booked(email: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.calendar, this.calendar),
          eq(bookings.state, "booked"),
          gt(bookings.start, this.now()),
          sql`lower(${bookings.email}) = ${email.trim().toLowerCase()}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async upcoming(from: Date, to: Date): Promise<Booking[]> {
    const rows = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.calendar, this.calendar),
          eq(bookings.state, "booked"),
          gte(bookings.start, from),
          lt(bookings.start, to),
        ),
      )
      .orderBy(asc(bookings.start));
    return rows.map((b) => ({
      uid: `wren-${b.id}-${Math.floor(b.start.getTime() / 1000)}`,
      start: b.start,
      createdAt: b.createdAt,
      name: b.name,
      email: b.email,
      timeZone: b.zone,
      application: b.application,
    }));
  }
}

/** Several sources as one: booked if any says so, every upcoming call. Throws if any can't tell. */
export class AllBookings implements Bookings {
  readonly name: string;
  constructor(private readonly sources: readonly Bookings[]) {
    this.name = sources.map((s) => s.name).join(" + ");
  }

  async booked(email: string): Promise<boolean> {
    for (const s of this.sources) if (await s.booked(email)) return true;
    return false;
  }

  async upcoming(from: Date, to: Date): Promise<Booking[]> {
    const all = await Promise.all(this.sources.map((s) => s.upcoming(from, to)));
    return all.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}

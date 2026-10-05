/**
 * Calls booked on cal.com. The form follow-up asks whether someone booked
 * before its first text, so someone who booked from the page never gets a
 * "pick a time" text. The reminder pass lists the calls coming up.
 */

/** One booked call, as the reminder pass needs it. */
export interface Booking {
  uid: string;
  start: Date;
  createdAt: Date;
  /** The first attendee: the person who booked. */
  name: string | null;
  email: string;
  /** Their IANA zone as cal.com has it; null when it gave none. */
  timeZone: string | null;
  /** The lander's application id, from the link's `metadata[application]`. */
  application: string | null;
}

export interface Bookings {
  name: string;
  /** True when `email` holds an upcoming or unconfirmed booking. Throws when it cannot tell. */
  booked(email: string): Promise<boolean>;
  /** Accepted calls starting in [from, to). Throws when it cannot tell. */
  upcoming(from: Date, to: Date): Promise<Booking[]>;
}

const CALCOM = "https://api.cal.com/v2/bookings";
const PAGE = 100;
const MAX_PAGES = 10;

/** One booking as cal.com's v2 list returns it. */
export interface CalcomBooking {
  uid: string;
  status: string;
  start: string;
  createdAt: string;
  attendees?: { name?: string; email?: string; timeZone?: string }[];
  metadata?: Record<string, unknown> | null;
  rescheduledFromUid?: string | null;
  rescheduledToUid?: string | null;
  rescheduled?: boolean | null;
}

export class CalcomBookings implements Bookings {
  readonly name = "cal.com";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  private async list(params: Record<string, string>): Promise<CalcomBooking[]> {
    const url = new URL(CALCOM);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.apiKey}`, "cal-api-version": "2024-08-13" },
    });
    if (!res.ok) throw new Error(`cal.com answered ${res.status}`);
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error("cal.com answered with no bookings list");
    return body.data as CalcomBooking[];
  }

  async booked(email: string): Promise<boolean> {
    const rows = await this.list({
      attendeeEmail: email,
      status: "upcoming,unconfirmed",
      take: "1",
    });
    return rows.length > 0;
  }

  async upcoming(from: Date, to: Date): Promise<Booking[]> {
    const out: Booking[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await this.list({
        status: "upcoming",
        afterStart: from.toISOString(),
        beforeEnd: to.toISOString(),
        sortStart: "asc",
        take: String(PAGE),
        skip: String(page * PAGE),
      });
      for (const b of rows) {
        const who = b.attendees?.[0];
        if (b.status !== "accepted" || !who?.email) continue;
        const application = b.metadata?.application;
        out.push({
          uid: b.uid,
          start: new Date(b.start),
          createdAt: new Date(b.createdAt),
          name: who.name?.trim() || null,
          email: who.email,
          timeZone: who.timeZone || null,
          application: typeof application === "string" && application ? application : null,
        });
      }
      if (rows.length < PAGE) return out.filter((b) => b.start >= from && b.start < to);
    }
    throw new Error(`more than ${PAGE * MAX_PAGES} upcoming calls on cal.com`);
  }

  /** Every booking starting from `since`, any status, as cal.com lists it. Throws when it cannot tell. */
  async history(since: Date): Promise<CalcomBooking[]> {
    const out: CalcomBooking[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await this.list({
        afterStart: since.toISOString(),
        sortStart: "asc",
        take: String(PAGE),
        skip: String(page * PAGE),
      });
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
    throw new Error(`more than ${PAGE * MAX_PAGES} calls on cal.com since ${since.toISOString()}`);
  }
}

/** Tests: the emails given have booked; `calls` are the upcoming ones. */
export class FakeBookings implements Bookings {
  readonly name = "fake";
  readonly asked: string[] = [];
  constructor(
    private readonly emails: Iterable<string> = [],
    readonly calls: Booking[] = [],
  ) {}

  async booked(email: string): Promise<boolean> {
    this.asked.push(email);
    return new Set(this.emails).has(email);
  }

  async upcoming(from: Date, to: Date): Promise<Booking[]> {
    return this.calls.filter((b) => b.start >= from && b.start < to);
  }
}

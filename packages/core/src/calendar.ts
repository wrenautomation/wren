/**
 * The calendar a call is booked on. Cold email offers two of its open times
 * and books the one a lead says yes to; cal.com then emails them the invite.
 * One event type for the fleet: the offer's booking page names it
 * (`https://cal.com/<username>/<slug>`).
 */

export interface Attendee {
  name: string;
  email: string;
  /** Their IANA zone, so the invite reads in their clock. */
  timeZone: string;
}

export interface Calendar {
  readonly name: string;
  /** Open start times in [from, to), ascending. Throws when it cannot tell. */
  open(from: Date, to: Date): Promise<Date[]>;
  /** Book `start` for the attendee; the calendar emails the invite. Returns the booking's id. */
  book(start: Date, attendee: Attendee, metadata?: Record<string, string>): Promise<string>;
  /** True when `email` already holds an upcoming booking. Throws when it cannot tell. */
  booked(email: string): Promise<boolean>;
}

const API = "https://api.cal.com/v2";

/** `https://cal.com/wrenautomation/call` → its username and event slug, or null for any other shape. */
export function calcomEvent(bookingUrl: string): { username: string; slug: string } | null {
  let url: URL;
  try {
    url = new URL(bookingUrl);
  } catch {
    return null;
  }
  const [username, slug, ...rest] = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "cal.com" || !username || !slug || rest.length) return null;
  return { username, slug };
}

export class CalcomCalendar implements Calendar {
  readonly name = "cal.com";
  constructor(
    private readonly apiKey: string,
    private readonly event: { username: string; slug: string },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  private async call(path: string, version: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "cal-api-version": version,
        "content-type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`cal.com answered ${res.status} on ${path.split("?")[0]}`);
    const body = (await res.json()) as { data?: unknown };
    return body.data;
  }

  async open(from: Date, to: Date): Promise<Date[]> {
    const q = new URLSearchParams({
      eventTypeSlug: this.event.slug,
      username: this.event.username,
      start: from.toISOString(),
      end: to.toISOString(),
      timeZone: "UTC",
    });
    const data = await this.call(`/slots?${q}`, "2024-09-04");
    if (data === null || typeof data !== "object") throw new Error("cal.com answered no slots");
    const out: Date[] = [];
    for (const day of Object.values(data as Record<string, { start?: string }[]>)) {
      for (const s of Array.isArray(day) ? day : []) {
        const at = s.start ? new Date(s.start) : null;
        if (at && !Number.isNaN(at.getTime()) && at >= from && at < to) out.push(at);
      }
    }
    return out.sort((a, b) => a.getTime() - b.getTime());
  }

  async book(
    start: Date,
    attendee: Attendee,
    metadata: Record<string, string> = {},
  ): Promise<string> {
    const data = (await this.call("/bookings", "2024-08-13", {
      method: "POST",
      body: JSON.stringify({
        start: start.toISOString(),
        eventTypeSlug: this.event.slug,
        username: this.event.username,
        attendee,
        metadata,
      }),
    })) as { uid?: string } | null;
    if (!data?.uid) throw new Error("cal.com booked with no uid");
    return data.uid;
  }

  async booked(email: string): Promise<boolean> {
    const q = new URLSearchParams({
      attendeeEmail: email,
      status: "upcoming,unconfirmed",
      take: "1",
    });
    const data = await this.call(`/bookings?${q}`, "2024-08-13");
    if (!Array.isArray(data)) throw new Error("cal.com answered with no bookings list");
    return data.length > 0;
  }
}

/** Tests: `slots` are open until booked; `bookings` records every booking made. */
export class FakeCalendar implements Calendar {
  readonly name = "fake";
  readonly bookings: { start: Date; attendee: Attendee; uid: string }[] = [];
  constructor(
    private slots: Date[] = [],
    private readonly already: Iterable<string> = [],
  ) {}

  async open(from: Date, to: Date): Promise<Date[]> {
    return this.slots.filter((s) => s >= from && s < to);
  }

  async book(start: Date, attendee: Attendee): Promise<string> {
    if (!this.slots.some((s) => s.getTime() === start.getTime())) throw new Error("slot taken");
    this.slots = this.slots.filter((s) => s.getTime() !== start.getTime());
    const uid = `fake-${this.bookings.length + 1}`;
    this.bookings.push({ start, attendee, uid });
    return uid;
  }

  async booked(email: string): Promise<boolean> {
    return (
      new Set(this.already).has(email) || this.bookings.some((b) => b.attendee.email === email)
    );
  }
}

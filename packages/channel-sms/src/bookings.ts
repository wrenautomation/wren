/**
 * Has this person booked a call? The form follow-up asks before its first
 * text, so someone who booked from the page never gets a "pick a time" text.
 */

export interface Bookings {
  name: string;
  /** True when `email` holds an upcoming or unconfirmed booking. Throws when it cannot tell. */
  booked(email: string): Promise<boolean>;
}

const CALCOM = "https://api.cal.com/v2/bookings";

export class CalcomBookings implements Bookings {
  readonly name = "cal.com";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async booked(email: string): Promise<boolean> {
    const url = new URL(CALCOM);
    url.searchParams.set("attendeeEmail", email);
    url.searchParams.set("status", "upcoming,unconfirmed");
    url.searchParams.set("take", "1");
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.apiKey}`, "cal-api-version": "2024-08-13" },
    });
    if (!res.ok) throw new Error(`cal.com answered ${res.status}`);
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error("cal.com answered with no bookings list");
    return body.data.length > 0;
  }
}

/** Tests: the emails given have booked. */
export class FakeBookings implements Bookings {
  readonly name = "fake";
  readonly asked: string[] = [];
  constructor(private readonly emails: Iterable<string> = []) {}

  async booked(email: string): Promise<boolean> {
    this.asked.push(email);
    return new Set(this.emails).has(email);
  }
}

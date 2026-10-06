/**
 * The calendar a booking lands on: Google Calendar over its REST API, acting as the account by
 * domain-wide delegation (the service account Gmail sending already uses, on the `calendar`
 * scope). Busy times come from free/busy; a booking is an event with a Meet link, and Google
 * mails the invite (`sendUpdates=all`). The event id is ours, so a retried insert finds the
 * first one instead of making two. Tests use `FakeHost`, never Google.
 */
import type { TokenSupplier } from "@wren/channel-email/send";
import type { Span } from "./slots.js";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const API = "https://www.googleapis.com/calendar/v3";

export interface NewEvent {
  /** Base32hex (a to v, 0 to 9), 5 to 1024 long: `eventIdOf`. */
  id: string;
  title: string;
  start: Date;
  end: Date;
  /** The owner's zone, so the event reads right in their calendar. */
  zone: string;
  attendee: { email: string; name: string };
  description: string;
}

export interface Made {
  eventId: string;
  meetUrl: string | null;
}

/** A calendar a booking can land on. Every call throws when it can't do what it says. */
export interface CalendarHost {
  readonly name: string;
  busy(account: string, from: Date, to: Date): Promise<Span[]>;
  create(account: string, event: NewEvent): Promise<Made>;
  move(account: string, eventId: string, start: Date, end: Date, zone: string): Promise<Made>;
  /** Gone already is fine. */
  remove(account: string, eventId: string): Promise<void>;
}

/** Our event id for a booking: only Google's base32hex letters. */
export const eventIdOf = (id: number, createdAt: Date) =>
  `bk${id}t${Math.floor(createdAt.getTime() / 1000).toString(32)}`;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface GoogleEvent {
  id: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

const meetOf = (e: GoogleEvent): string | null =>
  e.hangoutLink ??
  e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ??
  null;

export class GoogleHost implements CalendarHost {
  readonly name = "google";
  private readonly fetch: Fetch;
  private readonly tokens = new Map<string, TokenSupplier>();
  constructor(
    /** A bearer supplier acting as `account` on the calendar scope. */
    private readonly tokenFor: (account: string) => TokenSupplier,
    fetchImpl?: Fetch,
  ) {
    this.fetch = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async call(account: string, method: string, path: string, body?: unknown) {
    let token = this.tokens.get(account);
    if (!token) {
      token = this.tokenFor(account);
      this.tokens.set(account, token);
    }
    return this.fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async ok<T>(res: Response, what: string): Promise<T> {
    if (!res.ok)
      throw new Error(`Google Calendar ${what}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async busy(account: string, from: Date, to: Date): Promise<Span[]> {
    const res = await this.call(account, "POST", "/freeBusy", {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: account }],
    });
    const body = await this.ok<{
      calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
    }>(res, "free/busy");
    const cal = body.calendars?.[account];
    if (!cal || cal.errors?.length)
      throw new Error(`Google Calendar free/busy: no calendar for ${account}`);
    return (cal.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  private async get(account: string, eventId: string): Promise<GoogleEvent> {
    const res = await this.call(
      account,
      "GET",
      `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    );
    return this.ok<GoogleEvent>(res, "event");
  }

  async create(account: string, e: NewEvent): Promise<Made> {
    const res = await this.call(
      account,
      "POST",
      "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        id: e.id,
        summary: e.title,
        description: e.description,
        start: { dateTime: e.start.toISOString(), timeZone: e.zone },
        end: { dateTime: e.end.toISOString(), timeZone: e.zone },
        attendees: [{ email: e.attendee.email, displayName: e.attendee.name }],
        conferenceData: {
          createRequest: { requestId: e.id, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
        guestsCanInviteOthers: false,
      },
    );
    // A retry after Google took it: the id is ours, so the first one is there.
    let made =
      res.status === 409
        ? await this.get(account, e.id)
        : await this.ok<GoogleEvent>(res, "insert");
    // Meet can lag the insert by a moment.
    if (!meetOf(made)) made = await this.get(account, made.id);
    return { eventId: made.id, meetUrl: meetOf(made) };
  }

  async move(
    account: string,
    eventId: string,
    start: Date,
    end: Date,
    zone: string,
  ): Promise<Made> {
    const res = await this.call(
      account,
      "PATCH",
      `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        start: { dateTime: start.toISOString(), timeZone: zone },
        end: { dateTime: end.toISOString(), timeZone: zone },
      },
    );
    const moved = await this.ok<GoogleEvent>(res, "move");
    return { eventId: moved.id, meetUrl: meetOf(moved) };
  }

  async remove(account: string, eventId: string): Promise<void> {
    const res = await this.call(
      account,
      "DELETE",
      `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    );
    if (res.ok || res.status === 404 || res.status === 410) return;
    throw new Error(`Google Calendar delete: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** Tests: busy times you hand it, and a log of what it was asked to do. */
export class FakeHost implements CalendarHost {
  readonly name = "fake";
  readonly events = new Map<string, NewEvent & { account: string }>();
  readonly log: string[] = [];
  constructor(public busyTimes: Span[] = []) {}

  async busy(_account: string, from: Date, to: Date): Promise<Span[]> {
    return this.busyTimes.filter((b) => b.start < to && b.end > from);
  }

  async create(account: string, e: NewEvent): Promise<Made> {
    this.log.push(`create ${e.id}`);
    if (!this.events.has(e.id)) this.events.set(e.id, { ...e, account });
    return { eventId: e.id, meetUrl: `https://meet.example.test/${e.id}` };
  }

  async move(_account: string, eventId: string, start: Date, end: Date): Promise<Made> {
    this.log.push(`move ${eventId}`);
    const e = this.events.get(eventId);
    if (!e) throw new Error(`no event ${eventId}`);
    this.events.set(eventId, { ...e, start, end });
    return { eventId, meetUrl: `https://meet.example.test/${eventId}` };
  }

  async remove(_account: string, eventId: string): Promise<void> {
    this.log.push(`remove ${eventId}`);
    this.events.delete(eventId);
  }
}

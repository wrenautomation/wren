/**
 * The calendar a booking lands on: Google Calendar over its REST API, acting as the account by
 * domain-wide delegation (the service account Gmail sending already uses, on the `calendar`
 * scope). Busy times come from free/busy; a booking is an event with a Meet link. With `notify`
 * the booker is a guest and Google mails the invite (`sendUpdates=all`); without it the event
 * holds the slot on the owner's calendar only and Google mails no one (`sendUpdates=none`), as a
 * client's calendar does while its sends are off. The event id is ours, so a retried insert finds
 * the first one instead of making two. Tests use `FakeHost`, never Google.
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
  /** Invite the attendee and let Google mail them. False: no guest, no mail. */
  notify: boolean;
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
  move(
    account: string,
    eventId: string,
    start: Date,
    end: Date,
    zone: string,
    notify: boolean,
  ): Promise<Made>;
  /** Gone already is fine. */
  remove(account: string, eventId: string, notify: boolean): Promise<void>;
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

const updates = (notify: boolean) => `sendUpdates=${notify ? "all" : "none"}`;

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
      `/calendars/primary/events?conferenceDataVersion=1&${updates(e.notify)}`,
      {
        id: e.id,
        summary: e.title,
        description: e.description,
        start: { dateTime: e.start.toISOString(), timeZone: e.zone },
        end: { dateTime: e.end.toISOString(), timeZone: e.zone },
        attendees: e.notify ? [{ email: e.attendee.email, displayName: e.attendee.name }] : [],
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
    notify: boolean,
  ): Promise<Made> {
    const res = await this.call(
      account,
      "PATCH",
      `/calendars/primary/events/${encodeURIComponent(eventId)}?${updates(notify)}`,
      {
        start: { dateTime: start.toISOString(), timeZone: zone },
        end: { dateTime: end.toISOString(), timeZone: zone },
      },
    );
    const moved = await this.ok<GoogleEvent>(res, "move");
    return { eventId: moved.id, meetUrl: meetOf(moved) };
  }

  async remove(account: string, eventId: string, notify: boolean): Promise<void> {
    const res = await this.call(
      account,
      "DELETE",
      `/calendars/primary/events/${encodeURIComponent(eventId)}?${updates(notify)}`,
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
  /** Set to make every busy read fail, as Google does with the API off or no delegation. */
  down = false;
  constructor(public busyTimes: Span[] = []) {}

  async busy(_account: string, from: Date, to: Date): Promise<Span[]> {
    if (this.down) throw new Error("Google Calendar free/busy: 403");
    return this.busyTimes.filter((b) => b.start < to && b.end > from);
  }

  async create(account: string, e: NewEvent): Promise<Made> {
    this.log.push(`create ${e.id}${e.notify ? " notify" : ""}`);
    if (!this.events.has(e.id)) this.events.set(e.id, { ...e, account });
    return { eventId: e.id, meetUrl: `https://meet.example.test/${e.id}` };
  }

  async move(
    _account: string,
    eventId: string,
    start: Date,
    end: Date,
    _zone: string,
    notify: boolean,
  ): Promise<Made> {
    this.log.push(`move ${eventId}${notify ? " notify" : ""}`);
    const e = this.events.get(eventId);
    if (!e) throw new Error(`no event ${eventId}`);
    this.events.set(eventId, { ...e, start, end });
    return { eventId, meetUrl: `https://meet.example.test/${eventId}` };
  }

  async remove(_account: string, eventId: string, notify: boolean): Promise<void> {
    this.log.push(`remove ${eventId}${notify ? " notify" : ""}`);
    this.events.delete(eventId);
  }
}

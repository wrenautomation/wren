/**
 * The Calendar service through Restate, on a synthetic calendar: a fake Google and a mail
 * collector, never real events or real mail. Slots, a signed booking end to end (row, mirror,
 * event with Meet, confirmation, manage link), a refused double booking and a refused unsigned
 * one, a move, a cancel, the hour reminder, and the console's buttons.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeCalendarConsole } from "../../src/console.js";
import { FakeHost } from "../../src/google.js";
import { bookSig, readManage } from "../../src/links.js";
import type { Mail } from "../../src/mail.js";
import { type Calendar, type CalendarDeps, makeCalendar } from "../../src/restate.js";

const SHARED = "test-shared-secret";
const SITE = "https://site.example";
const sent: Mail[] = [];
const host = new FakeHost();
const leads = { day: 24 * 3_600_000, hour: 3_600_000 };
let pg: TestPostgres;
let env: RestateTestEnvironment;

beforeAll(async () => {
  pg = await startTestPostgres();
  const deps: CalendarDeps = {
    db: pg.db,
    calendar: "wren",
    settings: async () => ({
      account: "owner@calendar.example",
      zone: "UTC",
      title: "Intro call with {name}",
      hours: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, "00:00-24:00"]),
      ),
      length: 10,
      step: 5,
      notice: 0,
      buffer: 0,
      perDay: 48,
      days: 3,
    }),
    host,
    shared: SHARED,
    site: SITE,
    send: async (m) => {
      sent.push(m);
    },
    leads,
  };
  env = await startTestRestate({
    services: [makeCalendar(deps), makeCalendarConsole(deps)],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  sent.length = 0;
  host.events.clear();
  leads.day = 24 * 3_600_000;
  leads.hour = 3_600_000;
  await pg.db.execute(sql`truncate calendar.bookings, call_bookings restart identity`);
});

const cal = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<Calendar>({ name: "Calendar" });
const slots = async () => (await cal().slots({} as never)).slots;
const book = (start: string, email = "ana@firm.example", sig?: string) =>
  cal().book({
    offer: "intro",
    start,
    name: "Ana Example",
    email,
    zone: "America/Toronto",
    code: "r-synthetic",
    source: { utm_source: "email", junk: "dropped" },
    sig: sig ?? bookSig(SHARED, "intro", start, email),
  });
const calls = () =>
  pg.db.execute<{ uid: string; state: string; code: string | null }>(
    sql`select uid, state, code from call_bookings order by id`,
  );
const later = (list: string[], ms: number) =>
  list.find((s) => new Date(s).getTime() > Date.now() + ms) as string;

describe("Calendar", () => {
  it("books a signed slot end to end, and refuses it twice or unsigned", async () => {
    const open = await slots();
    expect(open.length).toBeGreaterThan(100);
    const start = later(open, 3 * 3_600_000);
    await expect(book(start, "ana@firm.example", "0".repeat(64))).rejects.toThrow(/unsigned/);
    const v = await book(start);
    expect(v).toMatchObject({
      state: "booked",
      start,
      name: "Ana Example",
      zone: "America/Toronto",
      title: "Intro call with Ana Example",
      open: true,
    });
    expect(v.meetUrl).toMatch(/^https:\/\/meet\.example\.test\//);
    expect(v.manage.startsWith(`${SITE}/booking/`)).toBe(true);
    const token = v.manage.split("/").pop() as string;
    expect(readManage(SHARED, token)).toBe(v.id);
    // The event, with the booker as its guest.
    const [event] = [...host.events.values()];
    expect(event).toMatchObject({
      account: "owner@calendar.example",
      title: "Intro call with Ana Example",
      attendee: { email: "ana@firm.example", name: "Ana Example" },
    });
    expect(event?.description).toContain(v.manage);
    // The shared path, and the source kept.
    expect(await calls()).toEqual([{ uid: `wren-${v.id}`, state: "booked", code: "r-synthetic" }]);
    const [row] = await pg.db.execute<{ source: Record<string, string> }>(
      sql`select source from calendar.bookings`,
    );
    expect(row?.source).toEqual({ utm_source: "email" });
    // The confirmation, on the booker's clock, with the link.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toMatch(/^Booked: Intro call with Ana Example, /);
    expect(sent[0]?.text).toContain(v.manage);
    expect(sent[0]?.text).toMatch(/E[DS]T/);
    // The slot is gone, for anyone.
    await expect(book(start, "ben@firm.example")).rejects.toThrow(/taken/);
    expect(await slots()).not.toContain(start);
  });

  it("moves and cancels by the manage link", async () => {
    const open = await slots();
    const v = await book(later(open, 3 * 3_600_000));
    const token = v.manage.split("/").pop() as string;
    expect(await cal().booking({ token })).toMatchObject({ id: v.id, state: "booked" });
    await expect(cal().booking({ token: `${token}x` })).rejects.toThrow(/isn't valid/);
    const to = later(open, 6 * 3_600_000);
    const moved = await cal().reschedule({ token, start: to });
    expect(moved.start).toBe(to);
    expect([...host.events.values()][0]?.start.toISOString()).toBe(to);
    expect(sent.map((m) => m.subject.split(":")[0])).toEqual(["Booked", "Moved"]);
    const gone = await cal().cancel({ token, reason: "conflict" });
    expect(gone).toMatchObject({ state: "cancelled", open: false });
    expect(host.events.size).toBe(0);
    expect(sent.map((m) => m.subject.split(":")[0])).toEqual(["Booked", "Moved", "Cancelled"]);
    expect(sent[2]?.text).toContain(`${SITE}/book/intro`);
    expect(await calls()).toEqual([
      { uid: `wren-${v.id}`, state: "cancelled", code: "r-synthetic" },
    ]);
    // Twice is once.
    await cal().cancel({ token });
    expect(sent).toHaveLength(3);
    await expect(cal().reschedule({ token, start: to })).rejects.toThrow(/cancelled/);
  });

  it("mails the hour reminder when it comes, once", async () => {
    const start = later(await slots(), 30_000);
    leads.hour = new Date(start).getTime() - Date.now() - 3_000;
    await book(start);
    const until = Date.now() + 20_000;
    while (sent.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    expect(sent.map((m) => m.subject)).toEqual([
      expect.stringMatching(/^Booked: /),
      "In an hour: Intro call with Ana Example",
    ]);
    const marked = async () =>
      (
        await pg.db.execute<{ hour: Date | null; day: Date | null }>(
          sql`select reminded_hour_at as hour, reminded_day_at as day from calendar.bookings`,
        )
      )[0];
    // The mark lands just after the mail.
    while (!(await marked())?.hour && Date.now() < until)
      await new Promise((r) => setTimeout(r, 100));
    const row = await marked();
    expect(row?.hour).not.toBeNull();
    expect(row?.day).toBeNull();
  });
});

describe("CalendarConsole", () => {
  const viewer = { email: "admin@wren.example", operator: true };
  const console_ = () =>
    clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() })).serviceClient<{
      noShow: (ctx: unknown, req: unknown) => Promise<{ changed: number }>;
      cancel: (ctx: unknown, req: unknown) => Promise<{ cancelled: number }>;
    }>({ name: "CalendarConsole" });

  it("refuses a stranger", async () => {
    await expect(
      console_().noShow({ viewer: { email: "stranger@else.example" }, ids: ["1"] }),
    ).rejects.toThrow();
  });

  it("an admin's cancel mails the booker and drops the event", async () => {
    await pg.db.execute(
      sql`insert into operators (email, role) values (${viewer.email}, 'admin') on conflict do nothing`,
    );
    const v = await book(later(await slots(), 3 * 3_600_000));
    expect(await console_().cancel({ viewer, ids: [String(v.id)], reason: "sick" })).toEqual({
      cancelled: 1,
    });
    expect(host.events.size).toBe(0);
    expect(sent.at(-1)?.subject).toMatch(/^Cancelled: /);
    const [row] = await pg.db.execute<{ cancelled_by: string; reason: string }>(
      sql`select cancelled_by, reason from calendar.bookings`,
    );
    expect(row).toEqual({ cancelled_by: viewer.email, reason: "sick" });
  });
});

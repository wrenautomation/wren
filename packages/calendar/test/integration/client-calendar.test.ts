/**
 * ClientCalendar through Restate, on synthetic clients with a fake Google and a mail collector:
 * a booking lands in the client's own database on its own account; with its sends off nothing
 * goes out (no guest on the event, no mail, Google told to mail no one); with them on the booker
 * gets the invite and the client-signed mail; manage links stay with their client; the spine
 * hears each change under the client; the client's Calendar app reads and marks its own calls.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, addMember, updateClient } from "@wren/core/clients";
import { SPINE, type SpineService } from "@wren/core/spine";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientAdminUrl, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeCalendarConsole } from "../../src/console.js";
import { FakeHost } from "../../src/google.js";
import { readManage } from "../../src/links.js";
import type { Mail } from "../../src/mail.js";
import {
  type CalendarDeps,
  type ClientCalendar,
  type ClientCalendarDeps,
  makeClientCalendar,
} from "../../src/restate.js";

const SHARED = "test-shared-secret";
const PORTAL = "https://portal.example";
const sent: (Mail & { from: string })[] = [];
const told: { kind: string; body: Record<string, unknown> }[] = [];
const host = new FakeHost();
const OPEN = {
  zone: "UTC",
  title: "Consult with {name}",
  hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, "00:00-24:00"]),
  ),
  length: 10,
  step: 5,
  notice: 0,
  buffer: 0,
  perDay: 48,
  days: 3,
};
let pg: TestPostgres;
let env: RestateTestEnvironment;
let acme: Db;
const open = (c: { database: string }) => cachedDb(clientDatabaseUrl(pg.url, c.database));

/** The spine, as the calendar tells it: emits and fires, kept. */
const spine = restate.service({
  name: "Spine",
  handlers: {
    emit: async (_: restate.Context, body: Record<string, unknown>) => {
      told.push({ kind: "emit", body });
    },
    fire: async (_: restate.Context, body: Record<string, unknown>) => {
      told.push({ kind: "fire", body });
    },
  },
});

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "acme",
    name: "Acme Dental",
    accounts: { google_calendar: "FrontDesk@acme.example" },
    // Its own `account` is Wren's field: a client's calendar is the account it connected.
    products: { "calendar.booking": { ...OPEN, account: "someone@else.example" } },
  });
  await addClient(pg.db, pg.url, {
    id: "gamma",
    name: "Gamma Law",
    accounts: { google_calendar: "desk@gamma.example" },
    products: { "calendar.booking": OPEN },
  });
  await updateClient(pg.db, "gamma", { sends: ["calendar.booking"] });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
  await addMember(pg.db, "acme", "owner@acme.example", { role: "owner" });
  acme = open({ database: "wren_client_acme" });
  const wren: CalendarDeps = {
    db: pg.db,
    calendar: "wren",
    settings: async () => OPEN,
    host,
    shared: SHARED,
    site: "https://site.example",
    send: null,
  };
  const deps: ClientCalendarDeps = {
    main: pg.db,
    open,
    host,
    shared: SHARED,
    portal: PORTAL,
    mailer: (from) => async (m) => {
      sent.push({ ...m, from });
    },
    fire: (ctx, req) => {
      ctx.serviceSendClient<SpineService>(SPINE).fire(req);
    },
  };
  env = await startTestRestate({
    services: [makeClientCalendar(deps), makeCalendarConsole({ wren, clients: deps }), spine],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  sent.length = 0;
  told.length = 0;
  host.events.clear();
  host.log.length = 0;
  for (const id of ["acme", "gamma"])
    await cachedDb(clientAdminUrl(pg.url, `wren_client_${id}`)).execute(
      sql`truncate calendar.bookings, call_bookings restart identity cascade`,
    );
});

const cal = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<ClientCalendar>({ name: "ClientCalendar" });
const later = (list: string[], ms: number) =>
  list.find((s) => new Date(s).getTime() > Date.now() + ms) as string;
const book = async (client: string, email = "ana@firm.example") => {
  const { slots } = await cal().slots({ client });
  return cal().book({
    client,
    tag: "consult",
    start: later(slots, 3 * 3_600_000),
    name: "Ana Example",
    email,
    zone: "America/Toronto",
  });
};
const waitFor = async (ok: () => boolean) => {
  const until = Date.now() + 15_000;
  while (!ok() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
};

describe("ClientCalendar", () => {
  it("shows the client's name and its own open times; none for a client without the part", async () => {
    const page = await cal().slots({ client: "acme" });
    expect(page).toMatchObject({
      owner: "Acme Dental",
      mails: false,
      meet: true,
      contact: [],
      zone: "UTC",
      length: 10,
    });
    expect((await cal().slots({ client: "gamma" })).mails).toBe(true);
    expect(page.title).toBe("Consult with {name}");
    expect(page.slots.length).toBeGreaterThan(100);
    await expect(cal().slots({ client: "beta" })).rejects.toThrow(/no booking page/);
    await expect(cal().slots({ client: "nobody" })).rejects.toThrow(/no booking page/);
  });

  it("with sends off: books into the client's database and sends nothing outside", async () => {
    const v = await book("acme");
    expect(v).toMatchObject({
      state: "booked",
      title: "Consult with Ana Example",
      offer: "consult",
    });
    expect(v.manage.startsWith(`${PORTAL}/c/acme/booking/`)).toBe(true);
    // Its own database, its own calendar; main has none.
    const rows = await acme.execute<{ calendar: string }>(
      sql`select calendar from calendar.bookings`,
    );
    expect(rows.map((r) => r.calendar)).toEqual(["acme"]);
    const [main] = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from calendar.bookings`,
    );
    expect(main?.n).toBe(0);
    // The slot held on the connected account, no guest, Google mails no one; no mail of ours.
    const [event] = [...host.events.values()];
    expect(event).toMatchObject({ account: "frontdesk@acme.example", notify: false });
    expect(event?.description).toContain("Ana Example <ana@firm.example>");
    expect(host.log).toEqual([expect.stringMatching(/^create \w+$/)]);
    expect(sent).toEqual([]);
    // The spine heard it as the client's: into `close`, and the Booking triggers.
    await waitFor(() => told.length >= 1);
    expect(told.find((t) => t.kind === "fire")?.body).toMatchObject({
      client: "acme",
      facts: { trigger: "trigger.booking", change: "booked" },
    });
    // Cancel by its link: still nothing outside.
    const token = v.manage.split("/").pop() as string;
    expect(await cal().cancel({ client: "acme", token })).toMatchObject({ state: "cancelled" });
    expect(host.log.at(-1)).toMatch(/^remove \w+$/);
    expect(sent).toEqual([]);
  });

  it("with sends on: Google invites the booker and the mail is signed by the client", async () => {
    const v = await book("gamma");
    expect([...host.events.values()][0]).toMatchObject({
      account: "desk@gamma.example",
      notify: true,
      attendee: { email: "ana@firm.example" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Gamma Law", to: "ana@firm.example" });
    expect(sent[0]?.text.endsWith("\nGamma Law")).toBe(true);
    expect(sent[0]?.text).toContain(`${PORTAL}/c/gamma/booking/`);
    const token = v.manage.split("/").pop() as string;
    await cal().cancel({ client: "gamma", token });
    expect(host.log.at(-1)).toMatch(/^remove \w+ notify$/);
    expect(sent.at(-1)?.text).toContain(`${PORTAL}/c/gamma/book/consult`);
  });

  it("a manage link opens only on its own client's page", async () => {
    const v = await book("acme");
    const token = v.manage.split("/").pop() as string;
    expect(readManage(SHARED, token, "acme")).toBe(v.id);
    expect(await cal().booking({ client: "acme", token })).toMatchObject({
      owner: "Acme Dental",
      id: v.id,
    });
    await expect(cal().booking({ client: "gamma", token })).rejects.toThrow(/isn't valid/);
    await expect(cal().cancel({ client: "gamma", token })).rejects.toThrow(/isn't valid/);
  });
});

describe("the client's Calendar app", () => {
  const owner = { email: "owner@acme.example" };
  const app = () =>
    clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() })).serviceClient<{
      range: (ctx: unknown, req: unknown) => Promise<{ calls: { id: number }[] }>;
      recordsList: (ctx: unknown, req: unknown) => Promise<{ rows: { id: number }[] }>;
      noShow: (ctx: unknown, req: unknown) => Promise<{ changed: number; done: number[] }>;
    }>({ name: "CalendarConsole" });

  it("its people read their own calls, mark one, and never Wren's or another client's", async () => {
    const v = await book("acme");
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 2 * 24 * 3_600_000).toISOString();
    const week = await app().range({ viewer: owner, client: "acme", from, to });
    expect(week.calls.map((c) => c.id)).toEqual([v.id]);
    const list = await app().recordsList({
      viewer: owner,
      client: "acme",
      record: "calendar.booking",
      view: "upcoming",
    });
    expect(list.rows.map((r) => Number(r.id))).toEqual([v.id]);
    await expect(app().range({ viewer: owner, client: "gamma", from, to })).rejects.toThrow();
    await expect(app().range({ viewer: owner, from, to })).rejects.toThrow();
    // Over now: the owner says how it went, on the client's own mirror.
    await acme.execute(
      sql`update call_bookings set start = now() - interval '1 hour' where uid = ${`wren-${v.id}`}`,
    );
    expect(await app().noShow({ viewer: owner, client: "acme", ids: [String(v.id)] })).toEqual({
      changed: 1,
      done: [v.id],
    });
    const [row] = await acme.execute<{ outcome: string }>(sql`select outcome from call_bookings`);
    expect(row?.outcome).toBe("no_show");
  });
});

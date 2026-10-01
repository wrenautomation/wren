/**
 * DeliveryWatch on a fixed clock: a welcome once per person, new asks and
 * deliverables in one message, the Friday digest by level, the weekly pulse,
 * operator pings that fire once and clear, and the ops board. The demo is
 * never mailed and never on the board.
 */
import { addMember, clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addInvoice, engagementOf, markInvoice, startEngagement } from "../../src/index.js";
import { deliveryApi } from "../../src/service.js";
import { opsBoard, type PortalMail, watchPass, workdaysAfter } from "../../src/watch.js";

let pg: TestPostgres;
let api: ReturnType<typeof deliveryApi>;
let pass: (at: string) => ReturnType<typeof watchPass>;

const OPS: Viewer = { email: "ops@wren.example", operator: true };
const AMY: Viewer = { email: "amy@acme.example" };
const acme = { client: "acme" };
const mail: PortalMail[] = [];
const pinged: { title: string; body: string }[] = [];
const notifier: Notifier = {
  name: "test",
  notify: async (title, body = "") => {
    pinged.push({ title, body });
    return true;
  },
};
const take = <T>(xs: T[]): T[] => xs.splice(0);

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PortalRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}

/** Moves the newest row of a delivery table to a moment on the test clock. */
const dated = (table: string, column: string, at: string) =>
  pg.db.execute(
    sql`update ${sql.raw(`delivery.${table}`)} set ${sql.raw(column)} = ${at}::timestamptz
        where id = (select max(id) from ${sql.raw(`delivery.${table}`)})`,
  );

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  await addMember(pg.db, "demo", "dee@demo.example");
  api = deliveryApi({ main: pg.db, demoName: "Demo" });
  await api.start({ viewer: OPS, ...acme, offerId: "reactivation", startsOn: "2026-10-05" });
  await startEngagement(pg.db, {
    clientId: "demo",
    offerId: "reactivation",
    startsOn: "2026-10-05",
    by: "seed",
  });
  const deps = {
    main: pg.db,
    send: async (m: PortalMail) => {
      mail.push(m);
    },
    app: "https://app.example",
    zone: "UTC",
    notifier,
  };
  pass = (at) => watchPass(deps, new Date(at));
});

afterAll(async () => {
  await pg?.stop();
});

describe("business days", () => {
  it("skip the weekend", () => {
    expect(workdaysAfter("2026-10-09", "2026-10-12", 3)).toBe(1);
    expect(workdaysAfter("2026-10-04", "2026-10-09", 3)).toBe(3);
  });
});

describe("client mail", () => {
  it("welcomes each person once, never the demo's", async () => {
    await pass("2026-10-05T10:00:00Z");
    const [welcome, ...rest] = take(mail);
    expect(rest).toEqual([]);
    expect(welcome?.to).toBe("amy@acme.example");
    expect(welcome?.subject).toBe("You're invited to Acme Staffing's project with Wren");
    expect(welcome?.text).toContain("https://app.example/work/home?client=acme");
    await pass("2026-10-05T10:30:00Z");
    expect(take(mail)).toEqual([]);
  });

  it("tells them about new asks and deliverables in one message, once", async () => {
    await api.ask({ viewer: OPS, ...acme, text: "Your ATS login", dueOn: "2026-10-20" });
    await dated("asks", "created_at", "2026-10-05T11:00:00Z");
    await api.deliver({
      viewer: OPS,
      ...acme,
      title: "Cleaned list",
      kind: "link",
      url: "https://docs.example.com/acme",
    });
    await dated("deliverables", "created_at", "2026-10-05T11:05:00Z");
    await pass("2026-10-05T12:00:00Z");
    const [told, ...rest] = take(mail);
    expect(rest).toEqual([]);
    expect(told?.subject).toBe("Acme Staffing: 2 things need you");
    expect(told?.text).toContain("- Your ATS login (by 2026-10-20)");
    expect(told?.text).toContain("- Cleaned list");
    expect(told?.text).toContain("https://app.example/account/you?client=acme");
    await pass("2026-10-05T13:00:00Z");
    expect(take(mail)).toEqual([]);
  });

  it("sets each person's level for themselves only", async () => {
    expect((await api.people({ viewer: AMY })).mail).toBe("all");
    expect((await api.people({ viewer: OPS, ...acme })).mail).toBeNull();
    expect(await refused(api.mail({ viewer: OPS, ...acme, level: "off" }))).toBe(403);
    expect(await refused(api.mail({ viewer: AMY, level: "loud" }))).toBe(400);
    await api.mail({ viewer: AMY, level: "digest" });
    expect((await api.people({ viewer: AMY })).mail).toBe("digest");

    await api.ask({ viewer: OPS, ...acme, text: "A second login" });
    await dated("asks", "created_at", "2026-10-05T14:00:00Z");
    await pass("2026-10-05T15:00:00Z");
    expect(take(mail)).toEqual([]);
  });

  it("an invited teammate is welcomed by who invited them", async () => {
    await api.invite({ viewer: AMY, email: "cal@acme.example" });
    await pass("2026-10-06T09:00:00Z");
    const [welcome] = take(mail);
    expect(welcome?.to).toBe("cal@acme.example");
    expect(welcome?.text).toContain("amy@acme.example added you");
  });
});

describe("the pulse", () => {
  it("is the client's people's, 1 to 5, once a week", async () => {
    expect(await refused(api.pulse({ viewer: OPS, ...acme, score: 4 }))).toBe(403);
    expect(await refused(api.pulse({ viewer: AMY, score: 6 }))).toBe(400);
    await api.pulse({ viewer: AMY, score: 4 });
    await api.pulse({ viewer: AMY, score: 2 });
    const [mine] = (await api.home({ viewer: AMY })).engagements;
    expect(mine?.pulse).toMatchObject({ mine: 2, scores: [] });
    const [ours] = (await api.home({ viewer: OPS, ...acme })).engagements;
    expect(ours?.pulse).toMatchObject({ mine: null, scores: [2] });
  });
});

describe("the Friday digest", () => {
  it("goes Friday afternoon to everyone not off, once, with the pulse links", async () => {
    await pass("2026-10-09T10:00:00Z");
    expect(take(mail).filter((m) => m.subject.includes("week"))).toEqual([]);
    await pass("2026-10-09T16:00:00Z");
    const digests = take(mail);
    expect(digests.map((m) => [m.to, m.subject]).sort()).toEqual([
      ["amy@acme.example", "Acme Staffing: your week with Wren"],
      ["cal@acme.example", "Acme Staffing: your week with Wren"],
    ]);
    const text = digests[0]?.text ?? "";
    expect(text).toContain("- Delivered: Cleaned list");
    expect(text).toMatch(/We need \d+ things from you/);
    expect(text).toMatch(/5 Great: https:\/\/app\.example\/work\/home\?client=acme&e=\d+&pulse=5/);
    await pass("2026-10-09T17:00:00Z");
    expect(take(mail)).toEqual([]);
  });
});

describe("operator pings", () => {
  it("pings once per problem, again only when a new one shows, and clears when fixed", async () => {
    // Friday morning's pass already saw the quiet week (last client-visible change Monday).
    const [quiet, ...more] = take(pinged);
    expect(more).toEqual([]);
    expect(quiet?.title).toBe("Delivery: 1 to look at");
    expect(quiet?.body).toBe("acme: nothing new for the client in 3+ business days");

    await dated("pulses", "at", "2026-10-09T09:00:00Z");
    await pass("2026-10-09T18:00:00Z");
    const [low, ...rest] = take(pinged);
    expect(rest).toEqual([]);
    expect(low?.body).toBe("acme: pulse 2/5 this week");
    await pass("2026-10-09T19:00:00Z");
    expect(take(pinged)).toEqual([]);

    await api.post({ viewer: OPS, ...acme, body: "List is clean." });
    await dated("updates", "created_at", "2026-10-09T19:30:00Z");
    await pass("2026-10-09T20:00:00Z");
    const rows = await pg.db.execute<{ about: string }>(
      sql`select about from delivery.pings order by about`,
    );
    expect(rows.map((r) => r.about)).toEqual([expect.stringMatching(/^pulse:\d+$/)]);
  });

  it("a client's comment pings until Wren replies; the reply is mailed at level all", async () => {
    const [u] = (await api.updates({ viewer: AMY })).updates;
    await api.comment({ viewer: AMY, updateId: u?.id ?? 0, body: "How many were dead?" });
    await api.comment({ viewer: AMY, updateId: u?.id ?? 0, body: "Roughly is fine." });
    await pass("2026-10-09T20:10:00Z");
    expect(take(pinged).map((p) => p.body)).toEqual([
      `acme: amy@acme.example wrote on update #${u?.id}, no reply yet: "How many were dead?"`,
    ]);
    take(mail);

    await api.comment({ viewer: OPS, ...acme, updateId: u?.id ?? 0, body: "388 of them." });
    await dated("comments", "created_at", "2026-10-09T20:15:00Z");
    await pass("2026-10-09T20:20:00Z");
    expect(take(pinged)).toEqual([]);
    const rows = await pg.db.execute<{ about: string }>(sql`select about from delivery.pings`);
    expect(rows.map((r) => r.about)).not.toContain(`reply:u${u?.id}`);
    // Amy gets the digest only; Cal gets everything.
    const [told, ...rest] = take(mail);
    expect(rest).toEqual([]);
    expect(told?.to).toBe("cal@acme.example");
    expect(told?.subject).toBe("Acme Staffing: Wren replied");
    expect(told?.text).toContain('- On "List is clean.": 388 of them.');
    expect(told?.text).toContain("https://app.example/work/updates?client=acme");
  });

  it("an invoice past its due day pings once, and clears when paid", async () => {
    await addInvoice(pg.db, await engagementOf(pg.db, "acme"), {
      number: "WREN-7",
      description: "Setup",
      cents: 100_000,
      issuedOn: "2026-09-25",
      dueOn: "2026-10-08",
      by: "ops@wren.example",
    });
    await pass("2026-10-09T20:30:00Z");
    expect(take(pinged).map((p) => p.body)).toEqual([
      "acme: invoice WREN-7 (USD 1000.00) unpaid, due 2026-10-08",
    ]);
    await pass("2026-10-09T20:40:00Z");
    expect(take(pinged)).toEqual([]);
    await markInvoice(pg.db, "acme", "WREN-7", "paid", "2026-10-09");
    await pass("2026-10-09T20:50:00Z");
    const rows = await pg.db.execute<{ about: string }>(sql`select about from delivery.pings`);
    expect(rows.map((r) => r.about).filter((a) => a.startsWith("invoice:"))).toEqual([]);
  });
});

describe("the ops board", () => {
  it("is Wren's only: every client, at risk first, the demo left out", async () => {
    expect(await refused(api.board({ viewer: AMY }))).toBe(403);
    expect(await refused(api.board({ viewer: { demo: true } }))).toBe(403);
    await pg.db
      .insert(clients)
      .values({ id: "able", name: "Able Search", database: "wren_client_able" });
    const rows = await opsBoard(pg.db, "UTC", new Date("2026-10-09T20:00:00Z"));
    expect(rows.map((r) => r.clientId)).toEqual(["acme", "able"]);
    expect(rows[0]).toMatchObject({
      offer: "Lead reactivation",
      phase: "Set up",
      stepsDone: 0,
      steps: 4,
      next: { name: "Set up", dueOn: "2026-10-18" },
      lastUpdateAt: "2026-10-09T19:30:00.000Z",
      openAsks: 7,
      pulse: 2,
      risks: ["pulse 2/5 this week"],
    });
    expect(rows[1]).toMatchObject({ engagementId: null, phase: null, risks: [] });
  });
});

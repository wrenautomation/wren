/**
 * DeliveryWatch on a fixed clock: a welcome once per person, new asks and
 * deliverables in one message, the Friday digest by level, the weekly pulse,
 * flags that raise once and clear themselves, told urgently or in the morning
 * digest, and the ops board. The demo is never mailed and never on the board.
 */
import { usageLines } from "@wren/books/schema";
import { addMember, clients, roleGrants, roles, updateClient } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { addAccount } from "@wren/core/setup";
import { setupAlert } from "@wren/core/setup-alerts";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addInvoice,
  type Bill,
  billCents,
  billLines,
  billsDue,
  engagementOf,
  markInvoice,
  onboard,
  signAgreement,
  startEngagement,
} from "../../src/index.js";
import { deliveryApi } from "../../src/service.js";
import { opsBoard, type PortalMail, recapOf, watchPass, workdaysAfter } from "../../src/watch.js";

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
/** Each flag the alerts named, "client: what", with its how on the same line. */
const named = (ps: { body: string }[]) =>
  ps.flatMap((p) =>
    p.body
      .replace(/\n {4}/g, " ")
      .split("\n")
      .filter((l) => /^[a-z]+: /.test(l)),
  );
/** The open flags' causes, oldest first. */
const open = async () =>
  (
    await pg.db.execute<{ cause: string }>(
      sql`select cause from delivery.flags where cleared_at is null order by id`,
    )
  ).map((r) => r.cause);

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
  // The offer's own asks are stamped now(); keep them off the test clock, or a run on its day mails them.
  await pg.db.execute(sql`update delivery.asks set created_at = '2026-10-04T00:00:00Z'`);
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
    expect(welcome?.text).toContain("https://app.example/reactivation/overview?client=acme");
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

  it("mails a setup step theirs to do once, only to people whose access reaches Accounts", async () => {
    // A role that reaches Marketing only: never mailed about accounts.
    await pg.db.insert(roles).values({ id: "acme.posts", client: "acme", name: "Posts" });
    await pg.db
      .insert(roleGrants)
      .values({ role: "acme.posts", verbs: ["read"], apps: ["marketing"] });
    await addMember(pg.db, "acme", "pat@acme.example", { role: "acme.posts" });
    await pass("2026-10-06T09:30:00Z");
    take(mail);
    const acct = await addAccount(pg.db, {
      client: "acme",
      site: "domain",
      ref: "send.acme.example",
      by: "op",
    });
    await setupAlert(pg.db, {
      kind: "waiting",
      account: acct,
      siteLabel: "Sending domain",
      step: { id: "dns", label: "Mail records", fact: "t.dns", who: "client" },
      mode: "self",
      why: "Add the records.",
      change: "t",
      now: new Date("2026-10-06T09:45:00Z"),
    });
    await pass("2026-10-06T10:00:00Z");
    const sent = take(mail);
    // Amy is on the digest; Cal is on all and a member; Pat's role stops at Marketing.
    expect(sent.map((m) => m.to)).toEqual(["cal@acme.example"]);
    expect(sent[0]?.subject).toBe("Acme Staffing: an account needs you");
    expect(sent[0]?.text).toContain('- Sending domain: "Mail records" needs you: Add the records.');
    expect(sent[0]?.text).toContain("https://app.example/account/accounts?client=acme");
    await pass("2026-10-06T11:00:00Z");
    expect(take(mail)).toEqual([]);
    // Pat was here for this alone: the mail counts below are Amy's and Cal's.
    await pg.db.execute(sql`delete from client_members where email = 'pat@acme.example'`);
  });
});

describe("the pulse", () => {
  it("is the client's people's, 1 to 5, once a week", async () => {
    expect(await refused(api.pulse({ viewer: OPS, ...acme, score: 4 }))).toBe(403);
    expect(await refused(api.pulse({ viewer: AMY, score: 6 }))).toBe(400);
    await api.pulse({ viewer: AMY, score: 4 });
    await api.pulse({ viewer: AMY, score: 2 });
    // Off the real clock, or a low score lands in the week the flags below look at.
    await dated("pulses", "at", "2026-09-28T09:00:00Z");
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
    const at = { main: pg.db, app: "https://app.example", zone: "UTC" };
    // The portal's preview is the mail itself.
    const preview = await recapOf(at, "acme", new Date("2026-10-09T16:00:00Z"));
    await pass("2026-10-09T16:00:00Z");
    const digests = take(mail);
    expect(preview).toEqual({ subject: digests[0]?.subject, text: digests[0]?.text });
    expect(digests.map((m) => [m.to, m.subject]).sort()).toEqual([
      ["amy@acme.example", "Acme Staffing: your week with Wren"],
      ["cal@acme.example", "Acme Staffing: your week with Wren"],
    ]);
    const text = digests[0]?.text ?? "";
    expect(text).toContain("- Delivered: Cleaned list");
    expect(text).toMatch(/We need \d+ things from you/);
    expect(text).toMatch(
      /5 Great: https:\/\/app\.example\/reactivation\/overview\?client=acme&e=\d+&pulse=5/,
    );
    await pass("2026-10-09T17:00:00Z");
    expect(take(mail)).toEqual([]);
  });
});

describe("flags", () => {
  it("raises each problem once, tells it in the morning digest, and clears it when fixed", async () => {
    // Friday morning's digest named the quiet week (last client-visible change Monday).
    expect(take(pinged).at(-1)).toEqual({
      title: "Clients: 1 to look at",
      body: "Team:\nacme: Nothing new for the client in 3+ business days",
    });

    await dated("pulses", "at", "2026-10-09T09:00:00Z");
    await pass("2026-10-09T18:00:00Z");
    // A rating of 2 is urgent: told on the next pass, not the morning's.
    expect(take(pinged)).toEqual([{ title: "Clients: 1 urgent", body: "acme: Weekly rating 2/5" }]);
    await pass("2026-10-09T19:00:00Z");
    expect(take(pinged)).toEqual([]);

    await api.post({ viewer: OPS, ...acme, body: "List is clean." });
    await dated("updates", "created_at", "2026-10-09T19:30:00Z");
    await pass("2026-10-09T20:00:00Z");
    expect((await open()).filter((c) => !c.startsWith("health:"))).toEqual([
      expect.stringMatching(/^pulse:\d+$/),
    ]);
    const [quiet] = await pg.db.execute<{ cleared_by: string }>(
      sql`select cleared_by from delivery.flags where cause = 'quiet'`,
    );
    expect(quiet?.cleared_by).toBe("pipeline:delivery-watch");
  });

  it("a client's comment is urgent until Wren replies; the reply is mailed at level all", async () => {
    const [u] = (await api.updates({ viewer: AMY })).updates;
    await api.comment({ viewer: AMY, updateId: u?.id ?? 0, body: "How many were dead?" });
    await api.comment({ viewer: AMY, updateId: u?.id ?? 0, body: "Roughly is fine." });
    await pass("2026-10-09T20:10:00Z");
    expect(named(take(pinged))).toEqual([
      `acme: amy@acme.example wrote on update #${u?.id}, no reply yet: "How many were dead?"`,
    ]);
    take(mail);

    await api.comment({ viewer: OPS, ...acme, updateId: u?.id ?? 0, body: "388 of them." });
    await dated("comments", "created_at", "2026-10-09T20:15:00Z");
    await pass("2026-10-09T20:20:00Z");
    expect(take(pinged)).toEqual([]);
    expect(await open()).not.toContain(`reply:u${u?.id}`);
    // Amy gets the digest only; Cal gets everything.
    const [told, ...rest] = take(mail);
    expect(rest).toEqual([]);
    expect(told?.to).toBe("cal@acme.example");
    expect(told?.subject).toBe("Acme Staffing: Wren replied");
    expect(told?.text).toContain('- On "List is clean.": 388 of them.');
    expect(told?.text).toContain("https://app.example/reactivation/updates?client=acme");
  });

  it("an invoice past its due day waits for the next digest, and clears when paid", async () => {
    await addInvoice(pg.db, await engagementOf(pg.db, "acme"), {
      number: "WREN-7",
      description: "Setup",
      cents: 100_000,
      issuedOn: "2026-09-25",
      dueOn: "2026-10-08",
      by: "ops@wren.example",
    });
    await pass("2026-10-09T20:30:00Z");
    // Today's digest went this morning.
    expect(take(pinged)).toEqual([]);
    expect(await open()).toContainEqual(expect.stringMatching(/^invoice:\d+$/));
    await markInvoice(pg.db, "acme", "WREN-7", "paid", "2026-10-09");
    await pass("2026-10-09T20:50:00Z");
    expect((await open()).filter((c) => c.startsWith("invoice:"))).toEqual([]);
  });
});

describe("moments, reviews and reminders (D13)", () => {
  const titled = (subject: string) => take(mail).filter((m) => m.subject === subject);

  it("reminds an owner once, in the morning, a few days before an invoice is due", async () => {
    await addInvoice(pg.db, await engagementOf(pg.db, "acme"), {
      number: "WREN-8",
      description: "Meetings, week 1",
      cents: 50_000,
      issuedOn: "2026-10-09",
      dueOn: "2026-10-16",
      by: "ops@wren.example",
    });
    await pass("2026-10-12T08:00:00Z");
    expect(titled("Acme Staffing: invoice WREN-8 due in 4 days")).toEqual([]);
    await pass("2026-10-12T10:00:00Z");
    const [told, ...rest] = titled("Acme Staffing: invoice WREN-8 due in 4 days");
    expect(rest).toEqual([]);
    expect(told?.to).toBe("amy@acme.example");
    expect(told?.text).toContain("Invoice WREN-8 for USD 500 is due 2026-10-16, in 4 days.");
    expect(told?.text).toContain("https://app.example/account/billing?client=acme");
    await pass("2026-10-13T10:00:00Z");
    expect(titled("Acme Staffing: invoice WREN-8 due in 3 days")).toEqual([]);
    await markInvoice(pg.db, "acme", "WREN-8", "paid", "2026-10-13");
  });

  it("the first meeting is a moment: one review mail each, once", async () => {
    await api.result({ viewer: OPS, ...acme, key: "meetings", value: 1 });
    await pass("2026-10-14T10:00:00Z");
    const sent = titled("Acme Staffing: Your first meeting is booked");
    expect(sent.map((m) => m.to).sort()).toEqual(["amy@acme.example", "cal@acme.example"]);
    expect(sent[0]?.text).toContain(
      "Excellent: https://app.example/reactivation/overview?client=acme&e=1&review=first%3Ameetings&score=5",
    );
    expect(sent[0]?.text).not.toContain("ready for more");
    await pass("2026-10-14T11:00:00Z");
    expect(titled("Acme Staffing: Your first meeting is booked")).toEqual([]);
    const [mine] = (await api.home({ viewer: AMY })).engagements;
    expect(mine?.moments).toMatchObject([
      { moment: "first:meetings", label: "Your first meeting is booked", mine: null, reviews: [] },
    ]);
    expect(mine?.next).toEqual([]);
  });

  it("a review is the client's people's, at a moment they reached; a good one is a flag", async () => {
    const at = { moment: "first:meetings" };
    expect(await refused(api.review({ viewer: OPS, ...acme, ...at, score: 5 }))).toBe(403);
    expect(await refused(api.review({ viewer: AMY, moment: "halfway", score: 5 }))).toBe(404);
    expect(await refused(api.review({ viewer: AMY, ...at, score: 6 }))).toBe(400);
    expect(await refused(api.review({ viewer: AMY, ...at, score: 5, mayQuote: "loud" }))).toBe(400);
    take(pinged);
    await api.review({ viewer: AMY, ...at, score: 4 });
    await api.review({
      viewer: AMY,
      ...at,
      score: 5,
      words: "Booked in week 2.",
      mayQuote: "named",
    });
    await api.review({ viewer: { email: "cal@acme.example" }, ...at, score: null });
    await pass("2026-10-14T12:00:00Z");
    // A quotable 5 is an opportunity, for tomorrow's digest; the 4 it replaced is gone.
    expect(take(pinged)).toEqual([]);
    const flags = await pg.db.execute<{ side: string; what: string; once: boolean }>(
      sql`select side, what, once from delivery.flags where cause like 'review:%'`,
    );
    expect(flags).toEqual([
      {
        side: "opportunity",
        once: true,
        what: 'amy@acme.example rated 5/5 at "Your first meeting is booked" and may be quoted (named): "Booked in week 2."',
      },
    ]);
    await pass("2026-10-15T10:00:00Z");
    expect(named(take(pinged))).toContain(`acme: opportunity, ${flags[0]?.what}`);
    const [ours] = (await api.home({ viewer: OPS, ...acme })).engagements;
    expect(ours?.moments[0]?.reviews).toHaveLength(2);
    const [mine] = (await api.home({ viewer: AMY })).engagements;
    expect(mine?.moments[0]?.mine).toMatchObject({ score: 5, mayQuote: "named" });
  });

  it("halfway is day 45; nothing is offered until an offer has an upsell", async () => {
    await pass("2026-11-18T10:00:00Z");
    expect(titled("Acme Staffing: Halfway there")).toEqual([]);
    await pass("2026-11-19T10:00:00Z");
    const [half] = titled("Acme Staffing: Halfway there");
    expect(half?.text).toContain("You're halfway through Lead reactivation.");
    const [mine] = (await api.home({ viewer: AMY })).engagements;
    expect(mine?.moments.map((m) => m.moment)).toEqual(["halfway", "first:meetings"]);
    expect(mine?.next).toEqual([]);
    expect(await refused(api.interest({ viewer: AMY, offerId: "ops-automation-build" }))).toBe(404);
    take(pinged);
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
      risks: ["weekly rating 2/5"],
    });
    expect(rows[1]).toMatchObject({ engagementId: null, phase: null, risks: [] });
  });
});

describe("the 1st's bills (D15)", () => {
  const bills = () =>
    named(take(pinged)).filter((l) => /^bolt: (Bill|Bills on the 1st for) 2026-12/.test(l));

  it("previews, then comes back daily until the month's invoice is on record", async () => {
    await pg.db.insert(clients).values({ id: "bolt", name: "Bolt", database: "wren_client_bolt" });
    const { engagement, agreement } = await onboard(pg.db, {
      clientId: "bolt",
      offerId: "reactivation",
      startsOn: "2026-10-05",
      terms: { setupCents: 0 },
      by: "ops@wren.example",
    });
    await signAgreement(pg.db, engagement, {
      sha256: agreement.sha256,
      name: "Bo Brown",
      email: "bo@bolt.example",
      agreed: true,
    });
    const e = await engagementOf(pg.db, "bolt");
    await api.result({ viewer: OPS, client: "bolt", key: "meetings", value: 3 });
    expect(await billsDue(pg.db, "2026-12")).toMatchObject([
      { clientId: "bolt", monthlyCents: 30_000, units: 3, unitCents: 50_000 },
    ]);
    take(pinged);

    await pass("2026-11-28T10:00:00Z");
    expect(bills()).toEqual([]);
    await pass("2026-11-29T10:00:00Z");
    expect(bills()).toEqual([expect.stringContaining("bolt: Bills on the 1st for 2026-12")]);

    await pass("2026-12-01T10:00:00Z");
    const [bill, ...rest] = bills();
    expect(rest).toEqual([]);
    expect(bill).toContain("Bill 2026-12:");
    expect(bill).toContain("delivery invoice <number> 1800 ");
    expect(bill).toContain("--period 2026-12 --units 3");
    await pass("2026-12-01T12:00:00Z");
    expect(bills()).toEqual([]);
    await pass("2026-12-02T10:00:00Z");
    expect(bills()).toHaveLength(1);

    const invoice = {
      number: "BOLT-12",
      description: "December 2026",
      cents: 180_000,
      dueOn: "2026-12-16",
      period: "2026-12",
      units: 3,
      by: "ops@wren.example",
    };
    await addInvoice(pg.db, e, invoice);
    await expect(addInvoice(pg.db, e, { ...invoice, number: "BOLT-13" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      addInvoice(pg.db, e, { ...invoice, number: "B", period: "12-2026" }),
    ).rejects.toMatchObject({ status: 400 });
    await pass("2026-12-03T10:00:00Z");
    expect(bills()).toEqual([]);
  });

  it("bills units once each, up to the cap", async () => {
    await api.result({ viewer: OPS, client: "bolt", key: "meetings", value: 40 });
    // The $13.5k cap less $1.5k billed leaves 24 meetings.
    expect(await billsDue(pg.db, "2027-01")).toMatchObject([{ monthlyCents: 30_000, units: 24 }]);
  });

  it("usage rides the next bill line for line; void, it rides the one after", async () => {
    const line = { client: "bolt", vendor: "telnyx", markupPct: 0, currency: "USD" };
    await pg.db.insert(usageLines).values([
      { ...line, month: "2026-12-01", units: 1240, costCents: 496, amountCents: 496 },
      // The month still running waits.
      { ...line, month: "2027-01-01", units: 10, costCents: 4, amountCents: 4 },
    ]);
    const [bill] = await billsDue(pg.db, "2027-01");
    expect(bill?.usage).toEqual([{ vendor: "telnyx", month: "2026-12", units: 1240, cents: 496 }]);
    expect(billLines(bill as Bill).map((l) => l.what)).toEqual([
      "Monthly fee",
      "24 × meeting booked at USD 500",
      "Texts, December 2026: 1,240 message parts",
    ]);
    const e = await engagementOf(pg.db, "bolt");
    const invoice = {
      number: "BOLT-01",
      description: "January 2027",
      cents: billCents(bill as Bill),
      dueOn: "2027-01-15",
      issuedOn: "2027-01-01",
      period: "2027-01",
      units: 24,
      by: "ops@wren.example",
    };
    const made = await addInvoice(pg.db, e, invoice);
    expect(made.lines).toHaveLength(3);
    const state = async () =>
      (
        await pg.db
          .select({ state: usageLines.state })
          .from(usageLines)
          .where(sql`${usageLines.month} = '2026-12-01'`)
      )[0]?.state;
    expect(await state()).toBe("on_invoice");
    expect((await billsDue(pg.db, "2027-02"))[0]?.usage.map((u) => u.month)).toEqual(["2027-01"]);

    await markInvoice(pg.db, "bolt", "BOLT-01", "void");
    expect(await state()).toBe("draft");
    expect((await billsDue(pg.db, "2027-02"))[0]?.usage.map((u) => u.month)).toEqual([
      "2026-12",
      "2027-01",
    ]);

    // An amount that isn't the bill is one line, and the usage waits.
    const other = await addInvoice(pg.db, e, { ...invoice, number: "BOLT-01B", cents: 100 });
    expect(other.lines).toEqual([{ what: "January 2027", cents: 100 }]);
    expect(await state()).toBe("draft");
  });
});

describe("installs", () => {
  it("a project installs the portal; uninstalled, its people get no mail", async () => {
    await pg.db
      .insert(clients)
      .values({ id: "solo", name: "Solo Search", database: "wren_client_solo" });
    await addMember(pg.db, "solo", "sam@solo.example", { role: "owner" });
    await startEngagement(pg.db, {
      clientId: "solo",
      offerId: "reactivation",
      startsOn: "2027-02-01",
      by: "seed",
    });
    const [c] = await pg.db.select().from(clients).where(sql`${clients.id} = 'solo'`);
    expect(Object.keys(c?.products ?? {}).sort()).toEqual([
      "delivery.contract",
      "delivery.invoices",
      "delivery.portal",
      "delivery.reviews",
    ]);
    await updateClient(pg.db, "solo", { products: { "delivery.portal": null } });
    take(mail);
    await pass("2027-02-01T10:00:00Z");
    expect(take(mail).filter((m) => m.to === "sam@solo.example")).toEqual([]);
    await updateClient(pg.db, "solo", { products: { "delivery.portal": {} } });
    await pass("2027-02-01T10:30:00Z");
    expect(take(mail).filter((m) => m.to === "sam@solo.example")).toHaveLength(1);
  });
});

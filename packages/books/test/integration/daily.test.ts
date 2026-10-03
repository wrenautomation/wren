/**
 * The books' day against the migrated schema: mail kept, read and posted, AWS
 * spend taken in, and each alert raised once, cleared when it goes, raised
 * again if it comes back. Mail, model, rates and spend are fakes; every
 * invoice and amount here is made up.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type BooksDayDeps,
  booksDay,
  type DocumentStore,
  ingestUsage,
  type Mailbox,
  openAlerts,
  type RateFeed,
  settleAlerts,
  shiftDay,
  type UsageDay,
  type UsageFeed,
  usageMonth,
} from "../../src/index.js";

const TABLES = [
  "alerts",
  "usage",
  "lines",
  "entries",
  "bill_payments",
  "bill_documents",
  "bill_taxes",
  "bill_lines",
  "bills",
  "documents",
  "rates",
  "vendors",
  "accounts",
];

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql.raw(`TRUNCATE ${TABLES.map((t) => `books.${t}`).join(", ")} RESTART IDENTITY CASCADE`),
  );
});

const NOW = new Date("2026-09-20T12:00:00Z");
const rates: RateFeed = async (_c, from, to) => {
  const out: Array<{ on: string; cadPerUnit: string }> = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push({ on: d, cadPerUnit: "1.37000000" });
  return out;
};
const memoryStore = (): DocumentStore => {
  const m = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      m.set(key, bytes);
    },
    async get(key) {
      const b = m.get(key);
      if (!b) throw new Error(`no ${key}`);
      return b;
    },
  };
};

const GITHUB_RAW = new Uint8Array(
  Buffer.from(
    [
      "From: GitHub <noreply@github.com>",
      "To: books@test.example",
      "Subject: [GitHub] Payment receipt for acme-co",
      `Date: ${new Date("2026-08-05T12:00:00Z").toUTCString()}`,
      "Message-ID: <gh-1@test.example>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Invoice number: GH-1001",
      "GitHub Team $16.00",
      "Total: $16.00 USD",
      "",
    ].join("\r\n"),
  ),
);
const githubBill = {
  kind: "bill",
  bill: {
    number: "GH-1001",
    kind: "receipt",
    issued_on: "2026-08-05",
    currency: "USD",
    lines: [{ description: "GitHub Team", amount: "$16.00" }],
    subtotal: "$16.00",
    taxes: [],
    total: "$16.00",
    plan: "Team",
    cycle: "monthly",
  },
  payments: [],
};
const llm = () => new FakeLlm({ respond: () => JSON.stringify(githubBill) });

function mailbox(down = { now: false }): Mailbox {
  return {
    address: "books@test.example",
    async search() {
      if (down.now) throw new Error("desk is off");
      return ["gh-1"];
    },
    async raw() {
      return GITHUB_RAW;
    },
  };
}

/** EC2 at 1.00 a day; S3 at 0.10, then 2.00 on the 19th. */
function awsFeed(): UsageFeed & { asked: Array<[string, string]> } {
  const asked: Array<[string, string]> = [];
  const feed = async (from: string, to: string) => {
    asked.push([from, to]);
    const out: UsageDay[] = [];
    for (let d = from; d < to; d = shiftDay(d, 1)) {
      out.push({ on: d, service: "Amazon EC2", currency: "USD", amount: "1.000000" });
      out.push({
        on: d,
        service: "Amazon S3",
        currency: "USD",
        amount: d === "2026-09-19" ? "2.000000" : "0.100000",
      });
    }
    return out;
  };
  return Object.assign(feed, { asked });
}

const deps = (over: Partial<BooksDayDeps> = {}): BooksDayDeps => ({
  db: pg.db,
  mailboxes: [mailbox()],
  store: memoryStore(),
  llm: llm(),
  rates,
  aws: null,
  since: "2026-08-01",
  ...over,
});

describe("booksDay", () => {
  it("keeps, reads, posts, takes in spend, and raises each new thing once", async () => {
    const aws = awsFeed();
    const d = deps({ aws });
    const first = await booksDay(d, NOW, null);
    expect(first.captured[0]).toMatchObject({ kept: 1 });
    expect(first.read.bills).toBe(1);
    expect(first.posted.posted).toBe(1);
    expect(first.aws).toEqual({ from: "2026-08-01", to: "2026-09-20", rows: 100 });
    expect(aws.asked).toEqual([["2026-08-01", "2026-09-20"]]);
    const kinds = (await openAlerts(pg.db)).map((a) => a.kind).sort();
    expect(kinds).toEqual(["lapsed", "new_subscription", "spike"]);
    expect(first.raised.join("\n")).toMatch(/AWS Amazon S3 on 2026-09-19: 2\.00 USD/);
    expect(first.raised.join("\n")).not.toMatch(/EC2/);

    const second = await booksDay(d, NOW, null);
    expect(second.captured[0]).toMatchObject({ kept: 0, known: 1 });
    expect(second.raised).toEqual([]);
    // The newest kept day (the 19th) and the two before it, again.
    expect(aws.asked[1]).toEqual(["2026-09-17", "2026-09-20"]);
  });

  it("an unreachable mailbox is one alert until it answers, then again if it goes", async () => {
    const down = { now: true };
    const d = deps({ mailboxes: [mailbox(down)] });
    const run = () => booksDay(d, NOW, null);
    const capture = async () => (await openAlerts(pg.db, "capture")).map((a) => a.key);

    const first = await run();
    expect(first.unreachable).toEqual([
      { mailbox: "books@test.example", error: "Error: desk is off" },
    ]);
    expect(first.raised.filter((m) => m.startsWith("could not read"))).toHaveLength(1);
    expect((await run()).raised.filter((m) => m.startsWith("could not read"))).toEqual([]);

    down.now = false;
    await run();
    expect(await capture()).toEqual([]);

    down.now = true;
    expect((await run()).raised.filter((m) => m.startsWith("could not read"))).toHaveLength(1);
    expect(await capture()).toEqual(["capture:books@test.example"]);
  });
});

describe("settleAlerts", () => {
  it("leaves kinds the pass did not look at alone", async () => {
    await settleAlerts(pg.db, ["spike"], [{ key: "spike:a", kind: "spike", message: "a" }]);
    await settleAlerts(pg.db, ["held"], []);
    expect((await openAlerts(pg.db)).map((a) => a.key)).toEqual(["spike:a"]);
    await settleAlerts(pg.db, ["spike"], []);
    expect(await openAlerts(pg.db)).toEqual([]);
  });
});

describe("usage", () => {
  it("sums this month so far beside the same days last month", async () => {
    await ingestUsage(pg.db, "aws", awsFeed(), { since: "2026-08-01", on: "2026-09-04" });
    expect(await usageMonth(pg.db, "aws", "2026-09-04")).toEqual([
      { service: "Amazon EC2", currency: "USD", sofar: 3, before: 3 },
      {
        service: "Amazon S3",
        currency: "USD",
        sofar: expect.closeTo(0.3, 6),
        before: expect.closeTo(0.3, 6),
      },
    ]);
  });
});

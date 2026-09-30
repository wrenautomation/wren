/**
 * The books against the migrated schema: billing mail kept once (email and
 * PDF), read into bills and payments, posted to a journal that must balance
 * and is never edited, and read back. Mail, model and rates are fakes; every
 * invoice here is made up.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  assignVendor,
  billDetail,
  bills,
  bocRate,
  capture,
  dirStore,
  dismissDocuments,
  documents,
  entries,
  lines,
  listBills,
  listSpend,
  listSubscriptions,
  type Mailbox,
  post,
  type RateFeed,
  readDocuments,
  reviewQueue,
  seedBooks,
  setReview,
  shiftDay,
} from "../../src/index.js";

const TABLES = [
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

let root: string;
let feedCalls: string[];
let answers: Map<string, unknown>;
beforeEach(async () => {
  await pg.db.execute(
    sql.raw(`TRUNCATE ${TABLES.map((t) => `books.${t}`).join(", ")} RESTART IDENTITY CASCADE`),
  );
  await seedBooks(pg.db);
  root = await mkdtemp(join(tmpdir(), "books-"));
  feedCalls = [];
  answers = new Map();
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** Weekdays only, at one rate: the Bank of Canada publishes none on weekends. */
const feed: RateFeed = async (currency, from, to) => {
  feedCalls.push(`${currency} ${from} ${to}`);
  const out: Array<{ on: string; cadPerUnit: string }> = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push({ on: d, cadPerUnit: "1.37000000" });
  }
  return out;
};

/** Answers by subject; a subject with no answer gets text that is not JSON. */
const llm = () =>
  new FakeLlm({
    respond: (prompt) => {
      const answer = answers.get(/^Subject: (.*)$/m.exec(prompt)?.[1] ?? "");
      return answer === undefined ? "sorry, I cannot read that" : JSON.stringify(answer);
    },
  });

let n = 0;
interface Mail {
  from: string;
  subject: string;
  date: string;
  body: string;
  pdf?: string;
}
function raw(m: Mail): Uint8Array {
  const boundary = `b${++n}`;
  const pdf = m.pdf
    ? [
        `--${boundary}`,
        "Content-Type: application/pdf",
        `Content-Disposition: attachment; filename="${m.pdf}"`,
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(`%PDF-1.4 ${m.subject}`).toString("base64"),
      ]
    : [];
  return new Uint8Array(
    Buffer.from(
      [
        `From: ${m.from}`,
        "To: books@test.example",
        `Subject: ${m.subject}`,
        `Date: ${new Date(m.date).toUTCString()}`,
        `Message-ID: <${n}@test.example>`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        m.body,
        ...pdf,
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    ),
  );
}

function mailbox(mails: Record<string, Mail>) {
  const box = new Map(Object.entries(mails).map(([id, m]) => [id, raw(m)]));
  const fetched: string[] = [];
  const queries: string[] = [];
  const mb: Mailbox = {
    address: "books@test.example",
    async search(q) {
      queries.push(q);
      return [...box.keys()];
    },
    async raw(id) {
      fetched.push(id);
      const bytes = box.get(id);
      if (!bytes) throw new Error(`no message ${id}`);
      return bytes;
    },
  };
  return { mb, fetched, queries, add: (id: string, m: Mail) => box.set(id, raw(m)) };
}

const GITHUB: Mail = {
  from: "GitHub <noreply@github.com>",
  subject: "[GitHub] Payment receipt for acme-co",
  date: "2026-08-05T12:00:00Z",
  body: `We received payment for your GitHub subscription.
Invoice number: GH-1001
Date: 2026-08-05
Billing period: 2026-08-05 - 2026-09-04
GitHub Team x 2 seats $8.00 $16.00
Subtotal: $16.00
GST (123456789 RT0001): $0.80
Total: $16.80 USD
Charged to: Mastercard
Transaction ID: TX-1`,
};
const githubBill = (over: Record<string, unknown> = {}, payments?: unknown[]) => ({
  kind: "bill",
  bill: {
    number: "GH-1001",
    kind: "receipt",
    issued_on: "2026-08-05",
    period_start: "2026-08-05",
    period_end: "2026-09-04",
    currency: "USD",
    lines: [{ description: "GitHub Team", quantity: "2", unit_price: "$8.00", amount: "$16.00" }],
    subtotal: "$16.00",
    taxes: [{ name: "GST", amount: "$0.80", tax_number: "123456789 RT0001" }],
    total: "$16.80",
    payment_method: "Mastercard",
    plan: "Team",
    cycle: "monthly",
    ...over,
  },
  payments: payments ?? [
    {
      invoice_number: "GH-1001",
      paid_on: "2026-08-05",
      amount: "$16.80",
      currency: "USD",
      reference: "TX-1",
    },
  ],
});

const GOOGLE: Mail = {
  from: "Google Payments <payments-noreply@google.com>",
  subject: "Google Workspace: Your invoice is available for acme.example",
  date: "2026-09-01T08:00:00Z",
  pdf: "5000000001.pdf",
  body: `Google Workspace
Invoice number: 5000000001
Invoice date: Sep 1, 2026
Summary for Aug 1, 2026 - Aug 31, 2026
Google Workspace Business Starter 10 users CA$100.00
Subtotal CA$100.00
GST (5%) CA$5.00
Total in CAD CA$105.00`,
};
const googleBill = {
  kind: "bill",
  bill: {
    number: "5000000001",
    kind: "invoice",
    issued_on: "2026-09-01",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    lines: [{ description: "Business Starter", quantity: "10", amount: "CA$100.00" }],
    subtotal: "CA$100.00",
    taxes: [{ name: "GST", rate_percent: "5", amount: "CA$5.00" }],
    total: "CA$105.00",
    plan: "Business Starter",
    cycle: "monthly",
  },
  payments: [],
};

// RackNerd confirms the payment before it sends the invoice.
const RACKNERD_PAID: Mail = {
  from: "RackNerd <support@racknerd.com>",
  subject: "Invoice Payment Confirmation",
  date: "2026-08-10T10:00:00Z",
  body: `This is a payment receipt for Invoice 777 sent on 08/10/2026
Transaction #: RN-TX-9
Total Paid: $10.99 USD`,
};
const RACKNERD_INVOICE: Mail = {
  from: "RackNerd <support@racknerd.com>",
  subject: "Customer Invoice",
  date: "2026-08-10T11:00:00Z",
  body: `Invoice #777
Invoice Date: 08/10/2026
KVM VPS 1GB (08/10/2026 - 08/09/2027) $10.99 USD
Sub Total: $10.99 USD
Total: $10.99 USD`,
};

const ALL = {
  a: GITHUB,
  b: GOOGLE,
  c: RACKNERD_PAID,
  d: RACKNERD_INVOICE,
  // Search is looser than the sender rules: kept, never read.
  e: {
    from: "news@racknerd.com",
    subject: "Black Friday deals",
    date: "2026-08-12T09:00:00Z",
    body: "Sale!",
  },
  // The model gives nothing usable.
  f: { ...GITHUB, subject: "[GitHub] Payment receipt (garbled)", date: "2026-08-13T09:00:00Z" },
  // Read as a bill, but no total survives.
  g: {
    from: "Telnyx <portal@telnyx.com>",
    subject: "Payment Success",
    date: "2026-08-14T09:00:00Z",
    body: "Thanks for your payment.",
  },
};

function answerAll() {
  answers.set(GITHUB.subject, githubBill());
  answers.set(GOOGLE.subject, googleBill);
  answers.set(RACKNERD_PAID.subject, {
    kind: "payment",
    bill: null,
    payments: [
      {
        invoice_number: "777",
        paid_on: "2026-08-10",
        amount: "$10.99",
        currency: "USD",
        reference: "RN-TX-9",
      },
    ],
  });
  answers.set(RACKNERD_INVOICE.subject, {
    kind: "bill",
    bill: {
      number: "777",
      kind: "invoice",
      issued_on: "2026-08-10",
      currency: "USD",
      lines: [
        {
          description: "KVM VPS 1GB",
          amount: "$10.99",
          period_start: "2026-08-10",
          period_end: "2027-08-09",
        },
      ],
      subtotal: "$10.99",
      total: "$10.99",
      plan: "KVM VPS 1GB",
      cycle: "yearly",
    },
    payments: [],
  });
  answers.set("Payment Success", { kind: "bill", bill: { number: "TX-5", total: null } });
}

async function importAll(mails: Record<string, Mail> = ALL) {
  answerAll();
  const box = mailbox(mails);
  const store = dirStore(root);
  const captured = await capture(pg.db, box.mb, { since: "2026-08-01", store });
  const read = await readDocuments(pg.db, llm());
  const posted = await post(pg.db, { feed });
  return { box, store, captured, read, posted };
}

/** The database's own words for a statement it refused (drizzle wraps them). */
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "accepted",
    (e: Error) => (e.cause instanceof Error ? e.cause.message : e.message),
  );

const billId = async (number: string) => {
  const [row] = await pg.db.select({ id: bills.id }).from(bills).where(eq(bills.number, number));
  if (!row) throw new Error(`no bill ${number}`);
  return row.id;
};
const docId = async (subject: string) => {
  const [row] = await pg.db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.subject, subject));
  if (!row) throw new Error(`no document ${subject}`);
  return row.id;
};

describe("import", () => {
  it("keeps every email and PDF once, reads bills and payments, posts a balanced journal", async () => {
    const { box, captured, read, posted } = await importAll();
    expect(box.queries[0]?.startsWith("after:2026/07/31 {")).toBe(true);
    expect(captured).toMatchObject({ found: 7, known: 0, kept: 7, attachments: 1, unmatched: 1 });
    expect(await readdir(join(root, "books/documents"))).toHaveLength(8);
    expect(read).toEqual({ read: 5, bills: 3, payments: 2, review: 0, unreadable: 1 });
    expect(posted).toEqual({ posted: 3, reversed: 0, unchanged: 0 });

    const sums = await pg.db
      .select({ entry: lines.entryId, sum: sql<string>`sum(${lines.cadCents})` })
      .from(lines)
      .groupBy(lines.entryId);
    expect(sums.map((s) => Number(s.sum))).toEqual([0, 0, 0]);

    // USD at the day's rate; the GST it prints a number for is claimable.
    const github = await billDetail(pg.db, await billId("GH-1001"));
    expect(github?.bill).toMatchObject({
      kind: "receipt",
      currency: "USD",
      subtotalCents: 1600,
      taxCents: 80,
      totalCents: 1680,
      periodStart: "2026-08-05",
      periodEnd: "2026-09-04",
      review: "ok",
    });
    expect(github?.lines).toMatchObject([{ description: "GitHub Team", amountCents: 1600 }]);
    expect(github?.taxes).toMatchObject([{ name: "GST", amountCents: 80, claimable: true }]);
    expect(github?.payments).toMatchObject([{ reference: "TX-1", amountCents: 1680 }]);
    expect(
      github?.journal.map((j) => [j.account, j.line.cadCents, j.line.rate, j.line.rateSource]),
    ).toEqual([
      ["code", 2192, "1.37000000", "boc"],
      ["gst-paid", 110, "1.37000000", "boc"],
      ["card-bmo", -2302, "1.37000000", "boc"],
    ]);

    // Simplified-regime GST is part of the cost; the PDF stays with its email.
    const google = await billDetail(pg.db, await billId("5000000001"));
    expect(google?.taxes).toMatchObject([{ amountCents: 500, claimable: false }]);
    expect(google?.journal.map((j) => [j.account, j.line.cadCents])).toEqual([
      ["email", 10500],
      ["card-bmo", -10500],
    ]);
    expect(google?.documents.map((d) => d.filename ?? d.subject)).toEqual([
      GOOGLE.subject,
      "5000000001.pdf",
    ]);

    // The payment read before its invoice finds it.
    const racknerd = await billDetail(pg.db, await billId("777"));
    expect(racknerd?.payments).toMatchObject([{ reference: "RN-TX-9", amountCents: 1099 }]);
    expect(racknerd?.documents.map((d) => d.subject)).toEqual([
      RACKNERD_PAID.subject,
      RACKNERD_INVOICE.subject,
    ]);

    const queue = await reviewQueue(pg.db);
    expect(queue.bills).toEqual([]);
    expect(queue.payments).toEqual([]);
    expect(queue.documents.map((d) => [d.subject, d.why])).toEqual([
      ["Black Friday deals", "no vendor matched"],
      ["[GitHub] Payment receipt (garbled)", "unreadable"],
      ["Payment Success", "read as a bill, none kept"],
    ]);
    expect(queue.documents[2]?.notes).toEqual(["bill dropped: no total"]);
  });

  it("changes nothing the second time, and asks for rates once", async () => {
    const { box } = await importAll();
    const again = await capture(pg.db, box.mb, { since: "2026-08-01", store: dirStore(root) });
    expect(again).toMatchObject({ found: 7, known: 7, kept: 0 });
    expect(box.fetched).toHaveLength(7);
    expect(await readDocuments(pg.db, llm())).toMatchObject({ read: 0 });
    expect(await post(pg.db, { feed })).toEqual({ posted: 0, reversed: 0, unchanged: 3 });
    expect(feedCalls).toEqual(["USD 2026-07-26 2026-08-15"]);
  });

  it("reads back spend by month and what each subscription costs", async () => {
    await importAll();
    const spend = await listSpend(pg.db);
    expect(spend.map((s) => [s.month, s.account, s.vendor, s.cadCents])).toEqual([
      ["2026-08-01", "code", "github", 2192],
      ["2026-08-01", "hosting", "racknerd", 1506],
      ["2026-09-01", "email", "google-workspace", 10500],
    ]);
    const subs = await listSubscriptions(pg.db);
    expect(subs.map((s) => [s.vendor, s.cycle, s.renewsOn, s.monthlyCadCents])).toEqual([
      ["google-workspace", "monthly", "2026-10-01", 10500],
      ["github", "monthly", "2026-09-05", 2302],
      ["racknerd", "yearly", "2027-08-10", 126],
    ]);
    const august = await listBills(pg.db, { from: "2026-08-01", to: "2026-08-31" });
    expect(august.map((b) => [b.number, b.cadCents])).toEqual([
      ["GH-1001", 2302],
      ["777", 1506],
    ]);
  });
});

describe("the journal", () => {
  it("refuses an entry that does not balance", async () => {
    const [card] = await pg.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.key, "card-bmo"));
    const refused = refusal(
      pg.db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(entries)
          .values({ postedOn: "2026-08-01", memo: "one-sided" })
          .returning();
        await tx.insert(lines).values({
          entryId: entry?.id as number,
          accountId: card?.id as number,
          cadCents: 100,
          amountCents: 100,
          currency: "CAD",
          rate: "1",
          rateSource: "same",
        });
      }),
    );
    expect(await refused).toMatch(/^books entry 1 does not balance: 1 lines summing to 100 cents$/);
  });

  it("is never edited or deleted", async () => {
    await importAll();
    expect(await refusal(pg.db.execute(sql`UPDATE books.lines SET memo = 'changed'`))).toMatch(
      /^books.lines rows are never edited or deleted/,
    );
    expect(await refusal(pg.db.execute(sql`DELETE FROM books.entries`))).toMatch(
      /^books.entries rows are never edited or deleted/,
    );
  });
});

describe("review", () => {
  it("posts a held bill only when accepted, and reverses it when it is personal", async () => {
    answers.set(GITHUB.subject, githubBill({ number: "GH-9999" }));
    const box = mailbox({ a: GITHUB });
    await capture(pg.db, box.mb, { since: "2026-08-01", store: dirStore(root) });
    expect(await readDocuments(pg.db, llm())).toMatchObject({ bills: 1, review: 1 });
    expect(await post(pg.db, { feed })).toEqual({ posted: 0, reversed: 0, unchanged: 0 });
    const id = await billId("GH-9999");
    expect((await reviewQueue(pg.db)).bills).toMatchObject([
      { id, reasons: ['number "GH-9999" is not printed'] },
    ]);

    await setReview(pg.db, id, "accepted");
    expect(await post(pg.db, { feed })).toEqual({ posted: 1, reversed: 0, unchanged: 0 });
    await setReview(pg.db, id, "personal");
    expect(await post(pg.db, { feed })).toEqual({ posted: 0, reversed: 1, unchanged: 0 });
    expect((await listSpend(pg.db)).map((s) => s.cadCents)).toEqual([0]);
    expect((await listBills(pg.db))[0]?.entryId).toBeNull();
  });

  it("holds a posted bill when another document prints another total", async () => {
    await importAll({ a: GITHUB });
    // Adds up on its own, to another total.
    const copy = {
      ...GITHUB,
      subject: "[GitHub] Payment receipt (copy)",
      body: GITHUB.body.replaceAll("16.", "18.").replace("$8.00", "$9.00"),
    };
    answers.set(
      copy.subject,
      githubBill(
        {
          lines: [
            { description: "GitHub Team", quantity: "2", unit_price: "$9.00", amount: "$18.00" },
          ],
          subtotal: "$18.00",
          total: "$18.80",
        },
        [],
      ),
    );
    const box = mailbox({ a: GITHUB, b: copy });
    await capture(pg.db, box.mb, { since: "2026-08-01", store: dirStore(root) });
    await readDocuments(pg.db, llm());
    const id = await billId("GH-1001");
    const [held] = (await reviewQueue(pg.db)).bills;
    expect(held?.reasons).toEqual([
      `document ${await docId(copy.subject)} prints a total of 18.80 USD`,
    ]);
    expect(await post(pg.db, { feed })).toEqual({ posted: 0, reversed: 1, unchanged: 0 });
    await setReview(pg.db, id, "accepted");
    expect(await post(pg.db, { feed })).toEqual({ posted: 1, reversed: 0, unchanged: 0 });
    expect((await billDetail(pg.db, id))?.bill.totalCents).toBe(1680);
  });

  it("re-reads a document into its bill and reposts what changed", async () => {
    // First reading misses the GST number: the tax is cost, not claimable.
    answers.set(GITHUB.subject, githubBill({ taxes: [{ name: "GST", amount: "$0.80" }] }));
    const box = mailbox({ a: GITHUB });
    await capture(pg.db, box.mb, { since: "2026-08-01", store: dirStore(root) });
    await readDocuments(pg.db, llm());
    await post(pg.db, { feed });
    const id = await billId("GH-1001");
    expect((await billDetail(pg.db, id))?.journal.map((j) => j.account)).toEqual([
      "code",
      "card-bmo",
    ]);

    answers.set(GITHUB.subject, githubBill());
    await readDocuments(pg.db, llm(), { ids: [await docId(GITHUB.subject)] });
    expect(await post(pg.db, { feed })).toEqual({ posted: 1, reversed: 1, unchanged: 0 });
    const live = await pg.db
      .select({ account: accounts.key, cad: lines.cadCents })
      .from(lines)
      .innerJoin(entries, eq(entries.id, lines.entryId))
      .innerJoin(accounts, eq(accounts.id, lines.accountId))
      .where(and(eq(entries.billId, id), sql`${entries.id} = (SELECT max(id) FROM books.entries)`))
      .orderBy(asc(lines.id));
    expect(live).toEqual([
      { account: "code", cad: 2192 },
      { account: "gst-paid", cad: 110 },
      { account: "card-bmo", cad: -2302 },
    ]);
  });

  it("reads an email once its vendor is named, and stops asking about dismissed ones", async () => {
    await importAll();
    const sale = await docId("Black Friday deals");
    await assignVendor(pg.db, [sale], "racknerd");
    answers.set("Black Friday deals", { kind: "other", bill: null, payments: [] });
    expect(await readDocuments(pg.db, llm(), { ids: [sale] })).toMatchObject({ read: 1, bills: 0 });
    await dismissDocuments(pg.db, [
      await docId("[GitHub] Payment receipt (garbled)"),
      await docId("Payment Success"),
    ]);
    expect((await reviewQueue(pg.db)).documents).toEqual([]);
  });
});

describe("bocRate", () => {
  it("takes a weekend's rate from the Friday before, and asks the feed only when the store cannot tell", async () => {
    expect(await bocRate(pg.db, feed, "USD", "2026-08-08")).toEqual({
      rate: "1.37000000",
      on: "2026-08-07",
    });
    expect(await bocRate(pg.db, feed, "USD", "2026-08-09")).toMatchObject({ on: "2026-08-07" });
    expect(feedCalls).toHaveLength(1);
    // Past the last stored rate: the gap may be one not fetched yet.
    expect(await bocRate(pg.db, feed, "USD", "2026-08-25")).toMatchObject({ on: "2026-08-25" });
    expect(feedCalls).toHaveLength(2);
  });
});

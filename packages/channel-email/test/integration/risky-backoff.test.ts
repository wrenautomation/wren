/**
 * The risky backoff against the migrated schema (verification/retry.ts): the wait
 * after a risky verdict grows with the address's run of them, rests the address 90
 * days at the 4th, and starts over after a valid or invalid. Ages are relative to
 * the database clock; nothing depends on today's date.
 */
import { imports, type Lead, leads } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { LocalChecker } from "mailifier";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type VerificationResult, verifications } from "../../src/schema.js";
import { riskyBackoff } from "../../src/verification/retry.js";
import { runVerification } from "../../src/verification/service.js";
import { FakeVerifier } from "../../src/verification/verifier.js";
import { latestVerifications } from "../../src/views.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "leads", "verifications"]));
const db = () => pg.db;

const HOUR = 3600;
const DAY = 24 * HOUR;
const EMAIL = "info@backoffco.example";

/** One verdict on the address, `hoursAgo` on the DB clock. */
type Row = [result: VerificationResult, reason: string | null, hoursAgo: number];
async function history(rows: Row[], email = EMAIL, leadId?: number) {
  for (const [result, reason, hoursAgo] of rows)
    await db()
      .insert(verifications)
      .values({
        email,
        leadId: leadId ?? null,
        verifier: "probe",
        result,
        raw: reason ? { reason } : {},
        checkedAt: sql`now() - make_interval(mins => ${Math.round(hoursAgo * 60)})`,
      });
}
/** Seconds the newest verdict on the address waits, with a 2-day default. */
async function waitSecs(email = EMAIL, fallbackDays = 2): Promise<number> {
  const wait = riskyBackoff(
    { email: sql`lv.email`, checkedAt: sql`lv.checked_at`, raw: sql`lv.raw` },
    sql`make_interval(days => ${fallbackDays})`,
  );
  const [row] = await db().execute(
    sql`select extract(epoch from ${wait})::float as secs from ${latestVerifications} lv where lv.email = ${email}`,
  );
  return Number((row as { secs: number }).secs);
}
const greylisted = (n: number, newestHoursAgo = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ["risky", "greylisted", newestHoursAgo + (n - 1 - i)] as Row);

describe("riskyBackoff", () => {
  it("a greylist waits an hour, then a day, then a week, then rests 90 days", async () => {
    const waits: number[] = [];
    for (let n = 1; n <= 5; n++) {
      await truncate(db(), ["verifications"]);
      await history(greylisted(n));
      waits.push(await waitSecs());
    }
    expect(waits).toEqual([HOUR, DAY, 7 * DAY, 90 * DAY, 90 * DAY]);
  });

  it("other reasons start at their own wait and double, up to 30 days", async () => {
    const run = async (reason: string, n: number, fallbackDays = 2) => {
      await truncate(db(), ["verifications"]);
      await history(Array.from({ length: n }, (_, i) => ["risky", reason, n - i] as Row));
      return (await waitSecs(EMAIL, fallbackDays)) / DAY;
    };
    expect([
      await run("unreachable", 1),
      await run("unreachable", 2),
      await run("unreachable", 3),
    ]).toEqual([2, 4, 8]);
    expect([await run("blocked", 1), await run("blocked", 2), await run("blocked", 3)]).toEqual([
      7, 14, 28,
    ]);
    expect([await run("unreachable", 2, 20), await run("unreachable", 3, 20)]).toEqual([30, 30]);
    expect(await run("blocked", 4)).toBe(90);
  });

  it.each(["valid", "invalid"] as const)("a %s verdict starts the run over", async (result) => {
    await history([...greylisted(3, 10), [result, null, 5], ["risky", "greylisted", 1]]);
    expect(await waitSecs()).toBe(HOUR);
  });

  it("a held answer (no server asked) waits like a block but never counts toward the run", async () => {
    for (let i = 6; i >= 1; i--)
      await db()
        .insert(verifications)
        .values({
          email: EMAIL,
          verifier: "probe",
          result: "risky",
          raw: {
            reason: "blocked",
            transcript: [{ code: 0, reply: "held: ppe-hosted.com lists our IP" }],
          },
          checkedAt: sql`now() - make_interval(hours => ${i})`,
        });
    expect(await waitSecs()).toBe(7 * DAY);
  });

  it("catch_all between risky verdicts neither counts nor resets", async () => {
    await history([
      ["risky", "greylisted", 3],
      ["catch_all", null, 2],
      ["risky", "greylisted", 1],
    ]);
    expect(await waitSecs()).toBe(DAY);
  });

  it("counts every row on the address, and only those within 90 days of the newest", async () => {
    await history([
      ["risky", "greylisted", 200 * 24],
      ["risky", "greylisted", 100 * 24],
      ["risky", "greylisted", 2],
    ]);
    expect(await waitSecs()).toBe(HOUR);
    await history([["risky", "greylisted", 50]], "other@backoffco.example");
    expect(await waitSecs()).toBe(HOUR);
    await history([["risky", "greylisted", 50]]);
    expect(await waitSecs()).toBe(DAY);
  });
});

describe("runVerification with backoff", () => {
  async function lead(): Promise<Lead> {
    const [batch] = await db()
      .insert(imports)
      .values({ sourceType: "csv", sourceRef: "fixture.csv", stats: {} })
      .returning();
    const [row] = await db()
      .insert(leads)
      .values({ email: EMAIL, raw: {}, importId: (batch as { id: number }).id, status: "imported" })
      .returning();
    return row as Lead;
  }
  const MX: Record<string, string[]> = { "backoffco.example/MX": ["10 mail.backoffco.example."] };
  const opts = {
    checker: new LocalChecker(async (name, rtype) => MX[`${name}/${rtype}`] ?? []),
    retryRiskyOlderThanMs: 2 * DAY * 1000,
  };
  const selected = async () =>
    (await runVerification(db(), new FakeVerifier({ authoritative: true }), opts)).selected;

  it("a second greylist waits a day", async () => {
    const l = await lead();
    await history(greylisted(2, 2), EMAIL, l.id);
    expect(await selected()).toBe(0);
    await truncate(db(), ["verifications"]);
    await history(greylisted(2, 25), EMAIL, l.id);
    expect(await selected()).toBe(1);
  });

  it("after 4 risky verdicts in a row the address rests 90 days", async () => {
    const l = await lead();
    await history(greylisted(4, 60 * 24), EMAIL, l.id);
    expect(await selected()).toBe(0);
    await truncate(db(), ["verifications"]);
    await history(greylisted(4, 91 * 24), EMAIL, l.id);
    expect(await selected()).toBe(1);
  });

  it("a valid in the run keeps a later greylist at an hour", async () => {
    const l = await lead();
    await history(
      [...greylisted(3, 30), ["valid", null, 20], ["risky", "greylisted", 2]],
      EMAIL,
      l.id,
    );
    expect(await selected()).toBe(1);
  });
});

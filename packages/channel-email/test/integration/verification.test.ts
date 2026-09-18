/**
 * Verification funnel against the migrated schema: local stage, provider stage,
 * status transitions, selection rules (including staleness re-checks), abort-keeps-progress.
 */
import { imports, type Lead, leads } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Verification, verifications } from "../../src/schema.js";
import { LocalChecker, type LocalCheckerLike } from "../../src/verification/local.js";
import { MillionVerifierError } from "../../src/verification/millionverifier.js";
import { latestValidCheckedAt, runVerification } from "../../src/verification/service.js";
import { type EmailVerifier, FakeVerifier, type Verdict } from "../../src/verification/verifier.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "leads", "verifications"]));
const db = () => pg.db;

const DAY = 86_400_000;
const MX: Record<string, string[]> = { "verifyco.example/MX": ["10 mail.verifyco.example."] };
const checker = () => new LocalChecker(async (name, rtype) => MX[`${name}/${rtype}`] ?? []);
const authoritative = () => new FakeVerifier({ authoritative: true });

async function makeLeads(...emails: string[]): Promise<{ importId: number; leads: Lead[] }> {
  const [batch] = await db()
    .insert(imports)
    .values({ sourceType: "csv", sourceRef: "fixture.csv", stats: {} })
    .returning();
  const importId = (batch as { id: number }).id;
  const rows = await db()
    .insert(leads)
    .values(emails.map((email) => ({ email, raw: {}, importId, status: "imported" as const })))
    .returning();
  return { importId, leads: rows };
}
const leadById = async (id: number) =>
  (await db().select().from(leads).where(eq(leads.id, id)))[0] as Lead;
const verificationsOf = (leadId: number) =>
  db()
    .select()
    .from(verifications)
    .where(eq(verifications.leadId, leadId))
    .orderBy(asc(verifications.id));
async function backdateLastVerification(leadId: number, days: number) {
  // checked_at is server-stamped at insert; tests age it directly to put a lead past the recheck horizon.
  const rows = await verificationsOf(leadId);
  const newest = rows.reduce((a, b) => (a.checkedAt > b.checkedAt ? a : b));
  await db()
    .update(verifications)
    .set({ checkedAt: new Date(Date.now() - days * DAY) })
    .where(eq(verifications.id, newest.id));
}

/** VALID the first time it sees an address, `then` on every later check. */
class DecayingVerifier implements EmailVerifier {
  readonly name = "decaying";
  readonly authoritative = true;
  private readonly seen = new Set<string>();
  constructor(private readonly then: Verdict["result"]) {}
  async verify(email: string): Promise<Verdict> {
    if (this.seen.has(email)) return { result: this.then, raw: { fake: true, decayed: true } };
    this.seen.add(email);
    return { result: "valid", raw: { fake: true, decayed: false } };
  }
}

describe("runVerification", () => {
  it("funnel end to end", async () => {
    const { importId } = await makeLeads(
      "alice@verifyco.example", // passes local, fake says valid
      "bob+invalid@verifyco.example", // passes local, fake says invalid
      "info@verifyco.example", // role flag, fake says valid
      "dead@nomx.example", // fails local: no MX -> provider never called
    );
    const stats = await runVerification(db(), authoritative(), { checker: checker(), importId });
    expect(stats).toMatchObject({
      selected: 4,
      local_invalid: 1,
      valid: 2,
      invalid: 1,
      flags: { role_account: 1 },
      aborted: null,
    });

    const byEmail = Object.fromEntries(
      (await db().select().from(leads).where(eq(leads.importId, importId))).map((l) => [
        l.email,
        l,
      ]),
    );
    expect(byEmail["alice@verifyco.example"]?.status).toBe("verified");
    expect(byEmail["bob+invalid@verifyco.example"]?.status).toBe("undeliverable");
    expect(byEmail["info@verifyco.example"]?.status).toBe("verified");
    expect(byEmail["dead@nomx.example"]?.status).toBe("undeliverable");

    const [dead] = await verificationsOf(byEmail["dead@nomx.example"]?.id as number);
    expect(dead).toMatchObject({
      verifier: "local",
      result: "invalid",
      email: "dead@nomx.example",
    });
    expect(dead?.raw).toMatchObject({ failure: "no_mx", mx_hosts: [], mx_path: null });

    const [info] = await verificationsOf(byEmail["info@verifyco.example"]?.id as number);
    expect(info).toMatchObject({ verifier: "fake", email: "info@verifyco.example" });
    expect((info?.raw as Record<string, unknown>).local_flags).toEqual(["role_account"]);

    // Recipient-provider evidence rides on every local check, not just failures.
    const [alice] = await verificationsOf(byEmail["alice@verifyco.example"]?.id as number);
    expect(alice?.raw).toMatchObject({ mx_hosts: ["mail.verifyco.example"], mx_path: "mx" });

    // Second run selects nothing: every lead has left `imported` or has a row already.
    expect(
      (await runVerification(db(), authoritative(), { checker: checker(), importId })).selected,
    ).toBe(0);
  });

  it("reverify inserts new rows", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("carol+risky@verifyco.example");
    await runVerification(db(), new FakeVerifier(), { checker: checker(), importId });
    const stats = await runVerification(db(), new FakeVerifier(), {
      checker: checker(),
      importId,
      reverify: true,
    });
    expect(stats.selected).toBe(1);
    expect(await verificationsOf(lead?.id as number)).toHaveLength(2); // history kept
  });

  it("import_id filter and limit", async () => {
    const a = await makeLeads("a1@verifyco.example", "a2@verifyco.example");
    await makeLeads("b1@verifyco.example");
    expect(
      (
        await runVerification(db(), new FakeVerifier(), {
          checker: checker(),
          importId: a.importId,
          limit: 1,
        })
      ).selected,
    ).toBe(1);
  });

  it("verification keeps the address it checked", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("jon@verifyco.example");
    await runVerification(db(), new FakeVerifier(), { checker: checker(), importId });
    await db()
      .update(leads)
      .set({ email: "jon.corrected@verifyco.example" })
      .where(eq(leads.id, lead?.id as number));
    expect((await verificationsOf(lead?.id as number))[0]?.email).toBe("jon@verifyco.example");
  });

  it("stale verified lead can be found dead", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("erin@verifyco.example");
    const verifier = new DecayingVerifier("invalid");
    await runVerification(db(), verifier, { checker: checker(), importId });
    expect((await leadById(lead?.id as number)).status).toBe("verified");
    await backdateLastVerification(lead?.id as number, 90);
    const stats = await runVerification(db(), verifier, {
      checker: checker(),
      importId,
      recheckOlderThanMs: 30 * DAY,
    });
    expect(stats).toMatchObject({ selected: 1, invalid: 1 });
    expect((await leadById(lead?.id as number)).status).toBe("undeliverable");
    expect(await verificationsOf(lead?.id as number)).toHaveLength(2);
  });

  it("stale verified lead can reconfirm", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("fay@verifyco.example");
    await runVerification(db(), authoritative(), { checker: checker(), importId });
    await backdateLastVerification(lead?.id as number, 90);
    const stats = await runVerification(db(), authoritative(), {
      checker: checker(),
      importId,
      recheckOlderThanMs: 30 * DAY,
    });
    expect(stats).toMatchObject({ selected: 1, valid: 1 });
    expect((await leadById(lead?.id as number)).status).toBe("verified"); // verified -> verified self-loop
  });

  it("inconclusive recheck does not demote", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("gus@verifyco.example");
    const verifier = new DecayingVerifier("risky");
    await runVerification(db(), verifier, { checker: checker(), importId });
    await backdateLastVerification(lead?.id as number, 90);
    const stats = await runVerification(db(), verifier, {
      checker: checker(),
      importId,
      recheckOlderThanMs: 30 * DAY,
    });
    expect(stats.risky).toBe(1);
    expect((await leadById(lead?.id as number)).status).toBe("verified");
  });

  it("stale verified lead failing local checks dies", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("kai@verifyco.example");
    await runVerification(db(), authoritative(), { checker: checker(), importId });
    await backdateLastVerification(lead?.id as number, 90);
    const noMx = new LocalChecker(async () => []);
    const stats = await runVerification(db(), authoritative(), {
      checker: noMx,
      importId,
      recheckOlderThanMs: 30 * DAY,
    });
    expect(stats.local_invalid).toBe(1);
    expect((await leadById(lead?.id as number)).status).toBe("undeliverable");
  });

  it("fresh verified lead is not reselected", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("hana@verifyco.example");
    await runVerification(db(), authoritative(), { checker: checker(), importId });
    const stats = await runVerification(db(), authoritative(), {
      checker: checker(),
      importId,
      recheckOlderThanMs: 30 * DAY,
    });
    expect(stats.selected).toBe(0);
    expect(await verificationsOf(lead?.id as number)).toHaveLength(1);
  });

  it("default run ignores stale verified", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("ivy@verifyco.example");
    await runVerification(db(), authoritative(), { checker: checker(), importId });
    await backdateLastVerification(lead?.id as number, 90);
    expect(
      (await runVerification(db(), authoritative(), { checker: checker(), importId })).selected,
    ).toBe(0);
  });

  it("provider error aborts but keeps progress", async () => {
    const { importId } = await makeLeads("first@verifyco.example", "second@verifyco.example");
    let calls = 0;
    const exploding: EmailVerifier = {
      name: "exploding",
      authoritative: true,
      async verify(email) {
        if (++calls > 1) throw new MillionVerifierError("credits exhausted");
        return new FakeVerifier().verify(email);
      },
    };
    const stats = await runVerification(db(), exploding, { checker: checker(), importId });
    expect(stats.valid).toBe(1);
    expect(stats.aborted).toContain("credits exhausted");
    const byEmail = Object.fromEntries(
      (await db().select().from(leads).where(eq(leads.importId, importId))).map((l) => [
        l.email,
        l,
      ]),
    );
    expect(byEmail["first@verifyco.example"]?.status).toBe("verified");
    expect(byEmail["second@verifyco.example"]?.status).toBe("imported");
    expect(await verificationsOf(byEmail["second@verifyco.example"]?.id as number)).toEqual([]);
  });

  it("local check error skips the lead but the run continues", async () => {
    const { importId } = await makeLeads(
      "before@verifyco.example",
      "boom@verifyco.example",
      "after@verifyco.example",
    );
    const real = checker();
    const broken: LocalCheckerLike = {
      check(email) {
        if (email === "boom@verifyco.example") throw new RangeError("malformed DoH body");
        return real.check(email);
      },
    };
    const stats = await runVerification(db(), authoritative(), { checker: broken, importId });
    expect(stats).toMatchObject({ selected: 3, local_errors: 1, valid: 2, aborted: null });
    const byEmail = Object.fromEntries(
      (await db().select().from(leads).where(eq(leads.importId, importId))).map((l) => [
        l.email,
        l,
      ]),
    );
    expect(byEmail["before@verifyco.example"]?.status).toBe("verified");
    expect(byEmail["after@verifyco.example"]?.status).toBe("verified");
    expect(byEmail["boom@verifyco.example"]?.status).toBe("imported"); // skipped, not judged either way
    expect(await verificationsOf(byEmail["boom@verifyco.example"]?.id as number)).toEqual([]);
  });

  it("latestValidCheckedAt ignores a later inconclusive recheck", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("mia@verifyco.example");
    const verifier = new DecayingVerifier("risky");
    await runVerification(db(), verifier, { checker: checker(), importId });
    await backdateLastVerification(lead?.id as number, 90);
    await runVerification(db(), verifier, {
      checker: checker(),
      importId,
      recheckOlderThanMs: 30 * DAY,
    });
    const rows = Object.fromEntries(
      (await verificationsOf(lead?.id as number)).map((v) => [v.result, v]),
    ) as Record<string, Verification>;
    expect(rows.risky?.checkedAt.getTime()).toBeGreaterThan(
      rows.valid?.checkedAt.getTime() as number,
    );
    const [row] = await db()
      .select({ newestValid: latestValidCheckedAt() })
      .from(leads)
      .where(eq(leads.id, lead?.id as number));
    expect(new Date(row?.newestValid as Date).getTime()).toBe(rows.valid?.checkedAt.getTime());
  });

  it("latestValidCheckedAt is null without a valid row", async () => {
    const {
      importId,
      leads: [lead],
    } = await makeLeads("noa@verifyco.example");
    await runVerification(db(), authoritative(), { checker: checker(), importId });
    await db()
      .update(verifications)
      .set({ result: "risky" })
      .where(eq(verifications.leadId, lead?.id as number));
    const [row] = await db()
      .select({ newestValid: latestValidCheckedAt() })
      .from(leads)
      .where(eq(leads.id, lead?.id as number));
    expect(row?.newestValid).toBeNull();
  });
});

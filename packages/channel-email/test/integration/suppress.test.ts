/**
 * Suppression: the one writer of `suppressions` / `suppression_events` —
 * get-or-create, re-assert, lift, bulk import.
 */
import { companies, people, suppressionEvents, suppressions } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activeSuppression } from "../../src/guards.js";
import { type Enrollment, enrollments, messages } from "../../src/schema.js";
import { recordStop } from "../../src/send/deliver.js";
import {
  addSuppression,
  ensureSuppression,
  importValues,
  liftSuppression,
} from "../../src/send/suppress.js";
import { TABLES } from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "suppression_events"]));
const db = (): Db => pg.db;

const eventsOf = (suppressionId: number) =>
  db()
    .select()
    .from(suppressionEvents)
    .where(eq(suppressionEvents.suppressionId, suppressionId))
    .orderBy(asc(suppressionEvents.id));
const allSuppressions = () => db().select().from(suppressions);
const allEvents = () => db().select().from(suppressionEvents);

/** A minimal enrollment + one message — enough for `recordStop`. */
async function makeEnrollment(toEmail: string): Promise<Enrollment> {
  const [company] = await db()
    .insert(companies)
    .values({
      domain: "wren-suppress.example",
      name: "Suppress Test Co",
      niche: "agencies",
      raw: {},
    })
    .returning();
  if (!company) throw new Error("no company");
  const [person] = await db()
    .insert(people)
    .values({
      companyId: company.id,
      fullName: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      title: "Owner",
      isCompliance: false,
      origin: "website",
      originRef: "test",
      raw: {},
    })
    .returning();
  if (!person) throw new Error("no person");
  const [enrollment] = await db()
    .insert(enrollments)
    .values({
      personId: person.id,
      companyId: company.id,
      kind: "person",
      toEmail,
      sender: "will@wren-automation.test",
      niche: "agencies",
      sequenceName: "test-seq",
      sequenceSnapshot: { name: "test-seq", steps: [{ template: "opener", day: 0 }] },
      state: "active",
    })
    .returning();
  if (!enrollment) throw new Error("no enrollment");
  await db().insert(messages).values({
    enrollmentId: enrollment.id,
    step: 0,
    template: "opener",
    templateVersion: "v1",
    toEmail,
    subject: "hi",
    body: "hi",
    provenance: {},
    state: "approved",
  });
  return enrollment;
}

describe("suppression", () => {
  it("ensureSuppression creates a row and an event", async () => {
    const row = await ensureSuppression(db(), "jane@foo.com", "opt_out", { x: 1 });
    if (!row) throw new Error("expected a row");
    expect(row.kind).toBe("email");
    expect(row.value).toBe("jane@foo.com");
    expect(row.reason).toBe("opt_out");
    expect(row.revokedAt).toBeNull();
    const events = await eventsOf(row.id);
    expect(events.length).toBe(1);
    expect(events[0]?.reason).toBe("opt_out");
    expect(events[0]?.evidence).toEqual({ x: 1 });
  });

  it("a second call re-asserts with a second event", async () => {
    const first = await ensureSuppression(db(), "jane@foo.com", "opt_out");
    const second = await ensureSuppression(db(), "jane@foo.com", "bounce", { y: 2 });
    if (!first || !second) throw new Error("expected rows");
    expect(second.id).toBe(first.id);
    expect(second.reason).toBe("opt_out"); // first reason kept
    const events = await eventsOf(first.id);
    expect(events.length).toBe(2);
    expect(new Set(events.map((e) => e.reason))).toEqual(new Set(["opt_out", "bounce"]));
  });

  it("reply and manual write nothing", async () => {
    expect(await ensureSuppression(db(), "jane@foo.com", "reply")).toBeNull();
    expect(await ensureSuppression(db(), "jane@foo.com", "manual")).toBeNull();
    expect(await allSuppressions()).toEqual([]);
  });

  it("a lifted suppression re-asserts with revoked_at cleared and three events", async () => {
    const row = await ensureSuppression(db(), "jane@foo.com", "opt_out");
    if (!row) throw new Error("expected a row");
    const lifted = await liftSuppression(db(), { kind: "email", value: "jane@foo.com" });
    expect(lifted?.revokedAt).not.toBeNull();

    const reasserted = await ensureSuppression(db(), "jane@foo.com", "bounce");
    expect(reasserted?.id).toBe(row.id);
    expect(reasserted?.revokedAt).toBeNull(); // reactivated
    const events = await eventsOf(row.id);
    expect(events.map((e) => e.reason)).toEqual(["opt_out", "lifted", "bounce"]);
  });

  it("a domain suppression covers any address at it", async () => {
    const { row, created } = await addSuppression(db(), {
      kind: "domain",
      value: "Evil.COM",
      reason: "manual",
    });
    expect(created).toBe(true);
    expect(row.value).toBe("evil.com");
    expect(await activeSuppression(db(), "anyone@evil.com")).not.toBeNull();
    expect(await activeSuppression(db(), "anyone@notevil.com")).toBeNull();
  });

  it("addSuppression rejects the lifted reason", async () => {
    await expect(
      addSuppression(db(), { kind: "email", value: "jane@foo.com", reason: "lifted" }),
    ).rejects.toThrow();
  });

  it("a lift makes activeSuppression return null", async () => {
    await ensureSuppression(db(), "jane@foo.com", "opt_out");
    expect(await activeSuppression(db(), "jane@foo.com")).not.toBeNull();
    await liftSuppression(db(), { kind: "email", value: "jane@foo.com" });
    expect(await activeSuppression(db(), "jane@foo.com")).toBeNull();
  });

  it("a lift with nothing to lift returns null", async () => {
    expect(await liftSuppression(db(), { kind: "email", value: "nobody@foo.com" })).toBeNull();
  });

  it("importValues reports stats and a re-import is idempotent", async () => {
    const values = ["jane@foo.com", "bob@bar.com", "evil.com", "not a value"];
    const first = await importValues(db(), values, { reason: "manual" });
    expect(first.read).toBe(4);
    expect(first.added).toBe(3);
    expect(first.reasserted).toBe(0);
    expect(first.invalid).toBe(1);
    expect(first.invalid_values).toEqual(["not a value"]);
    expect(first.emails).toBe(2);
    expect(first.domains).toBe(1);

    const second = await importValues(db(), values, { reason: "manual" });
    expect(second.added).toBe(0);
    expect(second.reasserted).toBe(3);
    expect(second.invalid).toBe(1);
  });

  it("a dry-run import writes nothing", async () => {
    const stats = await importValues(db(), ["jane@foo.com", "evil.com"], {
      reason: "manual",
      dryRun: true,
    });
    expect(stats.added).toBe(2);
    expect(await allSuppressions()).toEqual([]);
    expect(await allEvents()).toEqual([]);
  });

  it("importValues rejects the lifted reason", async () => {
    await expect(importValues(db(), ["jane@foo.com"], { reason: "lifted" })).rejects.toThrow();
  });

  it("importValues checkpoints every 200 writes", async () => {
    let calls = 0;
    const values = Array.from({ length: 450 }, (_, i) => `user${i}@example.com`);
    const stats = await importValues(db(), values, {
      reason: "manual",
      checkpoint: () => {
        calls += 1;
      },
    });
    expect(stats.added).toBe(450);
    expect(calls).toBe(2); // at 200 and 400; the trailing 50 close with the caller's own commit
  });

  it("recordStop on a bounce creates the suppression and an event naming the enrollment", async () => {
    const enrollment = await makeEnrollment("jane@bouncer.example");

    await recordStop(db(), enrollment, "bounce", { detail: "hard bounce: 5.1.1" });

    const [suppression] = await allSuppressions();
    expect(suppression?.value).toBe("jane@bouncer.example");
    expect(suppression?.reason).toBe("bounce");
    const [event] = await allEvents();
    expect(event?.reason).toBe("bounce");
    const evidence = event?.evidence as Record<string, unknown>;
    expect(evidence.enrollment_id).toBe(enrollment.id);
    expect(evidence.stop_reason).toBe("bounce");
    expect(evidence.detail).toBe("hard bounce: 5.1.1");
  });
});

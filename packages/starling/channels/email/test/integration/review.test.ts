/** Review by hand: list, approve (incl. failed re-arm), reject, edit, stop. */
import { suppressions } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approveMessages,
  editMessage,
  listDrafts,
  rejectMessages,
  stopByHand,
} from "../../src/outreach/review.js";
import { enrollments, type Message, messages } from "../../src/schema.js";
import {
  allMessages,
  makeCompany,
  makeEnrollment,
  makePerson,
  runCompose,
  TABLES,
} from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = () => pg.db;

async function composed() {
  const company = await makeCompany(db());
  await makePerson(db(), company, { email: "jane@oakbridge.example" });
  await runCompose(db());
  const msgs = await allMessages(db());
  expect(msgs).toHaveLength(2);
  return { company, opener: msgs[0] as Message, followup: msgs[1] as Message };
}

const state = async (id: number) =>
  (await db().select().from(messages).where(eq(messages.id, id)))[0] as Message;

describe("review", () => {
  it("lists drafts with how the address was come by", async () => {
    const { opener } = await composed();
    const rows = await listDrafts(db());
    expect(rows.map((r) => r.step)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ id: opener.id, to: "jane@oakbridge.example", duplicate: "" });
    expect(rows[0]?.addressVia).toBe("scraped · valid");
    expect(await listDrafts(db(), { flagged: true })).toEqual([]);
  });

  it("approves by enrollment, draft-only, and stamps the operator", async () => {
    const { opener, followup } = await composed();
    const result = await approveMessages(db(), { enrollmentId: opener.enrollmentId });
    expect(result).toMatchObject({ approved: 2, refused: 0 });
    const row = await state(followup.id);
    expect(row.state).toBe("approved");
    expect(row.approvedBy).toBe("operator");
    expect(row.approvedAt).not.toBeNull();
  });

  it("explicit ids re-arm a failed step; --all does not", async () => {
    const { opener } = await composed();
    await db().update(messages).set({ state: "failed" }).where(eq(messages.id, opener.id));
    const all = await approveMessages(db(), { all: true });
    expect(all.approved).toBe(1);
    expect((await state(opener.id)).state).toBe("failed");
    const byId = await approveMessages(db(), { ids: [opener.id] });
    expect(byId.approved).toBe(1);
    expect((await state(opener.id)).state).toBe("approved");
  });

  it("refuses a step of a stopped enrollment and names unknown ids", async () => {
    const { opener } = await composed();
    await db()
      .update(enrollments)
      .set({ state: "stopped", stopReason: "manual" })
      .where(eq(enrollments.id, opener.enrollmentId));
    const result = await approveMessages(db(), { ids: [opener.id] });
    expect(result.refused).toBe(1);
    expect(result.notices[0]).toMatch(/is stopped/);
    expect((await state(opener.id)).state).toBe("draft");
    await expect(approveMessages(db(), { ids: [999] })).rejects.toThrow(/no such messages/);
  });

  it("rejects with a reason and refuses a sent message", async () => {
    const { opener, followup } = await composed();
    expect(await rejectMessages(db(), [opener.id], "too_salesy", "opener too pushy")).toBe(1);
    const row = await state(opener.id);
    expect(row).toMatchObject({
      state: "rejected",
      reviewReason: "too_salesy",
      detail: "opener too pushy",
    });
    await db()
      .update(messages)
      .set({ state: "sent", messageId: "<x@test>", sentAt: new Date() })
      .where(eq(messages.id, followup.id));
    await expect(rejectMessages(db(), [followup.id], "other")).rejects.toThrow(/is sent/);
  });

  it("edits a draft, pinning the original once and counting edits", async () => {
    const { opener } = await composed();
    expect(
      await editMessage(db(), opener.id, { subject: opener.subject, body: opener.body }),
    ).toBeNull();
    expect(await editMessage(db(), opener.id, { subject: "new", body: "b1" })).toBe(1);
    expect(await editMessage(db(), opener.id, { subject: "new", body: "b2" })).toBe(2);
    const row = await state(opener.id);
    expect(row.subject).toBe("new");
    expect(row.body).toBe("b2");
    expect(row.editedAt).not.toBeNull();
    const review = (row.provenance as { review: Record<string, unknown> }).review;
    expect(review.edits).toBe(2);
    expect(review.original).toEqual({ subject: opener.subject, body: opener.body });
    await approveMessages(db(), { ids: [opener.id] });
    await expect(editMessage(db(), opener.id, { subject: "x", body: "y" })).rejects.toThrow(
      /only a draft/,
    );
  });

  it("stops an enrollment by hand and by company domain", async () => {
    const { company, opener } = await composed();
    const one = await stopByHand(db(), { enrollmentId: opener.enrollmentId }, "manual", "asked");
    expect(one.summary).toMatch(/skipped 2 step/);
    expect((await state(opener.id)).state).toBe("skipped");
    await expect(stopByHand(db(), { enrollmentId: opener.enrollmentId }, "manual")).rejects.toThrow(
      /already stopped/,
    );

    const other = await makeEnrollment(db(), company, {
      toEmail: "ops@oakbridge.example",
      kind: "role_inbox",
    });
    const byDomain = await stopByHand(db(), { companyDomain: company.domain as string }, "opt_out");
    expect(byDomain.summary).toMatch(/stopped 1 enrollment/);
    expect(
      (await db().select().from(enrollments).where(eq(enrollments.id, other.id)))[0]?.state,
    ).toBe("stopped");
    await expect(stopByHand(db(), { companyDomain: "nope.example" }, "manual")).rejects.toThrow(
      /no company/,
    );
  });

  it("a finished enrollment takes a late opt-out as a suppression only", async () => {
    const { opener } = await composed();
    await db()
      .update(enrollments)
      .set({ state: "finished" })
      .where(eq(enrollments.id, opener.enrollmentId));
    const manual = await stopByHand(db(), { enrollmentId: opener.enrollmentId }, "manual");
    expect(manual.summary).toMatch(/nothing to do/);
    const optOut = await stopByHand(db(), { enrollmentId: opener.enrollmentId }, "opt_out");
    expect(optOut.summary).toMatch(/recorded a suppression/);
    const rows = await db().select().from(suppressions);
    expect(rows.map((r) => r.value)).toEqual(["jane@oakbridge.example"]);
    expect((await state(opener.id)).state).toBe("draft"); // state stands
  });
});

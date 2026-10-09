/**
 * Drafted invite notes on Postgres with a fake model and a fixed clock: a proposed invite gets a
 * note while the month's free notes last; his edit replaces it; approve, skip and send each land
 * in the draft record under `note:<contact id>`. Synthetic rows only.
 */
import { draftEvents } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, setAccountState } from "../../src/accounts.js";
import { addProspects, contactByHandle } from "../../src/contacts.js";
import {
  draftInviteNote,
  invitesToNote,
  NOTE_MAX,
  notesLeft,
  recordNote,
  setInviteNote,
} from "../../src/invite-notes.js";
import { approveInvites, skipInvites } from "../../src/invites.js";
import { type ReachAccount, reachMessages } from "../../src/schema.js";

const TABLES = ["reach_messages", "reach_contacts", "reach_accounts", "draft_events"];
const NOW = new Date("2026-10-06T15:00:00Z");

let pg: TestPostgres;
const db = () => pg.db;
let linkedin: ReachAccount;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  const l = await addAccount(db(), { platform: "linkedin", account: "linkedin@wren", now: NOW });
  linkedin = await setAccountState(db(), l.id, "active", { reason: null, now: NOW });
});

const model = (note: string) => {
  const asked: { prompt: string; system: string | undefined }[] = [];
  const llm = new FakeLlm({
    respond: (prompt, system) => {
      asked.push({ prompt, system });
      return JSON.stringify({ note });
    },
  });
  return { llm, asked };
};

/** Contacts with a proposed, bare invite each; their ids in order. */
async function proposed(...handles: string[]): Promise<number[]> {
  await addProspects(
    db(),
    "linkedin",
    handles.map((h) => ({
      handle: h,
      url: `https://example.com/in/${h}`,
      name: `${h} Example`,
      headline: "Owner, Example Clinic",
      foundIn: "people",
    })),
  );
  const ids: number[] = [];
  for (const h of handles) {
    const c = await contactByHandle(db(), "linkedin", h);
    ids.push(c.id);
    await db().insert(reachMessages).values({
      contactId: c.id,
      accountId: linkedin.id,
      direction: "out",
      kind: "connect",
      body: "",
      state: "proposed",
      dueAt: NOW,
    });
  }
  return ids;
}

const steps = async (item: string) =>
  (
    await db()
      .select({ event: draftEvents.event, via: draftEvents.via, text: draftEvents.text })
      .from(draftEvents)
      .where(eq(draftEvents.item, item))
      .orderBy(asc(draftEvents.at), asc(draftEvents.id))
  ).map((s) => [s.event, s.via, s.text]);

const bodyOf = async (contactId: number) =>
  (
    await db()
      .select({ body: reachMessages.body })
      .from(reachMessages)
      .where(and(eq(reachMessages.contactId, contactId), eq(reachMessages.kind, "connect")))
  )[0]?.body;

describe("invite notes", () => {
  it("notes a proposed invite while free notes last; his edit and yes are kept", async () => {
    const [a, b] = await proposed("ana-test", "ben-test");
    expect(await notesLeft(db(), linkedin.id, 5, NOW)).toBe(5);
    expect(await invitesToNote(db(), linkedin.id, 5)).toEqual([a, b]);

    const { llm, asked } = model("Saw your clinic's recall posts. Would like to connect.");
    const note = await draftInviteNote(db(), llm, a as number, { sender: "Sam", now: NOW });
    expect(note).toBe("Saw your clinic's recall posts. Would like to connect.");
    expect(asked[0]?.system).toContain("Sam's note on a LinkedIn invite");
    expect(asked[0]?.prompt).toContain("Owner, Example Clinic");
    expect(await bodyOf(a as number)).toBe(note);
    // One note waits now: four left, and only the bare invite is due.
    expect(await notesLeft(db(), linkedin.id, 5, NOW)).toBe(4);
    expect(await invitesToNote(db(), linkedin.id, 5)).toEqual([b]);

    await setInviteNote(db(), a as number, "Would like to connect.", "sam@example.com");
    expect(await approveInvites(db(), [a as number], NOW)).toEqual([a]);
    await recordNote(db(), [a as number], "approved", "sam@example.com");
    expect(await steps(`note:${a}`)).toEqual([
      ["generated", "model", note],
      ["edited", "person", "Would like to connect."],
      ["approved", "person", "Would like to connect."],
    ]);

    // A note past LinkedIn's cap is kept as none: the invite stays bare.
    const long = model("x".repeat(NOTE_MAX + 1));
    expect(await draftInviteNote(db(), long.llm, b as number, { sender: "Sam", now: NOW })).toBe(
      null,
    );
    expect(await bodyOf(b as number)).toBe("");
    await expect(
      setInviteNote(db(), b as number, "y".repeat(NOTE_MAX + 1), "sam@example.com"),
    ).rejects.toThrow(/200 characters/);
  });

  it("no notes left: nothing is due; a skipped drafted note is rejected", async () => {
    const [a] = await proposed("cy-test");
    expect(
      await invitesToNote(db(), linkedin.id, await notesLeft(db(), linkedin.id, 0, NOW)),
    ).toEqual([]);
    const { llm } = model("Would like to connect.");
    await draftInviteNote(db(), llm, a as number, { sender: "Sam", now: NOW });
    expect(await skipInvites(db(), [a as number], NOW)).toEqual([a]);
    await recordNote(db(), [a as number], "rejected", "sam@example.com");
    expect((await steps(`note:${a}`)).map((s) => s[0])).toEqual(["generated", "rejected"]);
  });
});

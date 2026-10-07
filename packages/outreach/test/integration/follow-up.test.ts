/**
 * Follow-up and Nurture's DM touch (designs/2026-10-07-follow-up-nurture.md): a `reach.touch`
 * with no `step` queues one `follow_up` DM, only on a thread we already wrote on, only with the
 * global gate on. Off, it records "would send" and queues nothing. The sender holds a client's
 * follow-up DMs on that part's flag. Synthetic contacts; nothing leaves.
 */
import type { SpineEvent, StepAt } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientSends } from "../../src/clients.js";
import { touchStep } from "../../src/follow.js";
import { reachAccounts, reachContacts, reachMessages } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";

let pg: TestPostgres;
let off: string | null = null;
let accountId: string;

const step = () =>
  touchStep(pg.db, { sequences: REACH_SEQUENCES, sender: "Test Co" }, undefined, {
    off: () => off,
  });
const at = (o: Partial<StepAt> = {}): StepAt => ({
  client: null,
  workflow: "keep_warm",
  node: "nurture.dm2",
  with: {},
  template: { kind: "dm", system: "reach", name: "nurture#1" },
  part: "nurture",
  ...o,
});
const lead = (id: number): SpineEvent => ({
  subject: `lead:reach:${id}`,
  kind: "lead",
  data: { contactId: id },
});

async function contact(state: string, wrote: boolean): Promise<number> {
  const [c] = await pg.db
    .insert(reachContacts)
    .values({
      platform: "reddit",
      handle: `lead_${Math.random().toString(36).slice(2, 8)}`,
      url: "https://reddit.test/u/lead",
      foundIn: "r/smallbiz",
      name: "Dana Smith",
      accountId,
      state: state as "finished",
    })
    .returning({ id: reachContacts.id });
  if (wrote)
    await pg.db.insert(reachMessages).values({
      contactId: c?.id ?? 0,
      accountId,
      direction: "out",
      kind: "sequence",
      step: 1,
      body: "hi",
      state: "sent",
    });
  return c?.id as number;
}
const followUps = () =>
  pg.db.select().from(reachMessages).where(eq(reachMessages.kind, "follow_up"));

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["reach_messages", "reach_contacts", "reach_accounts", "templates"]);
  const [a] = await pg.db
    .insert(reachAccounts)
    .values({
      platform: "reddit",
      account: "reddit@test",
      state: "active",
      startedOn: "2026-09-01",
    })
    .returning({ id: reachAccounts.id });
  accountId = a?.id as string;
  off = null;
});

describe("a follow-up DM", () => {
  it("queues the node's default copy once on a thread we wrote on", async () => {
    const id = await contact("finished", true);
    const [out] = await step()("lead", lead(id), at());
    expect(out?.port).toBe("sent");
    expect(out?.event.data.follow).toEqual({
      part: "nurture",
      node: "nurture.dm2",
      channel: "dm",
      did: "queued",
      why: null,
    });
    await step()("lead", lead(id), at());
    const rows = await followUps();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "queued", accountId, template: "nurture#1" });
    expect(rows[0]?.body).toMatch(/^Hi Dana, checking in\./);
    expect(rows[0]?.provenance).toMatchObject({ follow: "keep_warm/nurture.dm2" });
  });

  it("would send with the gate off; never writes first, or to someone who stopped us", async () => {
    off = "WREN_REACH_LIVE is off";
    const [o1] = await step()("lead", lead(await contact("finished", true)), at());
    expect(o1?.event.data.follow).toMatchObject({ did: "would_send" });
    off = null;
    const [o2] = await step()("lead", lead(await contact("finished", false)), at());
    expect(o2?.event.data.follow).toMatchObject({
      did: "skipped",
      why: "we never wrote to them here",
    });
    const [o3] = await step()("lead", lead(await contact("opted_out", true)), at());
    expect(o3?.event.data.follow).toMatchObject({ did: "skipped" });
    const [o4] = await step()("lead", lead(await contact("replied", true)), at());
    expect(o4?.port).toBe("replied");
    expect(await followUps()).toEqual([]);
  });

  it("goes for a client only on Follow-up's or Nurture's flag", () => {
    const c = (sends: string[]) => clientSends({ sends }, true)("follow_up");
    expect(c([])).toBe(false);
    expect(c(["reach.outreach"])).toBe(false);
    expect(c(["nurture"])).toBe(true);
    expect(c(["follow_up"])).toBe(true);
    expect(clientSends({ sends: ["follow_up"] }, false)("follow_up")).toBe(false);
  });
});

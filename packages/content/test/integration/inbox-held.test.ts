/**
 * A follow-up email William approved that the frequency cap holds, through Restate and the desk's
 * own channels, over a fake Disposition that holds, refuses or sends as scripted: it queues with
 * his yes kept, leaves To approve, and sends itself once they have room (a delayed call to
 * `InboxDesk.release`), again later if held again. Synthetic threads only.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { askFollowEmail } from "../../src/inbox/index.js";
import { makeInboxDesk } from "../../src/restate/inbox-desk.js";
import { inboxReplies } from "../../src/schema.js";
import { approvalRecord } from "../../src/social/records.js";
import { INBOX_TABLES, type InboxSeed, seedInbox } from "../inbox-seed.js";

type Out = { ok: boolean; reason: string | null; until: string | null };
const SENT: Out = { ok: true, reason: null, until: null };
/** The cap holds it for `ms` more. */
const held =
  (ms: number): (() => Out) =>
  () => ({
    ok: false,
    reason: "Held by the frequency cap.",
    until: new Date(Date.now() + ms).toISOString(),
  });
const refused =
  (reason: string): (() => Out) =>
  () => ({ ok: false, reason, until: null });

/** What Disposition.followUp was asked, and what it answers next: the head of `script`, then sent. */
const calls: { enrollmentId: number; body: string; campaign: string | null }[] = [];
let script: Array<() => Out> = [];
/** Journaled, so a replay neither asks twice nor answers twice. */
const disposition = restate.object({
  name: "Disposition",
  handlers: {
    followUp: async (
      ctx: restate.ObjectContext,
      req: { enrollmentId: number; body: string; campaign?: string | null },
    ): Promise<Out> =>
      ctx.run("follow up", async () => {
        calls.push({
          enrollmentId: req.enrollmentId,
          body: req.body,
          campaign: req.campaign ?? null,
        });
        return script.shift()?.() ?? SENT;
      }),
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
let s: InboxSeed;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [makeInboxDesk({ db: pg.db, senderName: "Will" }), disposition],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...INBOX_TABLES]);
  calls.length = 0;
  script = [];
  s = await seedInbox(pg.db);
  // Dana never wrote back by email, and the sequence is done.
  await pg.db.execute(sql`delete from call_bookings`);
  await pg.db.execute(sql`delete from thread_events`);
  await pg.db.execute(
    sql`update enrollments set state = 'finished', stop_reason = null, stopped_at = null`,
  );
});

const desk = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<ReturnType<typeof makeInboxDesk>>({ name: "InboxDesk" });
const as = (email: string) => ({ viewer: { email } });
const BY = "workflow:follow_up.touches/email4";
const ask = () =>
  askFollowEmail(pg.db, {
    subject: `lead:email:${s.enrollmentId}`,
    enrollmentId: s.enrollmentId,
    body: "Still worth a call? https://sample-plumbing.example.test/book",
    by: BY,
    why: "Follow-up's email: it sends once someone says yes.",
  });
const reply = async () => {
  const [r] = await pg.db.select().from(inboxReplies);
  if (!r) throw new Error("no asked reply");
  return r;
};
const stateOf = async () => (await reply()).state;
const threadStatus = async () => {
  const [r] = (await pg.db.execute(
    sql`select status from inbox_threads where thread = ${`outbound:${s.enrollmentId}`}`,
  )) as unknown as Array<{ status: string }>;
  return r?.status ?? null;
};
const toApprove = async () =>
  ((await approvalRecord.rows?.(pg.db)) ?? []).filter((r) => r.type === "reply");
/** Until the delayed release has run: a few seconds. */
const until = (state: string) =>
  vi.waitFor(async () => expect(await stateOf()).toBe(state), { timeout: 30_000, interval: 250 });

describe("an approved follow-up email the frequency cap holds", () => {
  it("queues with the yes kept, leaves To approve, and sends itself at the room", async () => {
    await ask();
    expect(await toApprove()).toHaveLength(1);
    script = [held(1_500)];
    const out = await desk().approve({ id: (await reply()).id, ...as(s.admin) });
    expect(out).toMatchObject({ sent: false, queued: expect.any(String) });
    expect(await stateOf()).toBe("queued");
    expect(await reply()).toMatchObject({ decidedBy: s.admin });
    expect((await reply()).detail).toMatch(/frequency cap/);
    // Not in To approve, so no second Approve; a second ask of the same node finds it asked.
    expect(await toApprove()).toEqual([]);
    expect(await threadStatus()).toBeNull();
    expect(await ask()).toEqual({ asked: false, why: "already asked" });
    await expect(desk().approve({ id: (await reply()).id, ...as(s.admin) })).rejects.toThrow(
      /queued already/,
    );
    await vi.waitFor(async () => expect(await threadStatus()).toBe("waiting"), {
      timeout: 30_000,
      interval: 250,
    });
    // The same words and the workflow's campaign, twice: held, then sent.
    expect(calls).toEqual([
      expect.objectContaining({
        enrollmentId: s.enrollmentId,
        body: "Still worth a call? https://sample-plumbing.example.test/book",
        campaign: "follow_up.touches",
      }),
      expect.objectContaining({ campaign: "follow_up.touches" }),
    ]);
    expect(await reply()).toMatchObject({ decidedBy: s.admin, detail: null });
    expect(await threadStatus()).toBe("waiting");
  }, 60_000);

  it("queues again when still held at its turn, then sends", async () => {
    await ask();
    script = [held(1_000), held(1_000)];
    await desk().approve({ id: (await reply()).id, ...as(s.admin) });
    // Its turn takes the row as `sent` while it asks again, so wait for the end of the second one.
    await vi.waitFor(async () => expect(await threadStatus()).toBe("waiting"), {
      timeout: 30_000,
      interval: 250,
    });
    expect(calls).toHaveLength(3);
    expect(await stateOf()).toBe("sent");
  }, 60_000);

  it("fails with why when its turn is refused, and sends nothing more", async () => {
    await ask();
    script = [held(1_000), refused("they opted out of email")];
    await desk().approve({ id: (await reply()).id, ...as(s.admin) });
    await until("failed");
    expect((await reply()).detail).toContain("they opted out of email");
    expect(calls).toHaveLength(2);
    expect(await threadStatus()).toBeNull();
  }, 60_000);

  it("is cancelled by Drop while it waits: nothing sends at its turn", async () => {
    await ask();
    script = [held(3_000)];
    await desk().approve({ id: (await reply()).id, ...as(s.admin) });
    expect(await desk().drop({ id: (await reply()).id, ...as(s.admin) })).toEqual({
      dropped: true,
    });
    await new Promise((r) => setTimeout(r, 7_000));
    expect(await stateOf()).toBe("dropped");
    expect(calls).toHaveLength(1);
  }, 60_000);

  it("a refusal that is not the cap fails it at once, as before", async () => {
    await ask();
    script = [refused("that thread ended: bounce")];
    await expect(desk().approve({ id: (await reply()).id, ...as(s.admin) })).rejects.toThrow(
      /ended/,
    );
    expect(await reply()).toMatchObject({ state: "failed" });
    expect(await pg.db.select().from(inboxReplies).where(eq(inboxReplies.state, "queued"))).toEqual(
      [],
    );
  }, 60_000);
});

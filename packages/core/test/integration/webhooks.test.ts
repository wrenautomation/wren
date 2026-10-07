/** Outbound webhooks on Postgres: a subscription's life, a delivery kept once, its tries logged. */
import { env } from "node:process";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events, webhookSubscriptions } from "../../src/schema.js";
import { failedOf, failedRuns } from "../../src/spine.js";
import {
  addSubscription,
  attemptDelivery,
  deliveriesOf,
  deliveryOf,
  editSubscription,
  queueDeliveries,
  removeSubscription,
  reopenDelivery,
  rotateSubscription,
  secretsOf,
  subscriptionsOf,
} from "../../src/webhooks.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  env.WREN_HOOK_KEY = "test-key-not-a-secret";
});
afterAll(async () => {
  delete env.WREN_HOOK_KEY;
  await pg.stop();
});

/** Every lookup lands on a private address, so nothing leaves the machine. */
const local = { resolve: async () => [{ address: "10.0.0.9", family: 4 }] };
const payload = { type: "lead.created", timestamp: "2026-10-07T12:00:00Z", data: { n: 1 } };

describe("subscriptions", () => {
  it("adds one with a secret shown once, refuses a bad URL, rotates with a grace", async () => {
    await expect(
      addSubscription(
        pg.db,
        null,
        { name: "x", url: "https://10.0.0.1/x", events: ["lead.created"] },
        "t",
      ),
    ).rejects.toThrow(/private/);
    await expect(
      addSubscription(
        pg.db,
        null,
        { name: "x", url: "https://a.example.com", events: ["nope"] },
        "t",
      ),
    ).rejects.toThrow(/no such event/);

    const { subscription: s, secret } = await addSubscription(
      pg.db,
      null,
      {
        name: "CRM",
        url: "https://hooks.example.com/in",
        events: ["lead.created", "lead.created"],
      },
      "t",
    );
    expect(secret).toMatch(/^whsec_/);
    expect(s.events).toEqual(["lead.created"]);
    expect((await subscriptionsOf(pg.db, null)).map((x) => x.id)).toContain(s.id);
    // Wren's own are not a client's.
    expect(await subscriptionsOf(pg.db, "nobody")).toEqual([]);

    const next = await rotateSubscription(pg.db, null, s.id);
    expect(next.secret).not.toBe(secret);
    expect(next.subscription.prevUntil).not.toBeNull();
    const [row] = await pg.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, s.id));
    expect(secretsOf(row as NonNullable<typeof row>, new Date())).toEqual([next.secret, secret]);
  });
});

describe("deliveries", () => {
  it("keeps an event once per URL, logs each try, fails at the last, and reopens once", async () => {
    const { subscription: s } = await addSubscription(
      pg.db,
      null,
      { name: "Sheet", url: "https://sheet.example.com/in", events: ["lead.created"] },
      "t",
    );
    const first = await queueDeliveries(
      pg.db,
      { client: null, event: "lead.created", id: "msg_one", payload },
      s.id,
    );
    expect(first).toHaveLength(1);
    expect(
      await queueDeliveries(
        pg.db,
        { client: null, event: "lead.created", id: "msg_one", payload },
        s.id,
      ),
    ).toEqual([]);
    const id = first[0] as string;

    const tried = await attemptDelivery(pg.db, id, false, local);
    expect(tried.done).toBe(false);
    expect(tried.answer?.error).toMatch(/private/);
    expect((await deliveryOf(pg.db, null, id)).state).toBe("pending");

    expect((await attemptDelivery(pg.db, id, true, local)).done).toBe(true);
    const d = await deliveryOf(pg.db, null, id);
    expect(d).toMatchObject({ state: "failed", attempts: 2, payload });
    expect(d.tries.map((t) => t.n)).toEqual([1, 2]);
    // A finished one does nothing more.
    expect((await attemptDelivery(pg.db, id, false, local)).answer).toBeNull();

    expect(await reopenDelivery(pg.db, null, id)).toBe(id);
    await expect(reopenDelivery(pg.db, null, id)).rejects.toThrow(/sending now/);
    expect((await deliveriesOf(pg.db, null, { subscription: s.id }))[0]?.state).toBe("pending");
  });

  it("stops one that's off, and a removed one takes its log", async () => {
    const { subscription: s } = await addSubscription(
      pg.db,
      null,
      { name: "Off", url: "https://off.example.com/in", events: ["deal.won"] },
      "t",
    );
    const [id] = await queueDeliveries(
      pg.db,
      { client: null, event: "deal.won", id: "msg_off", payload },
      s.id,
    );
    await editSubscription(pg.db, null, s.id, { active: false });
    await attemptDelivery(pg.db, id as string, false, local);
    expect((await deliveryOf(pg.db, null, id as string)).error).toBe("the webhook is off");
    // An off one hears nothing new.
    expect(
      await queueDeliveries(pg.db, { client: null, event: "deal.won", id: "msg_off2", payload }),
    ).toEqual([]);
    await removeSubscription(pg.db, null, s.id);
    await expect(deliveryOf(pg.db, null, id as string)).rejects.toThrow(/no such delivery/);
  });
});

describe("failed runs", () => {
  it("counts failed steps per workflow with the top reason, and finds them to replay", async () => {
    const [a, b] = await pg.db
      .insert(events)
      .values([
        {
          workflow: "wf",
          node: "n",
          port: "in",
          subject: "lead:a",
          kind: "lead",
          data: {},
          by: "i",
          error: "down",
        },
        {
          workflow: "wf",
          node: "n",
          port: "in",
          subject: "lead:b",
          kind: "lead",
          data: {},
          by: "i",
          error: "down",
        },
      ])
      .returning({ id: events.id });
    const runs = await failedRuns(pg.db);
    expect(runs.find((r) => r.workflow === "wf")).toMatchObject({ runs: 2, top: "down" });
    expect((await failedOf(pg.db, [a?.id as string, "wf/lead:b"])).sort()).toEqual(
      [a?.id, b?.id].sort(),
    );
    expect(await failedOf(pg.db, ["wf/lead:none"])).toEqual([]);
  });
});

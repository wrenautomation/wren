/** Outbound webhooks on Postgres: a subscription's life, a delivery kept once, its tries logged. */
import { env } from "node:process";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addClient, addMember } from "../../src/clients/index.js";
import { events, webhookSubscriptions } from "../../src/schema.js";
import { failedOf, failedRuns } from "../../src/spine.js";
import {
  addSubscription,
  attemptDelivery,
  DELIVERY_LADDER_MS,
  DISABLE_AFTER_MS,
  deliveriesOf,
  deliveryOf,
  editSubscription,
  queueDeliveries,
  removeSubscription,
  reopenDelivery,
  rotateSubscription,
  secretsOf,
  subscriptionsOf,
  turnedOffTeller,
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

describe("failing", () => {
  it("shows the next try, turns a URL off after days of failures, and on starts clean", async () => {
    const { subscription: s } = await addSubscription(
      pg.db,
      null,
      { name: "Down", url: "https://down.example.com/in", events: ["lead.created"] },
      "t",
    );
    const queue = async (n: string) =>
      (
        await queueDeliveries(pg.db, { client: null, event: "lead.created", id: n, payload }, s.id)
      )[0] as string;
    const t0 = new Date("2026-10-01T00:00:00Z");
    const one = await queue("msg_down1");
    await attemptDelivery(pg.db, one, false, { ...local, now: t0 });
    const d = await deliveryOf(pg.db, null, one);
    expect(d.nextAt).toBe(new Date(t0.getTime() + (DELIVERY_LADDER_MS[0] as number)).toISOString());
    expect((await subscriptionsOf(pg.db, null)).find((x) => x.id === s.id)).toMatchObject({
      active: true,
      failingSince: t0.toISOString(),
      disabledAt: null,
    });

    // Still failing a day short of the line: on, failing since the first.
    await attemptDelivery(pg.db, one, true, {
      ...local,
      now: new Date(t0.getTime() + DISABLE_AFTER_MS - 86_400_000),
    });
    expect((await deliveryOf(pg.db, null, one)).nextAt).toBeNull();
    let view = (await subscriptionsOf(pg.db, null)).find((x) => x.id === s.id);
    expect(view).toMatchObject({ active: true, failingSince: t0.toISOString() });

    // Past it: off, with why; its pending ones stop.
    const two = await queue("msg_down2");
    const three = await queue("msg_down3");
    const late = new Date(t0.getTime() + DISABLE_AFTER_MS + 1);
    await attemptDelivery(pg.db, two, false, { ...local, now: late });
    view = (await subscriptionsOf(pg.db, null)).find((x) => x.id === s.id);
    expect(view).toMatchObject({ active: false, disabledAt: late.toISOString() });
    expect(view?.disabledWhy).toMatch(/Nothing landed in 5 days\. Last try: .*private/);
    await attemptDelivery(pg.db, three, false, local);
    expect((await deliveryOf(pg.db, null, three)).error).toBe("the webhook is off");

    // Turned back on: clean.
    view = await editSubscription(pg.db, null, s.id, { active: true });
    expect(view).toMatchObject({
      active: true,
      failingSince: null,
      disabledAt: null,
      disabledWhy: null,
    });
    // Off by hand is not "turned off by Wren".
    await attemptDelivery(pg.db, await queue("msg_down4"), false, local);
    view = await editSubscription(pg.db, null, s.id, { active: false });
    expect(view).toMatchObject({ active: false, disabledAt: null });
    expect(view.failingSince).not.toBeNull();
  });

  it("tells a client's owners and its adder once, when Wren turns it off", async () => {
    await addClient(pg.db, pg.url, { id: "hookco", name: "Hook Co" });
    await addMember(pg.db, "hookco", "own@hook.example", { role: "owner" });
    await addMember(pg.db, "hookco", "staff@hook.example", { role: "member" });
    const { subscription: s } = await addSubscription(
      pg.db,
      "hookco",
      { name: "CRM", url: "https://crm.example.com/in", events: ["lead.created"] },
      "Staff@hook.example",
    );
    const queue = async (n: string) =>
      (
        await queueDeliveries(
          pg.db,
          { client: "hookco", event: "lead.created", id: n, payload },
          s.id,
        )
      )[0] as string;
    const t0 = new Date("2026-10-01T00:00:00Z");
    const first = await attemptDelivery(pg.db, await queue("msg_co1"), true, { ...local, now: t0 });
    expect(first.off).toBeUndefined();
    const late = new Date(t0.getTime() + DISABLE_AFTER_MS + 1);
    const { off } = await attemptDelivery(pg.db, await queue("msg_co2"), true, {
      ...local,
      now: late,
    });
    expect(off).toMatchObject({ client: "hookco", name: "CRM", url: "https://crm.example.com/in" });
    // Already off: no second word.
    const again = await attemptDelivery(pg.db, await queue("msg_co3"), true, {
      ...local,
      now: late,
    });
    expect(again.off).toBeUndefined();

    const sent: { to: string; subject: string; text: string }[] = [];
    if (!off) throw new Error("not turned off");
    await turnedOffTeller(pg.db, async (m) => void sent.push(m), "https://portal.example")(off);
    expect(sent.map((m) => m.to).sort()).toEqual(["own@hook.example", "staff@hook.example"]);
    expect(sent[0]?.subject).toBe('Your webhook "CRM" is off');
    expect(sent[0]?.text).toContain("https://portal.example/account/webhooks");
    expect(sent[0]?.text).toContain("Nothing landed in 5 days");
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

/**
 * Adversarial cases for the `Reactivation` loop over a real Restate: a client
 * deleted, turned demo, a sender dropped, a registry or client database that
 * fails, and `crm loop stop` then `start`. The mailbox loops are stand-ins
 * that remember start and stop. The question each time: is any mailbox left
 * running that shouldn't be, or stopped that should run?
 */
import * as restate from "@restatedev/restate-sdk";
import * as ingress from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  ConsoleTransport,
  FakeVerifier,
  type LocalCheckerLike,
  SendPolicy,
} from "@wren/channel-email";
import { ingressOf, loadSettings } from "@wren/config";
import { clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReactivation, type Reactivation } from "../../src/loop.js";
import { clientSendScope } from "../../src/sending.js";

const ANN = "ann@acme-talent.example";
const BO = "bo@acme-talent.example";
const SENDERS = [
  { address: ANN, name: "Ann Lee" },
  { address: BO, name: "Bo Park" },
];
const checker: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

/** A mailbox loop that only remembers whether it was told to run. */
const standIn = (name: string) =>
  restate.object({
    name,
    handlers: {
      start: async (ctx: restate.ObjectContext) => ctx.set("running", true),
      stop: async (ctx: restate.ObjectContext) => ctx.set("running", false),
      running: restate.handlers.object.shared(
        async (ctx: restate.ObjectSharedContext) => (await ctx.get<boolean>("running")) ?? null,
      ),
    },
  });
type StandIn = ReturnType<typeof standIn>;

/** A loop whose passes are 2 s apart; it records when each pass ran. */
const PACED_MS = 2_000;
const passTimes: number[] = [];
const paced = makeLoopObject<{ ok: true }>("Paced", async (ctx) => {
  const at = await ctx.run("pass", () => {
    const t = Date.now();
    passTimes.push(t);
    return t;
  });
  return {
    stats: { ok: true },
    error: null,
    failures: 0,
    delayMs: PACED_MS,
    now: new Date(at).toISOString(),
  };
});
type Paced = typeof paced;

/** `db` whose reads throw while `broken()` says so. */
const breakable = (db: Db, broken: () => boolean): Db =>
  new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "select" && broken())
        return () => {
          throw new Error("connection refused");
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

let registryDown = false;
let clientDbDown = false;
const notes: string[] = [];
const notifier: Notifier = {
  name: "test",
  async notify(title) {
    notes.push(title);
    return true;
  },
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeReactivation({
        main: breakable(pg.db, () => registryDown),
        open: () => breakable(pg.db, () => clientDbDown),
        crm: { verifier: new FakeVerifier({ authoritative: true }), checker, llm: null },
        freeVerify: false,
        transport: new ConsoleTransport({ write: () => {} }),
        notifier,
      }),
      standIn("SendScheduler"),
      standIn("InboxScheduler"),
      paced,
    ],
    alwaysReplay: true,
  });
}, 120_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

let n = 0;
let id = "";
beforeEach(() => {
  n += 1;
  id = `adv${n}`;
  registryDown = false;
  clientDbDown = false;
  notes.length = 0;
});

const connect = () => ingress.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const loop = (key = id) => connect().objectClient<Reactivation>({ name: "Reactivation" }, key);
const mailbox = (object: string, key: string) =>
  connect().objectClient<StandIn>({ name: object }, key);
const settle = (expected: Record<string, boolean | null>) =>
  vi.waitFor(
    async () => {
      const seen: Record<string, boolean | null> = {};
      for (const k of Object.keys(expected)) {
        const [object, address] = k.split(" ") as [string, string];
        seen[k] = await mailbox(object, `${id}/${address}`).running();
      }
      expect(seen).toEqual(expected);
    },
    { timeout: 10_000, interval: 200 },
  );
const ALL_RUNNING = {
  [`SendScheduler ${ANN}`]: true,
  [`SendScheduler ${BO}`]: true,
  [`InboxScheduler ${ANN}`]: true,
  [`InboxScheduler ${BO}`]: true,
};
const ALL_STOPPED = {
  [`SendScheduler ${ANN}`]: false,
  [`SendScheduler ${BO}`]: false,
  [`InboxScheduler ${ANN}`]: false,
  [`InboxScheduler ${BO}`]: false,
};

const SENDING = { on: true, stages: { send: true }, senders: SENDERS };
const addClient = (block: Record<string, unknown> = SENDING) =>
  pg.db
    .insert(clients)
    .values({ id, name: "Acme", database: `wren_client_${id}`, products: { reactivation: block } });
const setBlock = (block: unknown) =>
  pg.db
    .update(clients)
    .set({ products: { reactivation: block } })
    .where(eq(clients.id, id));

describe("the client changes under a running loop", () => {
  it("a deleted client stops every mailbox and its own loop", async () => {
    await addClient();
    await loop().sync();
    await settle(ALL_RUNNING);
    await pg.db.delete(clients).where(eq(clients.id, id));
    const out = await loop().sync();
    expect(out.stopped).toBe("no such client");
    await settle(ALL_STOPPED);
  });

  it("the demo flag set on a working client stops every mailbox", async () => {
    await addClient();
    await loop().sync();
    await settle(ALL_RUNNING);
    await pg.db.update(clients).set({ demo: true }).where(eq(clients.id, id));
    expect((await loop().sync()).stopped).toBe("the demo is never worked");
    await settle(ALL_STOPPED);
  });

  it("a sender dropped from the list stops both its loops; the other keeps both", async () => {
    await addClient();
    await loop().sync();
    await settle(ALL_RUNNING);
    await setBlock({ ...SENDING, senders: [SENDERS[0]] });
    await loop().sync();
    await settle({
      [`SendScheduler ${ANN}`]: true,
      [`InboxScheduler ${ANN}`]: true,
      [`SendScheduler ${BO}`]: false,
      [`InboxScheduler ${BO}`]: false,
    });
  });

  it("a block edited by hand into something that doesn't parse stops every mailbox", async () => {
    await addClient();
    await loop().sync();
    await settle(ALL_RUNNING);
    await setBlock({ ...SENDING, approval: "sometimes" });
    expect((await loop().sync()).stats?.off).toBe("the reactivation block does not parse");
    await settle(ALL_STOPPED);
  });
});

describe("failures", () => {
  // Was a bug: a failed pass stores stats null, so `last.stats.loops` is gone
  // while the mailbox loops still run. `crm loop stop` stops the keys it reads
  // there, so after a failed pass it stops the Reactivation loop and leaves
  // every send loop sending.
  it("a failed pass still names the mailbox loops it left running", async () => {
    await addClient();
    clientDbDown = true;
    const out = await loop().sync();
    expect(out.error).not.toBeNull();
    await settle(ALL_RUNNING);
    expect((await loop().status()).last?.stats?.loops).toEqual({
      send: [`${id}/${ANN}`, `${id}/${BO}`],
      inbox: [`${id}/${ANN}`, `${id}/${BO}`],
    });
  });

  it("a failed pass is counted and backs off, and the next good one resets it", async () => {
    await addClient();
    clientDbDown = true;
    expect((await loop().sync()).failures).toBe(1);
    const second = await loop().sync();
    expect(second.failures).toBe(2);
    expect(second.delayMs).toBe(30_000);
    clientDbDown = false;
    expect((await loop().sync()).failures).toBe(0);
  });

  // Was a bug: a registry read that throws is settled without the notifier, so
  // nobody hears it failed; only "recovered" arrives, for a failure never told.
  it("a registry that can't be read is told once, like any failed pass", async () => {
    await addClient();
    registryDown = true;
    const out = await loop().sync();
    expect(out.error).toContain("connection refused");
    await loop().sync();
    expect(notes.filter((t) => t.includes(id) && t.endsWith("failed"))).toHaveLength(1);
  });
});

describe("crm loop stop, then start", () => {
  // Was a bug: `crm loop stop` stops the mailbox loops but the Reactivation
  // loop still remembers them as started. A start within 20 min of the last
  // pass isn't read as a resume, so nothing restarts them for up to an hour.
  it("a start right after a stop runs the mailboxes again", async () => {
    await addClient();
    await loop().start();
    await settle(ALL_RUNNING);
    // What `crm loop stop` does.
    await loop().stop();
    const last = (await loop().status()).last?.stats?.loops;
    for (const key of last?.send ?? []) await mailbox("SendScheduler", key).stop();
    for (const key of last?.inbox ?? []) await mailbox("InboxScheduler", key).stop();
    await settle(ALL_STOPPED);

    await loop().start();
    await vi.waitFor(
      async () => expect(Date.parse((await loop().status()).last?.now ?? "0")).toBeGreaterThan(0),
      { timeout: 5_000 },
    );
    await settle(ALL_RUNNING);
    await loop().stop();
  });

  // Was a bug: `stop` leaves the delayed `loop` call queued, and `start` sends
  // a fresh one. If the start lands before the old call fires, both see
  // running = true and each schedules its own next pass: two chains, twice
  // the passes. Every loop built on makeLoopObject has it (Reactivation,
  // InboxScheduler), and SendScheduler copies the same start/stop.
  it("stop then start keeps one chain of passes, not two", async () => {
    passTimes.length = 0;
    const paced = connect().objectClient<Paced>({ name: "Paced" }, "one");
    await paced.start();
    await vi.waitFor(() => expect(passTimes.length).toBeGreaterThan(0), { timeout: 5_000 });
    await paced.stop();
    const before = passTimes.length;
    // A start passes at once; from there, one pass per delay.
    await paced.start();
    await new Promise((r) => setTimeout(r, 2 * PACED_MS + 700));
    await paced.stop();
    const after = passTimes.slice(before);
    expect(after.length).toBeGreaterThanOrEqual(3);
    const gaps = after.slice(1).map((t, i) => t - (after[i] ?? t));
    expect(Math.min(...gaps)).toBeGreaterThan(PACED_MS / 2);
  });
});

describe("clientSendScope", () => {
  const base = SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" }));
  const deps = () => ({ main: pg.db, open: () => pg.db, policy: base });

  // Was a bug: settings check rampStart by regex only, so "2026-02-30" saves.
  // sendPolicyFor then throws inside the send tick's step, and Restate retries
  // that step forever instead of the loop stopping.
  it("a ramp start that isn't a calendar day sends nothing and throws nothing", async () => {
    await addClient({ ...SENDING, sending: { rampStart: "2026-02-30" } });
    await expect(clientSendScope(deps(), `${id}/${ANN}`)).resolves.toBeNull();
  });

  it("an empty mailbox, a leading slash or an uppercase client never resolves", async () => {
    await addClient();
    expect(await clientSendScope(deps(), `${id}/`)).toBeNull();
    expect(await clientSendScope(deps(), `/${ANN}`)).toBeNull();
    expect(await clientSendScope(deps(), `${id.toUpperCase()}/${ANN}`)).toBeNull();
    expect(await clientSendScope(deps(), `${id}/${ANN}/x`)).toBeNull();
  });
});

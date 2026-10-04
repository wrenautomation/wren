/**
 * The `Reactivation` loop over a real Restate: what a pass works, and which
 * mailbox loops it points at as the settings change. The mailbox loops are
 * stand-ins that remember start and stop. Plus a client mailbox's send scope.
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
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReactivation, type Reactivation } from "../../src/loop.js";
import { clientSendScope, sendPolicyFor } from "../../src/sending.js";
import { reactivationSettingsOf } from "../../src/settings.js";

const ANN = "ann@acme-talent.example";
const BO = "bo@acme-talent.example";
const SENDERS = [
  { address: ANN, name: "Ann Lee" },
  { address: BO, name: "Bo Park", suspended: true },
];
const BASE = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "30",
    WREN_COLD_SENDS_RAMP_START: "2026-01-05",
    WREN_COLD_SENDS_RAMP_FROM: "10",
    WREN_NEW_OPENERS_PER_DAY: "0",
  }),
);
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

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeReactivation({
        main: pg.db,
        open: () => pg.db,
        crm: { verifier: new FakeVerifier({ authoritative: true }), checker, llm: null },
        freeVerify: false,
        transport: new ConsoleTransport({ write: () => {} }),
      }),
      standIn("SendScheduler"),
      standIn("InboxScheduler"),
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
  id = `acme${n}`;
});

const connect = () => ingress.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const loop = (key = id) => connect().objectClient<Reactivation>({ name: "Reactivation" }, key);
const running = (object: string, mailbox: string) =>
  connect().objectClient<StandIn>({ name: object }, `${id}/${mailbox}`).running();
const settle = (expected: Record<string, boolean | null>) =>
  vi.waitFor(
    async () => {
      const seen: Record<string, boolean | null> = {};
      for (const k of Object.keys(expected)) {
        const [object, mailbox] = k.split(" ") as [string, string];
        seen[k] = await running(object, mailbox);
      }
      expect(seen).toEqual(expected);
    },
    { timeout: 10_000, interval: 200 },
  );

const addClient = (products: Record<string, unknown>, demo = false) =>
  pg.db.insert(clients).values({ id, name: "Acme", database: `wren_client_${id}`, products, demo });
const setProducts = (products: Record<string, unknown>) =>
  pg.db.update(clients).set({ products }).where(eq(clients.id, id));
const block = (extra: Record<string, unknown>) => ({
  reactivation: { senders: SENDERS, ...extra },
});

describe("Reactivation loop", () => {
  it("a client that is off works nothing and runs no mailbox", async () => {
    await addClient(block({}));
    const out = await loop().sync();
    expect(out.error).toBeNull();
    expect(out.stats).toEqual({
      off: "reactivation is off",
      stages: [],
      handoff: null,
      loops: { send: [], inbox: [] },
    });
    expect(out.stopped).toBeUndefined();
  });

  it("points the mailbox loops at the settings as they change", async () => {
    await addClient(block({ on: true }));
    const on = await loop().sync();
    expect(on.error).toBeNull();
    // An empty CRM has nothing due, and no reply to forward.
    expect(on.stats?.stages).toEqual([]);
    expect(on.stats?.handoff).toMatchObject({ opened: 0, forwarded: 0, failed: 0 });
    expect(on.stats?.loops).toEqual({ send: [], inbox: [`${id}/${ANN}`, `${id}/${BO}`] });
    await settle({
      [`InboxScheduler ${ANN}`]: true,
      [`InboxScheduler ${BO}`]: true,
      [`SendScheduler ${ANN}`]: null,
      [`SendScheduler ${BO}`]: null,
    });

    // Sending on: only the mailbox that isn't suspended sends. Handoff off: nothing forwarded.
    await setProducts(block({ on: true, stages: { send: true, handoff: false } }));
    const sending = await loop().sync();
    expect(sending.stats?.loops.send).toEqual([`${id}/${ANN}`]);
    expect(sending.stats?.handoff).toBeNull();
    await settle({ [`SendScheduler ${ANN}`]: true, [`SendScheduler ${BO}`]: null });

    // Ann suspended: her send loop stops, her inbox keeps syncing.
    await setProducts(
      block({
        on: true,
        stages: { send: true },
        senders: SENDERS.map((s) => ({ ...s, suspended: true })),
      }),
    );
    await loop().sync();
    await settle({ [`SendScheduler ${ANN}`]: false, [`InboxScheduler ${ANN}`]: true });

    // Off: everything stops.
    await setProducts(block({ on: false, stages: { send: true } }));
    const off = await loop().sync();
    expect(off.stats?.off).toBe("reactivation is off");
    await settle({
      [`SendScheduler ${ANN}`]: false,
      [`InboxScheduler ${ANN}`]: false,
      [`InboxScheduler ${BO}`]: false,
    });
  });

  it("the demo is never worked and its loop stops itself", async () => {
    await addClient(block({ on: true, stages: { send: true } }), true);
    await loop().start();
    await vi.waitFor(async () => expect((await loop().status()).running).toBe(false), {
      timeout: 10_000,
      interval: 200,
    });
    const status = await loop().status();
    expect(status.last?.stopped).toBe("the demo is never worked");
    expect(status.last?.stats?.loops).toEqual({ send: [], inbox: [] });
  });

  it("a client that is gone stops its loop", async () => {
    await loop("nobody").start();
    await vi.waitFor(async () => expect((await loop("nobody").status()).running).toBe(false), {
      timeout: 10_000,
      interval: 200,
    });
    expect((await loop("nobody").status()).last?.stopped).toBe("no such client");
  });

  it("a block that no longer parses idles rather than failing every pass", async () => {
    await addClient({ reactivation: { on: true, approval: "sometimes" } });
    const out = await loop().sync();
    expect(out.error).toBeNull();
    expect(out.stats?.off).toBe("the reactivation block does not parse");
  });
});

describe("clientSendScope", () => {
  const deps = () => ({ main: pg.db, open: () => pg.db, policy: BASE });

  it("is null unless this mailbox may send now", async () => {
    await addClient(block({ on: true }));
    const scope = (key: string) => clientSendScope(deps(), key);
    // Sending is off by default.
    expect(await scope(`${id}/${ANN}`)).toBeNull();
    await setProducts(block({ on: true, stages: { send: true } }));
    expect(await scope(`${id}/${ANN}`)).not.toBeNull();
    // Keys match the mailbox in any case.
    expect(await scope(`${id}/${ANN.toUpperCase()}`)).not.toBeNull();
    expect(await scope(`${id}/${BO}`)).toBeNull();
    expect(await scope(`${id}/nobody@acme-talent.example`)).toBeNull();
    expect(await scope(ANN)).toBeNull();
    expect(await scope(`ghost/${ANN}`)).toBeNull();
    await setProducts(block({ on: false, stages: { send: true } }));
    expect(await scope(`${id}/${ANN}`)).toBeNull();
  });

  it("the demo never sends", async () => {
    await addClient(block({ on: true, stages: { send: true } }), true);
    expect(await clientSendScope(deps(), `${id}/${ANN}`)).toBeNull();
  });

  it("sends under the client's caps and its own fleet", async () => {
    await addClient(
      block({
        on: true,
        stages: { send: true },
        sending: { perInboxPerDay: 8, openersPerDay: 5, rampStart: "2026-10-01" },
      }),
    );
    const scope = await clientSendScope(deps(), `${id}/${ANN}`);
    expect(scope?.policy.perInboxCeiling).toBe(8);
    expect(scope?.policy.newOpenersPerDay).toBe(5);
    expect(scope?.policy.rampStart?.toString()).toBe("2026-10-01");
    // The ramp never starts above the client's ceiling.
    expect(scope?.policy.rampFrom).toBe(8);
    expect(scope?.policy.timezone).toBe(BASE.timezone);
    expect(scope?.pixelBaseUrl).toBeNull();
    expect(scope?.fleet).toEqual({
      senders: [ANN],
      domainFleet: [ANN, BO],
      fromNames: { [ANN]: "Ann Lee" },
      signatureHtml: {},
      pages: {},
    });
  });
});

describe("sendPolicyFor", () => {
  it("keeps Wren's ceiling but none of Wren's campaign caps when the client sets nothing", () => {
    const policy = sendPolicyFor(reactivationSettingsOf({}), BASE);
    expect(policy.perInboxCeiling).toBe(30);
    expect(policy.newOpenersPerDay).toBeNull();
    expect(policy.rampStart).toBeNull();
    expect(policy.windowStart).toEqual(BASE.windowStart);
  });
});

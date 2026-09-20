/**
 * The Domain object on Restate with a fake `browser` service and fake loop
 * objects bound beside it: gates survive across invocations, browser legs
 * are real service calls, and a leg's 460 becomes a human gate.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeWorld } from "../../src/fakes.js";
import { type Domain, makeDomain } from "../../src/restate/domain.js";

const calls: string[] = [];
/** Flip to make the DKIM leg hand over, as autobrowse does when a person is needed. */
const dkimNeedsHuman = { value: false };

const browser = restate.service({
  name: "browser",
  handlers: {
    buy: async (_ctx: restate.Context, input: { domain: string }) => {
      calls.push(`buy ${input.domain}`);
      // The Registrar API lists it afterwards; the buy step checks.
      world.owned.value = true;
      return { priceText: "$9.77" };
    },
    dkimGenerate: async (_ctx: restate.Context, input: { domain: string }) => {
      calls.push(`dkimGenerate ${input.domain}`);
      if (dkimNeedsHuman.value)
        throw new restate.TerminalError(
          JSON.stringify({
            reason: "2FA prompt in the admin console",
            artifacts: { shot: "s.png" },
          }),
          { errorCode: 460 },
        );
      return { name: "google._domainkey", value: "v=DKIM1; k=rsa; p=abc" };
    },
    dkimStart: async (_ctx: restate.Context, input: { domain: string }) => {
      calls.push(`dkimStart ${input.domain}`);
      return "started" as const;
    },
    warmup: async (_ctx: restate.Context, input: { email: string }) => {
      calls.push(`warmup ${input.email}`);
      return "enrolled" as const;
    },
  },
});
const loop = (name: "SendScheduler" | "InboxScheduler") =>
  restate.object({
    name,
    handlers: {
      start: async (ctx: restate.ObjectContext) => {
        calls.push(`${name} ${ctx.key}`);
        return { running: true };
      },
    },
  });

let env: RestateTestEnvironment;
let world: ReturnType<typeof fakeWorld>;
beforeAll(async () => {
  world = fakeWorld({ dnsWaitMs: 1_000 });
  // The Restate host supplies browser legs and loops; the rest is the fake world.
  const { browser: _b, loops: _l, ...deps } = world.deps;
  env = await RestateTestEnvironment.start({
    services: [makeDomain(deps), browser, loop("SendScheduler"), loop("InboxScheduler")],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const domain = (key: string) =>
  clients.connect({ url: env.baseUrl() }).objectClient<Domain>({ name: "Domain" }, key);
const plan = (d: string) => ({
  domain: d,
  inboxes: [{ local: "jane", givenName: "Jane", familyName: "Doe" }],
});

describe("Domain", () => {
  it("waits at the purchase gate, then runs to done after approve, with real browser calls", async () => {
    const d = domain("wren-six.com");
    const first = await d.provision(plan("wren-six.com"));
    expect(first.status).toBe("waiting");
    expect(first.state.gate).toMatchObject({ name: "purchase", step: "buy" });
    expect((await d.status()).status).toBe("waiting");

    const after = await d.approve({ note: "go" });
    expect(after.status).toBe("done");
    expect(after.state.results.buy?.detail).toBe("bought ($9.77)");
    expect(after.state.results.loops?.detail).toBe("jane@wren-six.com send=true inbox=true");
    expect(calls).toEqual([
      "buy wren-six.com",
      "dkimGenerate wren-six.com",
      "dkimStart wren-six.com",
      "warmup jane@wren-six.com",
      "SendScheduler jane@wren-six.com",
      "InboxScheduler jane@wren-six.com",
    ]);
    expect(JSON.stringify(after.state)).not.toMatch(/password"?:/);
  }, 120_000);

  it("turns a browser leg's 460 into a human gate; resume after the fix", async () => {
    calls.length = 0;
    world.owned.value = true;
    dkimNeedsHuman.value = true;
    const d = domain("wren-seven.com");
    const stuck = await d.provision(plan("wren-seven.com"));
    expect(stuck.status).toBe("waiting");
    expect(stuck.state.gate).toMatchObject({
      name: "human",
      step: "dkim-generate",
      prompt: "2FA prompt in the admin console",
      artifacts: { shot: "s.png" },
    });
    dkimNeedsHuman.value = false;
    const fixed = await d.approve({});
    expect(fixed.status).toBe("done");
    expect(fixed.state.results["dkim-generate"]?.detail).toBe("google._domainkey (21 chars)");
  }, 120_000);

  it("rejects the plan whose domain is not the key, and reset forgets", async () => {
    const d = domain("wren-eight.com");
    await expect(d.provision(plan("other.com"))).rejects.toThrow(/must equal the object key/);
    const cleared = await d.reset();
    expect(cleared.status).toBe("idle");
    expect(cleared.plan).toBeNull();
  });
});

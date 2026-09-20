import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { appendEntries, rosterAddresses } from "./clients/roster.js";
import { fakeWorld } from "./fakes.js";
import { directHost, NeedsHuman } from "./host.js";
import { parsePlan } from "./plan.js";
import { needsHumanFrom } from "./restate/domain.js";
import { emptyState, provisionOnce, statusOf } from "./run.js";
import { SECRET_PREFIX, STEPS } from "./steps.js";

const plan = parsePlan({
  domain: "wren-six.com",
  inboxes: [
    { local: "jane", givenName: "Jane", familyName: "Doe" },
    { local: "sam", givenName: "Sam", familyName: "Roe" },
  ],
  signatureHtml: "<p>Jane</p>",
});
const host = directHost();
const approve = (state: ReturnType<typeof emptyState>, gate: "purchase" | "password" | "human") => {
  state.answers[gate] = { approved: true, note: null, at: "2026-09-20T00:00:00Z" };
};

describe("provisionOnce", () => {
  it("stops at the purchase gate, then walks every step once approved", async () => {
    const w = fakeWorld();
    const state = emptyState();
    await provisionOnce(host, w.deps, plan, state);
    expect(statusOf(state)).toBe("waiting");
    expect(state.gate).toMatchObject({ name: "purchase", step: "buy" });
    expect(state.results.check?.detail).toBe("available");
    expect(w.calls).not.toContain("buy wren-six.com");

    approve(state, "purchase");
    await provisionOnce(host, w.deps, plan, state);
    expect(statusOf(state)).toBe("done");
    expect(Object.keys(state.results)).toEqual(STEPS.map((s) => s.name));
    expect(state.results.buy?.detail).toBe("bought ($10.11)");
    expect(w.calls).toEqual([
      "buy wren-six.com",
      "addDomain wren-six.com",
      "verify wren-six.com",
      "dkimGenerate",
      "dkimStart",
      "createUser jane@wren-six.com",
      `secret ${SECRET_PREFIX}/jane@wren-six.com/password`,
      "createUser sam@wren-six.com",
      `secret ${SECRET_PREFIX}/sam@wren-six.com/password`,
      "signature jane@wren-six.com",
      "signature sam@wren-six.com",
      "warmup jane@wren-six.com",
      "warmup sam@wren-six.com",
      "roster write",
      "reload",
      "loops jane@wren-six.com",
      "loops sam@wren-six.com",
    ]);
    // DNS: MX, SPF, DMARC with rua, verification TXT, DKIM.
    expect(w.cloudflare.records.map((r) => `${r.type} ${r.name}`)).toEqual([
      "TXT @",
      "MX @",
      "TXT @",
      "TXT _dmarc",
      "TXT google._domainkey",
    ]);
    expect(w.cloudflare.records.find((r) => r.name === "_dmarc")?.content).toBe(
      "v=DMARC1; p=none; rua=mailto:dmarc@fleet.test",
    );
    expect(rosterAddresses(w.rosterText())).toEqual([
      "old@fleet.test",
      "jane@wren-six.com",
      "sam@wren-six.com",
    ]);
    // Never a password in the state that Restate would store.
    expect(JSON.stringify(state)).not.toMatch(/password"?:/);
  });

  it("skips the purchase for a domain the account already holds and is idempotent on rerun", async () => {
    const w = fakeWorld();
    w.owned.value = true;
    const state = emptyState();
    await provisionOnce(host, w.deps, plan, state);
    expect(state.results.buy).toEqual({ status: "skipped", detail: "already owned" });
    expect(statusOf(state)).toBe("done");
    const before = w.calls.length;
    await provisionOnce(host, w.deps, plan, state);
    expect(w.calls.length).toBe(before);
  });

  it("asks before resetting an existing inbox's password and honours a rejection", async () => {
    const w = fakeWorld();
    w.owned.value = true;
    w.users.add("jane@wren-six.com");
    const state = emptyState();
    await provisionOnce(host, w.deps, plan, state);
    expect(state.gate).toMatchObject({ name: "password", step: "inboxes" });
    state.answers.password = { approved: false, note: "leave jane alone", at: "x" };
    await provisionOnce(host, w.deps, plan, state);
    expect(state.results.inboxes).toEqual({ status: "rejected", detail: "leave jane alone" });
    expect(statusOf(state)).toBe("rejected");
    expect(w.calls.some((c) => c.startsWith("setPassword"))).toBe(false);
  });

  it("hands over when Google never sees the TXT, resumes after the person says go", async () => {
    const w = fakeWorld({ dnsWaitMs: 30_000 });
    w.owned.value = true;
    w.dnsLag.value = 5;
    const state = emptyState();
    await provisionOnce(host, w.deps, plan, state);
    expect(state.gate).toMatchObject({ name: "human", step: "verify-domain" });
    expect(state.gate?.prompt).toMatch(/cannot see the verification TXT/);
    expect(statusOf(state)).toBe("waiting");
    w.dnsLag.value = 0;
    approve(state, "human");
    await provisionOnce(host, w.deps, plan, state);
    expect(state.results["verify-domain"]?.detail).toBe("verified by DNS TXT");
    expect(statusOf(state)).toBe("done");
  });

  it("a declined human gate ends the run as rejected", async () => {
    const w = fakeWorld({ dnsWaitMs: 0 });
    w.owned.value = true;
    w.dnsLag.value = 5;
    const state = emptyState();
    await provisionOnce(host, w.deps, plan, state);
    state.answers.human = { approved: false, note: null, at: "x" };
    await provisionOnce(host, w.deps, plan, state);
    expect(state.results["verify-domain"]?.status).toBe("rejected");
    expect(statusOf(state)).toBe("rejected");
  });

  it("dry run stops before the first irreversible step", async () => {
    const w = fakeWorld();
    const state = emptyState();
    await provisionOnce(host, w.deps, { ...plan, dryRun: true }, state);
    expect(statusOf(state)).toBe("dry-run");
    expect(Object.keys(state.results)).toEqual(["check"]);
    expect(w.calls).toEqual([]);
  });

  it("records an error against its step and rethrows for the host's retry", async () => {
    const w = fakeWorld({ availability: async () => "taken" });
    const state = emptyState();
    await expect(provisionOnce(host, w.deps, plan, state)).rejects.toThrow(/someone else/);
    expect(state.error).toMatchObject({ step: "check" });
    expect(statusOf(state)).toBe("failed");
  });

  it("a browser leg that raised NeedsHuman opens a human gate with its artifacts", async () => {
    const w = fakeWorld();
    w.owned.value = true;
    w.deps.browser.dkimGenerate = async () => {
      throw new NeedsHuman("2FA prompt", { screenshot: "s.png" });
    };
    const state = emptyState();
    await provisionOnce(host, w.deps, plan, state);
    expect(state.gate).toMatchObject({
      name: "human",
      step: "dkim-generate",
      prompt: "2FA prompt",
      artifacts: { screenshot: "s.png" },
    });
  });
});

describe("needsHumanFrom", () => {
  it("maps the browser service's 460/461 terminal errors, leaves the rest", () => {
    const err = new restate.TerminalError(
      JSON.stringify({ reason: "sign in by hand", artifacts: { trace: "t.zip" } }),
      { errorCode: 460 },
    );
    const mapped = needsHumanFrom(err);
    expect(mapped).toBeInstanceOf(NeedsHuman);
    expect(mapped?.message).toBe("sign in by hand");
    expect(mapped?.artifacts).toEqual({ trace: "t.zip" });
    expect(needsHumanFrom(new restate.TerminalError("plain", { errorCode: 461 }))?.message).toBe(
      "plain",
    );
    expect(needsHumanFrom(new restate.TerminalError("nope", { errorCode: 500 }))).toBeNull();
    expect(needsHumanFrom(new Error("x"))).toBeNull();
  });
});

describe("appendEntries", () => {
  it("appends only the missing senders and keeps the text parseable", () => {
    const text = '[[senders]]\naddress = "a@x.test"\ndisplay_name = "A"\nniches = "all"';
    const next = appendEntries(text, [
      { address: "A@x.test", displayName: "A", niches: "all" },
      { address: "b@x.test", displayName: 'B "Bee"', niches: ["agencies"] },
    ]);
    expect(next.added).toEqual(["b@x.test"]);
    expect(rosterAddresses(next.text)).toEqual(["a@x.test", "b@x.test"]);
    expect(next.text).toContain('niches = ["agencies"]');
  });
});

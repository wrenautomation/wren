/** ProbeFleet: one home prober per recipient domain, a second opinion only when our IP is refused. */
import { describe, expect, it } from "vitest";
import { fleetOrder, ProbeFleet, READY_TTL_MS } from "./mailifier.js";
import type { Verdict } from "./verifier.js";

type Answer = Verdict | Error;
const host = (name: string, answer: Answer | ((email: string) => Answer)) => {
  const asked: string[] = [];
  return {
    asked,
    member: {
      host: name,
      probe: {
        name: "smtp",
        async verify(email: string) {
          asked.push(email);
          const a = typeof answer === "function" ? answer(email) : answer;
          if (a instanceof Error) throw a;
          return a;
        },
      },
    },
  };
};
const valid: Verdict = { result: "valid", raw: { reason: "accepted" } };
const risky = (reason: string): Verdict => ({ result: "risky", raw: { reason } });

/** The two hosts in the order the fleet tries them for this address's domain. */
const ordered = (email: string, a: Answer, b: Answer) => {
  const [first, second] = fleetOrder(
    [{ host: "a.example" }, { host: "b.example" }],
    email.split("@")[1] ?? "",
  );
  const home = host(first?.host ?? "", a);
  const next = host(second?.host ?? "", b);
  return { home, next, fleet: new ProbeFleet([home.member, next.member]) };
};

describe("fleetOrder", () => {
  it("is stable per domain and spreads domains across hosts", () => {
    const members = [{ host: "a.example" }, { host: "b.example" }];
    const homes = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const d = `firm${i}.example`;
      const h = fleetOrder(members, d)[0]?.host ?? "";
      expect(fleetOrder(members, d)[0]?.host).toBe(h);
      homes.set(h, (homes.get(h) ?? 0) + 1);
    }
    for (const n of homes.values()) expect(n).toBeGreaterThan(60);
  });

  it("a third host takes only its own share", () => {
    const two = [{ host: "a.example" }, { host: "b.example" }];
    const three = [...two, { host: "c.example" }];
    for (let i = 0; i < 100; i++) {
      const d = `firm${i}.example`;
      const now = fleetOrder(three, d)[0]?.host;
      if (now !== "c.example") expect(now).toBe(fleetOrder(two, d)[0]?.host);
    }
  });
});

describe("ProbeFleet", () => {
  it("asks only the home host when it answers", async () => {
    const { home, next, fleet } = ordered("jo@acme.example", valid, valid);
    const v = await fleet.verify("jo@acme.example");
    expect(v.result).toBe("valid");
    expect(v.raw.prober).toBe(home.member.host);
    expect(next.asked).toEqual([]);
  });

  it.each(["no_ptr", "blocked", "unreachable"])(
    "our IP refused (%s): the next host asks once and its answer stands",
    async (reason) => {
      const { home, next, fleet } = ordered("jo@acme.example", risky(reason), valid);
      const v = await fleet.verify("jo@acme.example");
      expect(v.result).toBe("valid");
      expect(v.raw).toMatchObject({
        prober: next.member.host,
        first: { prober: home.member.host, reason },
      });
    },
  );

  it("greylisting stays with the home host: a new IP restarts the wait", async () => {
    const { next, fleet } = ordered("jo@acme.example", risky("greylisted"), valid);
    expect((await fleet.verify("jo@acme.example")).raw.reason).toBe("greylisted");
    expect(next.asked).toEqual([]);
  });

  it("both refused: the home host's verdict stands", async () => {
    const { home, fleet } = ordered("jo@acme.example", risky("blocked"), risky("blocked"));
    const v = await fleet.verify("jo@acme.example");
    expect(v).toEqual({ result: "risky", raw: { reason: "blocked", prober: home.member.host } });
  });

  it("the second host failing keeps the home verdict", async () => {
    const { fleet } = ordered("jo@acme.example", risky("no_ptr"), new Error("HTTP 502"));
    expect((await fleet.verify("jo@acme.example")).raw.reason).toBe("no_ptr");
  });

  it("home host down: the next host answers", async () => {
    const { home, next, fleet } = ordered("jo@acme.example", new Error("HTTP 502"), valid);
    expect((await fleet.verify("jo@acme.example")).raw).toMatchObject({
      prober: next.member.host,
      home_down: home.member.host,
    });
  });

  it("one host: its error is the caller's", async () => {
    const only = host("a.example", new Error("HTTP 502"));
    await expect(new ProbeFleet([only.member]).verify("jo@acme.example")).rejects.toThrow("502");
  });
});

describe("ProbeFleet readiness (PTR names the host)", () => {
  const emails = Array.from({ length: 40 }, (_, i) => `jo@firm${i}.example`);
  const askedBy = async (fleet: ProbeFleet) => {
    const hosts = new Set<string>();
    for (const e of emails) hosts.add(String((await fleet.verify(e)).raw.prober));
    return hosts;
  };

  it("only ready hosts probe", async () => {
    const a = host("a.example", valid);
    const b = host("b.example", valid);
    const fleet = new ProbeFleet([a.member, b.member], async (h) => h === "b.example");
    expect(await askedBy(fleet)).toEqual(new Set(["b.example"]));
    expect(a.asked).toEqual([]);
  });

  it("none ready: the first listed probes alone, with no second opinion", async () => {
    const a = host("a.example", risky("no_ptr"));
    const b = host("b.example", valid);
    const fleet = new ProbeFleet([a.member, b.member], async () => false);
    expect(await askedBy(fleet)).toEqual(new Set(["a.example"]));
    expect(b.asked).toEqual([]);
  });

  it("a failed check reads as not ready", async () => {
    const a = host("a.example", valid);
    const b = host("b.example", valid);
    const fleet = new ProbeFleet([a.member, b.member], async (h) => {
      if (h === "b.example") throw new Error("SERVFAIL");
      return true;
    });
    expect(await askedBy(fleet)).toEqual(new Set(["a.example"]));
  });

  it("re-checks once the cached answer is an hour old, so a new PTR joins on its own", async () => {
    let clock = 0;
    let bReady = false;
    let checks = 0;
    const a = host("a.example", valid);
    const b = host("b.example", valid);
    const fleet = new ProbeFleet(
      [a.member, b.member],
      async (h) => {
        checks++;
        return h === "a.example" || bReady;
      },
      () => clock,
    );
    expect(await askedBy(fleet)).toEqual(new Set(["a.example"]));
    expect(checks).toBe(2);
    bReady = true;
    clock = READY_TTL_MS - 1;
    expect(await askedBy(fleet)).toEqual(new Set(["a.example"]));
    clock = READY_TTL_MS;
    expect(await askedBy(fleet)).toEqual(new Set(["a.example", "b.example"]));
    expect(checks).toBe(4);
  });
});

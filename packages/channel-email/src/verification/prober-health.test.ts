/** Prober standing: PTR, blocklists read right (Spamhaus refusals are not listings), refusal share. */
import { describe, expect, it } from "vitest";
import {
  ipStanding,
  isListing,
  type ProberHealth,
  proberHosts,
  proberProblems,
  type Resolver,
} from "./prober-health.js";

const resolver = (a: Record<string, string[]>, ptr: Record<string, string[]>): Resolver => ({
  async resolve4(host) {
    const r = a[host];
    if (!r) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return r;
  },
  async reverse(ip) {
    const r = ptr[ip];
    if (!r) throw new Error("ENOTFOUND");
    return r;
  },
});

const healthy: ProberHealth = {
  host: "probe2.example.com",
  ip: "192.0.2.10",
  ptr: "probe2.example.com",
  listed: [],
  checks: 500,
  refused: 10,
};

describe("isListing", () => {
  it("Spamhaus: 127.0.0.2-11 list, 127.255.255.x is a refused lookup", () => {
    expect(isListing("zen.spamhaus.org", "127.0.0.2")).toBe(true);
    expect(isListing("zen.spamhaus.org", "127.0.0.10")).toBe(true);
    expect(isListing("zen.spamhaus.org", "127.255.255.254")).toBe(false);
  });
  it("other lists: any loopback answer is a listing", () => {
    expect(isListing("bl.spamcop.net", "127.0.0.2")).toBe(true);
    expect(isListing("bl.spamcop.net", "10.0.0.1")).toBe(false);
  });
});

describe("ipStanding", () => {
  it("reads the A record, the PTR without its dot, and real listings only", async () => {
    const r = resolver(
      {
        "probe2.example.com": ["192.0.2.10"],
        "10.2.0.192.zen.spamhaus.org": ["127.255.255.254"],
        "10.2.0.192.bl.spamcop.net": ["127.0.0.2"],
      },
      { "192.0.2.10": ["probe2.example.com."] },
    );
    expect(await ipStanding("probe2.example.com", r)).toEqual({
      ip: "192.0.2.10",
      ptr: "probe2.example.com",
      listed: ["bl.spamcop.net"],
    });
  });
  it("a host that does not resolve", async () =>
    expect(await ipStanding("gone.example.com", resolver({}, {}))).toEqual({
      ip: null,
      ptr: null,
      listed: [],
    }));
});

describe("proberProblems", () => {
  it("none when PTR matches, unlisted, refusals low", () =>
    expect(proberProblems(healthy)).toEqual([]));
  it("missing PTR, a listing, too many refusals", () => {
    const p = proberProblems({ ...healthy, ptr: null, listed: ["bl.spamcop.net"], refused: 80 });
    expect(p).toHaveLength(3);
    expect(p[0]).toMatch(/PTR of 192.0.2.10 is missing/);
    expect(p[2]).toMatch(/16.0% of 500/);
  });
  it("a high share on a thin day is not a warning", () =>
    expect(proberProblems({ ...healthy, checks: 20, refused: 10 })).toEqual([]));
});

describe("proberHosts", () => {
  it("one URL or a comma list", () => {
    expect(proberHosts("https://a.example.com")).toEqual(["a.example.com"]);
    expect(proberHosts("https://a.example.com, https://b.example.com:8443")).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
    expect(proberHosts(undefined)).toEqual([]);
  });
});

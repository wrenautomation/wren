import { describe, expect, it } from "vitest";
import { domainOf, FETCH_TIER_DAYS, learning } from "./tier-memory.js";

describe("domainOf", () => {
  it("lowercases the host and drops a leading www.", () => {
    expect(domainOf("https://WWW.Example.COM/a?b=1")).toBe("example.com");
    expect(domainOf("http://shop.example.com:8080/")).toBe("shop.example.com");
    expect(domainOf("https://wwwx.example.com")).toBe("wwwx.example.com");
  });
  it("is null for a string that is not a URL", () => {
    expect(domainOf("not a url")).toBeNull();
  });
});

describe("learning", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const fresh = (tier: string) => ({ tier, learnedAt: ago(1) });
  const stale = (tier: string) => ({ tier, learnedAt: ago(FETCH_TIER_DAYS + 1) });

  it("writes nothing for plain with no row or a fresh row", () => {
    expect(learning(null, "plain", now)).toBe("keep");
    expect(learning(fresh("render"), "plain", now)).toBe("keep");
  });
  it("deletes a stale row when plain works", () => {
    expect(learning(stale("render"), "plain", now)).toBe("delete");
  });
  it("writes a first row", () => {
    expect(learning(null, "impersonate", now)).toBe("write");
  });
  it("leaves a fresh row alone on the same tier, so it can go stale", () => {
    expect(learning(fresh("render"), "render", now)).toBe("keep");
  });
  it("moves a fresh row up, never down", () => {
    expect(learning(fresh("impersonate"), "exit", now)).toBe("write");
    expect(learning(fresh("exit"), "impersonate", now)).toBe("keep");
  });
  it("replaces a stale row on any tier, even the same one", () => {
    expect(learning(stale("render"), "render", now)).toBe("write");
    expect(learning(stale("exit"), "impersonate", now)).toBe("write");
  });
});

import { isLadderTier } from "@wrenautomation/read/fetch";
import { describe, expect, it } from "vitest";
import { domainOf, FETCH_TIER_DAYS, shouldWrite } from "./tier-memory.js";

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

describe("isLadderTier", () => {
  it("is true for autobrowse rungs only", () => {
    expect(isLadderTier("render")).toBe(true);
    expect(isLadderTier("browser")).toBe(false);
    expect(isLadderTier("dead")).toBe(false);
    expect(isLadderTier(null)).toBe(false);
  });
});

describe("shouldWrite", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const fresh = (tier: string) => ({ tier, learnedAt: ago(1) });
  const stale = (tier: string) => ({ tier, learnedAt: ago(FETCH_TIER_DAYS + 1) });

  it("writes a first row", () => {
    expect(shouldWrite(null, "impersonate", now)).toBe(true);
  });
  it("leaves a fresh row alone on the same tier, so it can go stale", () => {
    expect(shouldWrite(fresh("render"), "render", now)).toBe(false);
  });
  it("writes when the tier changes, up or down, dead included", () => {
    expect(shouldWrite(fresh("impersonate"), "exit", now)).toBe(true);
    expect(shouldWrite(fresh("exit"), "browser", now)).toBe(true);
    expect(shouldWrite(fresh("render"), "dead", now)).toBe(true);
  });
  it("replaces a stale row, even on the same tier", () => {
    expect(shouldWrite(stale("render"), "render", now)).toBe(true);
  });
});

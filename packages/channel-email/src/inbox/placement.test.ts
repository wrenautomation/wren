import { describe, expect, it } from "vitest";
import {
  authFailures,
  type DomainPlacement,
  parseAuthResults,
  placementSummary,
  placementTrouble,
  verdictOf,
} from "./placement.js";

const t = (inbox: number, landed: number) => ({ inbox, landed });

describe("parseAuthResults", () => {
  it("takes each check's first verdict", () => {
    expect(
      parseAuthResults(
        "mx.google.com;\r\n dkim=pass header.i=@x.com header.s=google; spf=softfail (domain of a@x.com) smtp.mailfrom=a@x.com; dmarc=pass (p=NONE) header.from=x.com",
      ),
    ).toEqual({ spf: "softfail", dkim: "pass", dmarc: "pass" });
  });

  it("an absent check, or no header, is null", () => {
    expect(parseAuthResults("mx.google.com; spf=pass")).toEqual({
      spf: "pass",
      dkim: null,
      dmarc: null,
    });
    expect(parseAuthResults(undefined)).toEqual({ spf: null, dkim: null, dmarc: null });
  });

  it("does not read a check's name out of another word", () => {
    expect(parseAuthResults("mx.google.com; arc=pass; xspf=fail; spf=pass").spf).toBe("pass");
  });
});

describe("authFailures", () => {
  it("names every check that did not pass, missing ones too", () => {
    expect(authFailures({ spf: "pass", dkim: "fail", dmarc: null })).toEqual([
      "dkim=fail",
      "dmarc=none",
    ]);
    expect(authFailures({ spf: "pass", dkim: "pass", dmarc: "pass" })).toEqual([]);
  });
});

describe("verdictOf", () => {
  it("plain decides the domain; real only speaks once plain passes", () => {
    expect(verdictOf(t(4, 9), t(9, 9))).toBe("domain problem");
    expect(verdictOf(t(8, 9), t(4, 9))).toBe("copy problem");
    expect(verdictOf(t(8, 9), t(8, 9))).toBe("healthy");
    expect(verdictOf(t(8, 9), t(1, 2))).toBe("healthy");
  });

  it("under six landings says nothing", () => {
    expect(verdictOf(t(0, 5), t(0, 5))).toBe("not enough");
    expect(verdictOf(t(5, 5), t(0, 9))).toBe("not enough");
  });

  it("80% exactly passes", () => {
    expect(verdictOf(t(8, 10), t(8, 10))).toBe("healthy");
  });
});

const domain = (over: Partial<DomainPlacement>): DomainPlacement => ({
  domain: "x.com",
  senders: ["a@x.com"],
  plain: t(9, 9),
  real: t(8, 9),
  auth: [],
  verdict: "healthy",
  pausedAt: null,
  ...over,
});
const NOW = new Date("2026-10-20T12:00:00Z");

describe("placementSummary", () => {
  it("one line per domain: setup, plain, real, and any verdict", () => {
    expect(placementSummary(domain({}))).toBe("x.com: setup ok · plain 9/9 · real 8/9");
    expect(placementSummary(domain({ plain: t(0, 0), real: t(0, 0), verdict: "not enough" }))).toBe(
      "x.com: setup ok · plain none yet · real none yet · not enough",
    );
    expect(placementSummary(domain({ auth: ["a@x.com (plain): dkim=fail"], pausedAt: NOW }))).toBe(
      "x.com: setup 1 failing · plain 9/9 · real 8/9 · paused",
    );
  });
});

describe("placementTrouble", () => {
  it("auth failures, a copy problem, and a pause past two weeks", () => {
    expect(placementTrouble(domain({}), NOW)).toEqual([]);
    expect(placementTrouble(domain({ auth: ["a@x.com (real): spf=fail"] }), NOW)).toEqual([
      "x.com setup: a@x.com (real): spf=fail",
    ]);
    expect(placementTrouble(domain({ real: t(3, 9), verdict: "copy problem" }), NOW)).toEqual([
      "x.com: the opener lands 3/9 = 33% inbox while plain notes land 9/9 = 100%; the copy is the problem",
    ]);
    const old = new Date(NOW.getTime() - 15 * 86_400_000);
    expect(
      placementTrouble(domain({ plain: t(2, 9), verdict: "domain problem", pausedAt: old }), NOW),
    ).toEqual([
      "x.com: plain notes land 2/9 = 22% inbox; cold sends paused, warmup only",
      "x.com: still failing after 14 days paused; consider a new domain",
    ]);
  });
});

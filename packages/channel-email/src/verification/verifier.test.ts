/** EmailVerifier seam: fake, prober client (fake fetch, no network), factory. */
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../fetch-like.js";
import { ProbeClientVerifier, ProberError } from "./client.js";
import { FakeVerifier, makeVerifier } from "./verifier.js";

describe("FakeVerifier", () => {
  it.each([
    ["jane@foo.com", "valid"],
    ["jane+invalid@foo.com", "invalid"],
    ["jane+risky@foo.com", "risky"],
    ["jane+catchall@foo.com", "catch_all"],
  ])("%s -> %s", async (email, expected) =>
    expect((await new FakeVerifier().verify(email)).result).toBe(expected),
  );
  it("not authoritative by default", () => expect(new FakeVerifier().authoritative).toBe(false));
  it("authoritative overridable", () =>
    expect(new FakeVerifier({ authoritative: true }).authoritative).toBe(true));
});

function client(payload: unknown, status = 200, seen?: { url: string; init?: RequestInit }[]) {
  const fetchImpl: FetchLike = async (url, init) => {
    seen?.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify(payload), { status });
  };
  return new ProbeClientVerifier("http://box:2525/", "tok-123", fetchImpl);
}

describe("ProbeClientVerifier", () => {
  it("authoritative and free", () => {
    const v = client({ result: "valid", raw: {} });
    expect(v.authoritative).toBe(true);
    expect(v.costsCredits).toBe(false);
    expect(v.name).toBe("smtp");
  });
  it("posts the address with the bearer and hands back the prober's verdict", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const verdict = await client(
      { result: "catch_all", raw: { reason: "catch_all" } },
      200,
      seen,
    ).verify("jane@foo.com");
    expect(verdict).toEqual({ result: "catch_all", raw: { reason: "catch_all" } });
    expect(seen[0]?.url).toBe("http://box:2525/verify");
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ email: "jane@foo.com" }));
    expect(seen[0]?.init?.headers).toMatchObject({ authorization: "Bearer tok-123" });
  });
  it("http error and odd verdicts raise", async () => {
    await expect(client({}, 503).verify("jane@foo.com")).rejects.toThrow(/503/);
    await expect(client({ result: "maybe" }).verify("jane@foo.com")).rejects.toThrow(
      /unexpected verdict/,
    );
  });
  it("transport failure does not leak the token", async () => {
    const boom: FetchLike = async () => {
      throw new TypeError("fetch failed: Bearer tok-123 leaked?");
    };
    const err = await new ProbeClientVerifier("http://box", "tok-123", boom)
      .verify("jane@foo.com")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProberError);
    expect(String(err)).not.toContain("tok-123");
  });
});

describe("makeVerifier", () => {
  it("fake by name", async () => expect((await makeVerifier("fake", {})).name).toBe("fake"));
  it("smtp needs the prober url and token", async () =>
    expect(makeVerifier("smtp", { smtpProbeUrl: "http://box" })).rejects.toThrow(
      /WREN_SMTP_PROBE/,
    ));
  it("smtp with both", async () =>
    expect(
      (await makeVerifier("smtp", { smtpProbeUrl: "http://box", smtpProbeToken: "t" })).name,
    ).toBe("smtp"));
  it("smtp-direct needs a helo", async () =>
    expect(makeVerifier("smtp-direct", {})).rejects.toThrow(/WREN_SMTP_HELO/));
  it("unknown name raises", async () =>
    expect(makeVerifier("apollo", {})).rejects.toThrow(/unknown verifier/));
});

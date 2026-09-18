/** EmailVerifier seam: fake, MillionVerifier adapter (fake fetch, no network), factory. */
import { describe, expect, it } from "vitest";
import {
  type FetchLike,
  MILLIONVERIFIER_API_URL,
  MillionVerifier,
  MillionVerifierError,
} from "./millionverifier.js";
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

function adapter(payload: unknown, status = 200, seen?: string[]) {
  const fetchImpl: FetchLike = async (url) => {
    seen?.push(url);
    return new Response(JSON.stringify(payload), { status });
  };
  return new MillionVerifier("test-key", fetchImpl);
}

describe("MillionVerifier", () => {
  it("authoritative", () => expect(adapter({ result: "ok" }).authoritative).toBe(true));
  it.each([
    ["ok", "valid"],
    ["invalid", "invalid"],
    ["disposable", "invalid"],
    ["catch_all", "catch_all"],
    ["unknown", "risky"],
  ])("maps %s -> %s", async (api, expected) => {
    const verdict = await adapter({ result: api }).verify("jane@foo.com");
    expect(verdict.result).toBe(expected);
    expect(verdict.raw).toEqual({ result: api }); // provider payload kept as provenance
  });
  it("request carries key and email", async () => {
    const seen: string[] = [];
    await adapter({ result: "ok" }, 200, seen).verify("jane@foo.com");
    const url = new URL(seen[0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(MILLIONVERIFIER_API_URL);
    expect(url.searchParams.get("api")).toBe("test-key");
    expect(url.searchParams.get("email")).toBe("jane@foo.com");
  });
  it("api error field raises", async () =>
    expect(adapter({ error: "api key not found" }).verify("jane@foo.com")).rejects.toThrow(
      /api key/,
    ));
  it("unexpected result raises", async () =>
    expect(adapter({ result: "brand-new-status" }).verify("jane@foo.com")).rejects.toThrow(
      /unexpected result/,
    ));
  it("http error becomes MillionVerifierError", async () =>
    expect(adapter({}, 503).verify("jane@foo.com")).rejects.toThrow(/503/));
  it("credit exhaustion does not leak the api key", async () => {
    const err = await adapter({}, 402)
      .verify("jane@foo.com")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MillionVerifierError);
    expect(String(err)).not.toContain("test-key");
    expect((err as Error).cause).toBeUndefined();
  });
  it("transport failure does not leak the api key", async () => {
    const boom: FetchLike = async (url) => {
      throw new TypeError(`fetch failed: ${url}`);
    };
    const err = await new MillionVerifier("test-key", boom)
      .verify("jane@foo.com")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MillionVerifierError);
    expect(String(err)).not.toContain("test-key");
  });
});

describe("makeVerifier", () => {
  it("fake by name", async () => expect((await makeVerifier("fake", {})).name).toBe("fake"));
  it("millionverifier needs key", async () =>
    expect(makeVerifier("millionverifier", {})).rejects.toThrow(/MILLIONVERIFIER_API_KEY/));
  it("millionverifier with key", async () =>
    expect((await makeVerifier("millionverifier", { millionverifierApiKey: "k" })).name).toBe(
      "millionverifier",
    ));
  it("unknown name raises", async () =>
    expect(makeVerifier("apollo", {})).rejects.toThrow(/unknown verifier/));
});

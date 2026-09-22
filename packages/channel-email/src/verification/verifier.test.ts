/** The EmailVerifier seam: the fake, and the factory that picks a real one. */
import { describe, expect, it } from "vitest";
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

describe("makeVerifier", () => {
  it("fake by name", async () => expect((await makeVerifier("fake", {})).name).toBe("fake"));
  it("smtp needs the prober url and token", async () =>
    expect(makeVerifier("smtp", { smtpProbeUrl: "http://box" })).rejects.toThrow(
      /WREN_SMTP_PROBE/,
    ));
  it("smtp with both, and its verdicts count: authoritative and free", async () => {
    const v = await makeVerifier("smtp", { smtpProbeUrl: "http://box", smtpProbeToken: "t" });
    expect(v.name).toBe("smtp");
    expect(v.authoritative).toBe(true);
    expect(v.costsCredits).toBe(false);
  });
  it("smtp-direct needs a helo", async () =>
    expect(makeVerifier("smtp-direct", {})).rejects.toThrow(/WREN_SMTP_HELO/));
  it("unknown name raises", async () =>
    expect(makeVerifier("apollo", {})).rejects.toThrow(/unknown verifier/));
});

import { describe, expect, it } from "vitest";
import { nextOf } from "./next.js";

const BASE = "wrenautomation.com";
const PORTAL = "https://app.wrenautomation.com/";

describe("nextOf", () => {
  it("keeps our own hosts", () => {
    const next = "https://app.wrenautomation.com/reactivation/home?x=1";
    expect(nextOf(`?next=${encodeURIComponent(next)}`, BASE)).toBe(next);
  });
  it("sends anything else to the portal", () => {
    for (const next of [
      "https://evil.com/",
      "https://wrenautomation.com.evil.com/",
      "https://evilwrenautomation.com/",
      "http://app.wrenautomation.com/",
      "javascript:alert(1)",
      "//evil.com",
      "not a url",
    ])
      expect(nextOf(`?next=${encodeURIComponent(next)}`, BASE)).toBe(PORTAL);
    expect(nextOf("", BASE)).toBe(PORTAL);
  });
  it("sends a client host's landing page through the handoff, nothing else of theirs", () => {
    const back = "https://portal.acme.example/__auth/back?next=%2Fhome";
    expect(nextOf(`?next=${encodeURIComponent(back)}`, BASE)).toBe(
      `https://auth.wrenautomation.com/api/auth/handoff?to=${encodeURIComponent(back)}`,
    );
    for (const next of [
      "https://portal.acme.example/home",
      "http://portal.acme.example/__auth/back",
    ])
      expect(nextOf(`?next=${encodeURIComponent(next)}`, BASE)).toBe(PORTAL);
  });
});

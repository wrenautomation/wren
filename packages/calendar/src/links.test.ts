import { describe, expect, it } from "vitest";
import { bookSig, bookSigned, manageToken, manageUrl, readManage } from "./links.js";

const SHARED = "synthetic-shared";

describe("links", () => {
  it("a manage token reads back to its booking, and only with the same secret", () => {
    const t = manageToken(SHARED, 42);
    expect(readManage(SHARED, t)).toBe(42);
    expect(readManage("other", t)).toBeNull();
    expect(readManage(SHARED, t.replace(/^42/, "43"))).toBeNull();
    expect(readManage(SHARED, "42")).toBeNull();
    expect(manageUrl("https://example.test/", SHARED, 42)).toBe(
      `https://example.test/booking/${t}`,
    );
  });

  it("a booking signature binds offer, start and address, any case", () => {
    const sig = bookSig(SHARED, "intro", "2026-10-06T15:00:00.000Z", "Ann@Example.test");
    expect(bookSigned(SHARED, sig, "intro", "2026-10-06T15:00:00.000Z", "ann@example.test")).toBe(
      true,
    );
    expect(bookSigned(SHARED, sig, "intro", "2026-10-06T15:30:00.000Z", "ann@example.test")).toBe(
      false,
    );
    expect(bookSigned(SHARED, "nope", "intro", "2026-10-06T15:00:00.000Z", "a@b.test")).toBe(false);
  });
});

describe("client links", () => {
  it("a client's manage token opens only on that client's page", () => {
    const t = manageToken(SHARED, 7, "acme");
    expect(readManage(SHARED, t, "acme")).toBe(7);
    expect(readManage(SHARED, t, "other")).toBeNull();
    expect(readManage(SHARED, t)).toBeNull();
    expect(readManage(SHARED, manageToken(SHARED, 7), "acme")).toBeNull();
    expect(manageUrl("https://book.acme.test", SHARED, 7, "acme")).toBe(
      `https://book.acme.test/booking/${t}`,
    );
  });
});

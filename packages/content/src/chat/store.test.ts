import { describe, expect, it } from "vitest";
import { contactOf, keyHash } from "./store.js";

describe("contactOf", () => {
  it("reads an email, a phone, or nothing", () => {
    expect(contactOf(" Ann@Acme.Example ")).toEqual({ email: "ann@acme.example", phone: null });
    expect(contactOf("+1 (416) 555-0100")).toEqual({ email: null, phone: "+14165550100" });
    expect(contactOf("call me")).toEqual({ email: null, phone: null });
    expect(contactOf(42)).toEqual({ email: null, phone: null });
  });
});

describe("keyHash", () => {
  it("keeps the key out of the database", () => {
    expect(keyHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash("abc")).not.toContain("abc");
  });
});

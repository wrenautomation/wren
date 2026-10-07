import { describe, expect, it } from "vitest";
import { priceText, VENDORS, vendorOf, vendorSettingsSchema } from "./vendors.js";

describe("vendors", () => {
  it("each has a unique id, a dated price and a page for a paid one", () => {
    expect(new Set(VENDORS.map((v) => v.id)).size).toBe(VENDORS.length);
    for (const v of VENDORS) {
      expect(v.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (v.micros) expect(v.url, v.id).toMatch(/^https:\/\//);
      if (v.own === "key") expect(v.keyName, v.id).toMatch(/^[A-Z_]+$/);
    }
  });

  it("says a price as a person would", () => {
    expect(priceText(vendorOf("exa"))).toBe("$7.00 per 1,000 searches");
    expect(priceText(vendorOf("x"))).toBe("$5.00 per 1,000 post reads");
    expect(priceText(vendorOf("youtube"))).toBe("free");
    expect(priceText(vendorOf("models"))).toBe("no public price");
  });

  it("defaults: no markup, half kept for Wren, managed for every vendor but LinkedIn", () => {
    const s = vendorSettingsSchema.parse({});
    expect(s.markupPct).toBe(0);
    expect(s.reservePct).toBe(50);
    expect(s.managedForClients).not.toContain("linkedin");
    expect(s.managedForClients).toContain("exa");
  });

  it("LinkedIn: the account's 20 reads a day across kinds; search reads free and uncapped", () => {
    expect(vendorOf("linkedin")).toMatchObject({ quota: { perDay: 20, burst: 4 }, own: "login" });
    expect(vendorOf("linkedin_search")).toMatchObject({ micros: 0, quota: null, own: null });
    expect(priceText(vendorOf("linkedin_search"))).toBe("free");
  });
});

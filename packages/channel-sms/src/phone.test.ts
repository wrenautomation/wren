import { describe, expect, it } from "vitest";
import { countryOf, formatPhone, isTollFree, toPhoneE164, toUsE164 } from "./phone.js";

describe("toUsE164", () => {
  it("reads the ways a page writes a US number", () => {
    for (const raw of [
      "(212) 555-0187",
      "212.555.0187",
      "+1 212 555 0187",
      "1-212-555-0187",
      "tel:+12125550187",
    ]) {
      expect(toUsE164(raw.replace(/^tel:/, ""))).toBe("+12125550187");
    }
  });
  it("drops what is not a valid US number", () => {
    expect(toUsE164("")).toBeNull();
    expect(toUsE164("555-0187")).toBeNull();
    expect(toUsE164("+44 20 7946 0958")).toBeNull();
    expect(toUsE164("+1 416 555 0187")).toBeNull(); // Toronto: Canada, not US
    expect(toUsE164("(012) 555-0187")).toBeNull();
  });
});

describe("toPhoneE164 / countryOf", () => {
  it("takes US and Canadian numbers, nothing else", () => {
    expect(toPhoneE164("(212) 555-0187")).toBe("+12125550187");
    expect(toPhoneE164("416 555 0187")).toBe("+14165550187");
    expect(toPhoneE164("+44 20 7946 0958")).toBeNull();
    expect(toPhoneE164("555-0187")).toBeNull();
  });
  it("names the country", () => {
    expect(countryOf("+12125550187")).toBe("US");
    expect(countryOf("+14165550187")).toBe("CA");
    expect(countryOf("+442079460958")).toBeNull();
  });
});

describe("isTollFree / formatPhone", () => {
  it("knows toll-free by its digits", () => {
    expect(isTollFree("+18005550187")).toBe(true);
    expect(isTollFree("+12125550187")).toBe(false);
  });
  it("formats for reading", () => {
    expect(formatPhone("+12125550187")).toBe("(212) 555-0187");
  });
});

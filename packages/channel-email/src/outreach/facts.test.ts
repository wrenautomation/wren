/** sentenceReady: a new row, and every refusal named. */
import { describe, expect, it } from "vitest";
import { halfOf, sentenceReady } from "./facts.js";

describe("sentenceReady", () => {
  it("never touches the row handed in and names the refusals", () => {
    const filed = {
      first_name: "D",
      last_name: "SMITH",
      title: "CHIEF COMPLIANCE OFFICER",
      company_name: "ACME WEALTH, LLC",
      "company.aum_usd": 0,
      "company.ind_clients": 0,
      "company.employees": 12,
    };
    const before = { ...filed };
    const ready = sentenceReady(filed);
    expect(filed).toEqual(before);
    expect(ready.values.first_name).toBeNull();
    expect(ready.values.last_name).toBe("Smith");
    expect(ready.values.title).toBe("Chief Compliance Officer");
    expect(ready.values.company_name).toBe("Acme Wealth, LLC");
    expect(ready.values["company.aum"]).toBeNull();
    expect(ready.values["company.aum_usd"]).toBe(0);
    expect(ready.values["company.ind_clients"]).toBeNull();
    expect(ready.values["company.employees"]).toBe("12");
    expect(ready.refused).toEqual({ first_name: "D", "company.aum": 0, "company.ind_clients": 0 });
  });
  it("absence is not a refusal", () => {
    const ready = sentenceReady({ first_name: null, title: "  ", "company.aum_usd": null });
    expect(ready.refused).toEqual({});
    expect(ready.values.first_name).toBeNull();
    expect(ready.values.title).toBeNull();
    expect(ready.values["company.aum"]).toBeNull();
  });
  it("a row with nothing to rewrite passes through whole", () => {
    const ready = sentenceReady({ company_domain: "acme.example", person_id: 7 });
    expect(ready.values).toEqual({ company_domain: "acme.example", person_id: 7 });
    expect(ready.refused).toEqual({});
  });
  it("bigint columns arrive as strings from postgres and still read", () => {
    const ready = sentenceReady({ "company.aum_usd": "1234192870", "company.hnw_clients": "40" });
    expect(ready.values["company.aum"]).toBe("$1.2B");
    expect(ready.values["company.hnw_clients"]).toBe("40");
  });
});

describe("halfOf", () => {
  it("puts each company in the same half every time, and splits about evenly", () => {
    expect(halfOf(7)).toBe(halfOf("7"));
    const a = Array.from({ length: 1000 }, (_, i) => halfOf(i + 1)).filter((h) => h === "a").length;
    expect(a).toBeGreaterThan(450);
    expect(a).toBeLessThan(550);
  });
});

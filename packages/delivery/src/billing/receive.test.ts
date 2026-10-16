import { describe, expect, it } from "vitest";
import { parseReceive, payFields } from "./receive.js";

// Synthetic details: no real bank numbers in the repo.
const RAW = JSON.stringify({
  USD: {
    name: "Example Co",
    routing: "000000000",
    account: "111",
    swift: "TESTUS00",
    address: "1 Test St",
  },
  CAD: { name: "Example Co", institution: "000", transit: "00000", account: "222", extra: "x" },
  usd: { name: "lower case currency" },
  GBP: { name: " " },
});

describe("receive details", () => {
  it("keeps three-letter currencies with real values; anything malformed is none", () => {
    const d = parseReceive(RAW);
    expect(Object.keys(d).sort()).toEqual(["CAD", "USD"]);
    expect(parseReceive(undefined)).toEqual({});
    expect(parseReceive("not json")).toEqual({});
    expect(parseReceive("[1]")).toEqual({});
  });

  it("labels the fields in a bank form's order, unknown keys last", () => {
    const d = parseReceive(RAW);
    expect(payFields(d, "usd")).toEqual([
      ["Account holder", "Example Co"],
      ["Bank address", "1 Test St"],
      ["Routing number (ACH and wire)", "000000000"],
      ["Account number", "111"],
      ["Swift/BIC", "TESTUS00"],
    ]);
    expect(payFields(d, "CAD").map(([l]) => l)).toEqual([
      "Account holder",
      "Institution number",
      "Transit number",
      "Account number",
      "extra",
    ]);
    expect(payFields(d, "EUR")).toEqual([]);
  });
});

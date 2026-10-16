import { describe, expect, it } from "vitest";
import { billToOf, parseBillTo } from "./mail.js";

describe("bill-to", () => {
  it("keeps trimmed text only and drops empty fields", () => {
    expect(
      parseBillTo({ name: "  Acme Ltd ", address: ["1 Main St", " ", 7], email: "", x: "y" }),
    ).toEqual({ name: "Acme Ltd", address: ["1 Main St"] });
    expect(parseBillTo(null)).toEqual({});
  });

  it("falls back to the client's name", () => {
    expect(billToOf({ name: "Acme", products: {} })).toEqual({ name: "Acme" });
    expect(
      billToOf({
        name: "Acme",
        products: { "delivery.invoices": { billTo: { email: "pay@acme.test", taxNumber: "X1" } } },
      }),
    ).toEqual({ name: "Acme", email: "pay@acme.test", taxNumber: "X1" });
  });
});

import { describe, expect, it } from "vitest";
import type { VendorSpec } from "./chart.js";
import { billingQuery, mailClause, vendorFor } from "./mailbox.js";

const specs: VendorSpec[] = [
  { key: "acme", name: "Acme", account: "software", mail: { from: ["acme.example"] } },
  {
    key: "host",
    name: "Host",
    account: "hosting",
    mail: {
      from: ["billing@host.example", "host.example"],
      subject: ["invoice", "payment receipt"],
    },
  },
];

describe("mailClause", () => {
  it("is the sender alone, or senders and subject words", () => {
    expect(mailClause({ from: ["acme.example"] })).toBe("from:acme.example");
    expect(mailClause(specs[1]?.mail as VendorSpec["mail"])).toBe(
      '(from:billing@host.example OR from:host.example) subject:(invoice OR "payment receipt")',
    );
  });
});

describe("billingQuery", () => {
  it("is one search: every vendor since a day", () => {
    expect(billingQuery(specs, "2026-07-31")).toBe(
      'after:2026/07/31 {(from:acme.example) ((from:billing@host.example OR from:host.example) subject:(invoice OR "payment receipt"))}',
    );
  });
});

describe("vendorFor", () => {
  it("matches the sender's domain or a subdomain, and the subject words", () => {
    expect(vendorFor(specs, "Receipts@Mail.Acme.Example", "anything")?.key).toBe("acme");
    expect(vendorFor(specs, "billing@host.example", "Your Invoice #12")?.key).toBe("host");
    expect(vendorFor(specs, "news@host.example", "Payment receipt")?.key).toBe("host");
  });

  it("is null when a rule does not match", () => {
    expect(vendorFor(specs, "billing@host.example", "Welcome")).toBeNull();
    expect(vendorFor(specs, "x@notacme.example", "invoice")).toBeNull();
    expect(vendorFor(specs, "x@acme.example.evil", "invoice")).toBeNull();
  });
});

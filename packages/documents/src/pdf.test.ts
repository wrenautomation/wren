import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { invoicePdf } from "./pdf.js";

const base = {
  number: "WREN-1001",
  issuedOn: "2026-10-15",
  dueOn: "2026-10-29",
  currency: "USD",
  from: {
    name: "Example Co",
    place: "Somewhere",
    email: "billing@example.test",
    taxNumber: "123456789RT0001",
  },
  to: { name: "Client Example", address: ["1 Main St", "Pune, India"], email: "a@client.test" },
  lines: [{ what: "Setup", amount: "USD 1,000" }],
  total: "USD 1,000",
  reference: "WREN-1001",
};

describe("invoicePdf", () => {
  it("draws a one-page invoice, with or without bank details", async () => {
    for (const pay of [[["Account number", "111"]] as [string, string][], []]) {
      const bytes = await invoicePdf({ ...base, pay });
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toBe("Invoice WREN-1001");
    }
  });
});

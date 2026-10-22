import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { invoicePdf, sealedPdf } from "./pdf.js";
import type { Doc } from "./schema.js";

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

describe("sealedPdf", () => {
  const doc = (over: Partial<Doc> = {}) =>
    ({
      number: "CON-0001",
      kind: "contract",
      title: "Service agreement",
      name: "Sam Rivera",
      body: "# Scope\nWe tune the unit.\n\n- Parts included",
      lines: [{ name: "Tune-up", qty: 1, unit_cents: 14900, tax_pct: 0 }],
      currency: "USD",
      subtotalCents: 14900,
      taxCents: 0,
      totalCents: 14900,
      depositCents: 0,
      createdAt: new Date("2026-10-09T15:00:00Z"),
      sentAt: new Date("2026-10-10T15:00:00Z"),
      ...over,
    }) as Doc;

  it("prints the text, the consent line and the signature and date markers Documenso fills", async () => {
    const bytes = await sealedPdf(doc(), "Example Co");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Contract CON-0001: Service agreement");
    // Documenso finds its markers in the page's text: read the page streams back.
    const raw = Buffer.from(bytes).toString("latin1");
    const text = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1] as string, "latin1")).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("\n")
      // pdf-lib writes each string as hex: read it back as text.
      .replace(
        /<([0-9A-F]+)> Tj/g,
        (_, h: string) => `(${Buffer.from(h, "hex").toString("latin1")}) Tj`,
      );
    expect(text).toContain("{{signature, r1}}");
    expect(text).toContain("{{date, r1}}");
    expect(text).toContain("Electronic records and signature");
  });

  it("gives the same bytes for the same document, and a long body moves the block to a new page", async () => {
    const a = await sealedPdf(doc(), "Example Co");
    const b = await sealedPdf(doc(), "Example Co");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const long = await sealedPdf(doc({ body: "A line of terms.\n".repeat(60) }), "Example Co");
    expect((await PDFDocument.load(long)).getPageCount()).toBeGreaterThan(1);
  });
});

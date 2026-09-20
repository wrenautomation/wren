/** The roster adapter: dialect translation only; classification stays with the shared edge. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRow, IDENTITY_KEY, type RawRow } from "@wren/core";
import { describe, expect, it } from "vitest";
import { SecInvestmentAdviserSource } from "./roster.js";

const HEADERS = [
  "Organization CRD#",
  "Primary Business Name",
  "Legal Name",
  "Main Office City",
  "Main Office State",
  "Main Office Country",
  "Website Address",
  "5A",
  "5F(2)(c)",
];
const FIRM: Record<string, string> = {
  "Organization CRD#": "123456",
  "Primary Business Name": "CAUSEY WEALTH MANAGEMENT",
  "Legal Name": "CAUSEY WEALTH MANAGEMENT LLC",
  "Main Office City": "GREENWOOD VILLAGE",
  "Main Office State": "CO",
  "Main Office Country": "United States",
  "Website Address": "HTTPS://WWW.CAUSEYWEALTH.COM",
  "5A": "7",
  "5F(2)(c)": "393000000",
};

const quote = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
const csvText = (headers: string[], rows: string[][]) =>
  `${[headers, ...rows].map((r) => r.map(quote).join(",")).join("\n")}\n`;
function writeRoster(...rows: Record<string, string>[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "roster-")), "roster.csv");
  writeFileSync(
    path,
    csvText(
      HEADERS,
      rows.map((row) => HEADERS.map((h) => row[h] ?? "")),
    ),
  );
  return path;
}
const rowsOf = (path: string) => [...new SecInvestmentAdviserSource(path).rows()];
const one = (...rows: Record<string, string>[]) => rowsOf(writeRoster(...rows))[0] as RawRow;

describe("SecInvestmentAdviserSource", () => {
  it("prepends canonical keys and keeps the original row", () => {
    const row = one(FIRM);
    expect(row).toMatchObject({
      company_name: "CAUSEY WEALTH MANAGEMENT",
      website: "HTTPS://WWW.CAUSEYWEALTH.COM",
      geo: "Greenwood Village, CO",
      country: "US",
      [IDENTITY_KEY]: { source_key: "crd:123456" },
      "5F(2)(c)": "393000000",
      "5A": "7",
    });
  });

  it("emits an empty country for an unrecognized name, never a guess", () => {
    const row = one({ ...FIRM, "Main Office Country": "Freedonia" });
    expect(row.country).toBe("");
    expect(row["Main Office Country"]).toBe("Freedonia");
  });

  it("falls back to the legal name", () => {
    expect(one({ ...FIRM, "Primary Business Name": "" }).company_name).toBe(
      "CAUSEY WEALTH MANAGEMENT LLC",
    );
  });

  it("keeps the primary URL of a multi-URL cell, whatever the delimiter", () => {
    for (const cell of [
      "WWW.CAUSEYWEALTH.COM, WWW.CAUSEY401K.COM",
      "WWW.CAUSEYWEALTH.COM;WWW.CAUSEY401K.COM",
      "WWW.CAUSEYWEALTH.COM WWW.CAUSEY401K.COM",
      "WWW.CAUSEYWEALTH.COM;",
    ]) {
      expect(one({ ...FIRM, "Website Address": cell }).website).toBe("WWW.CAUSEYWEALTH.COM");
    }
  });

  it("skips blank rows", () => {
    expect(rowsOf(writeRoster(FIRM, {}))).toHaveLength(1);
  });

  it("decodes a windows-1252 file", () => {
    const path = writeRoster({ ...FIRM, "Legal Name": "CAUSEY WEALTH LLC" });
    writeFileSync(path, Buffer.from(readFileSync(path, "utf-8"), "latin1"));
    expect(rowsOf(path)[0]?.["Legal Name"]).toBe("CAUSEY WEALTH LLC");
  });

  it("names itself and hashes the file bytes", () => {
    const path = writeRoster(FIRM);
    const source = new SecInvestmentAdviserSource(path);
    expect(source.sourceType).toBe("sec_investment_advisers");
    expect(source.sourceRef).toBe(path);
    expect(source.contentHash).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
  });

  it("fails an undecodable file before any row", () => {
    const path = join(mkdtempSync(join(tmpdir(), "roster-")), "roster.csv");
    writeFileSync(
      path,
      Buffer.from([...Buffer.from("Organization CRD#\n"), 0x81, 0x8d, 0x90, 0x0a]),
    );
    expect(() => rowsOf(path)).toThrow(/neither utf-8 nor cp1252/);
  });

  it("suffixes duplicate headers instead of dropping them", () => {
    const path = join(mkdtempSync(join(tmpdir(), "roster-")), "roster.csv");
    writeFileSync(path, csvText([...HEADERS, "5A"], [[...HEADERS.map((h) => FIRM[h] ?? ""), "9"]]));
    const row = rowsOf(path)[0] as RawRow;
    expect(row["5A"]).toBe("7");
    expect(row["5A__2"]).toBe("9");
  });

  describe("through the edge", () => {
    it("classifies a firm as a company keyed by CRD", () => {
      expect(classifyRow(one(FIRM))).toMatchObject({
        kind: "company",
        domain: "causeywealth.com",
        name: "CAUSEY WEALTH MANAGEMENT",
        sourceKey: "crd:123456",
      });
    });

    it("imports a platform-only firm domainless, profile kept", () => {
      const url = "HTTPS://WWW.LINKEDIN.COM/COMPANY/CAUSEY-WEALTH";
      expect(classifyRow(one({ ...FIRM, "Website Address": url }))).toMatchObject({
        kind: "company",
        domain: null,
        sourceKey: "crd:123456",
        socialUrl: url,
      });
    });

    it("imports a website-less firm domainless", () => {
      expect(classifyRow(one({ ...FIRM, "Website Address": "" }))).toMatchObject({
        kind: "company",
        domain: null,
        socialUrl: null,
        sourceKey: "crd:123456",
      });
    });

    it("still errors a firm with neither CRD nor domain", () => {
      const row = one({ ...FIRM, "Organization CRD#": "", "Website Address": "" });
      expect(classifyRow(row).kind).toBe("error");
    });
  });
});

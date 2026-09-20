/** ADV filing-data zip adapter against a synthetic zip shaped like the real July 2026 file. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PersonItem, PersonRow } from "@wren/core";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { AdvFilingDataSource } from "./filing-data.js";

const BASE_HEADER = ["FilingID", "FormVersion", "DateSubmitted", "1A", "1B1", "1D", "1E1"];
const SCHED_HEADER = [
  "FilingID",
  "SchA-3",
  "Schedule",
  "Full Legal Name",
  "DE/FE/I",
  "Entity in Which",
  "Title or Status",
  "Status Acquired",
  "Ownership Code",
  "Control Person",
  "PR",
  "OwnerID",
];
const CCO_HEADER = ["FilingID", "1J1 Name", "1J2 Name", "1K Name"];

const quote = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
const csvBytes = (header: string[], rows: string[][]) =>
  Buffer.from(`${[header, ...rows].map((r) => r.map(quote).join(",")).join("\n")}\n`, "latin1");

function makeZip(members: Record<string, Uint8Array>): string {
  const path = join(mkdtempSync(join(tmpdir(), "adv-")), "ADV_Filing_Data_20260701_20260731.zip");
  writeFileSync(path, zipSync(members));
  return path;
}

const BASE = [
  [
    "100",
    "10/2021",
    "07/10/2026 04:20:33 PM",
    "ACME ADVISORS, LLC",
    "ACME ADVISORS",
    "801-1",
    "5001",
  ],
  ["101", "10/2021", "07/11/2026 09:00:00 AM", "SOLO WEALTH LLC", "", "801-2", "5002"],
  ["102", "10/2021", "bad date", "NO CRD LLC", "NO CRD", "801-3", ""],
];

function rowsOf(sched: string[][], cco: string[][]): PersonItem[] {
  const path = makeZip({
    "IA_ADV_Base_A_20260701_20260731.csv": csvBytes(BASE_HEADER, BASE),
    "IA_Schedule_A_B_20260701_20260731.csv": csvBytes(SCHED_HEADER, sched),
    "IA_ADV_1J_1K_20260701_20260731.csv": csvBytes(CCO_HEADER, cco),
    // ERA twins exist in the real zip and must be ignored.
    "ERA_Schedule_A_B_20260701_20260731.csv": csvBytes(SCHED_HEADER, []),
  });
  return [...new AdvFilingDataSource(path).rows()];
}
const owner = (filingId: string, name: string, kind = "I") => [
  filingId,
  "Y",
  "A",
  name,
  kind,
  "",
  "CHIEF OPERATING OFFICER",
  "01/2020",
  "NA",
  "Y",
  "N",
  "77",
];

describe("AdvFilingDataSource", () => {
  it("parses an individual owner", () => {
    const rows = rowsOf([owner("100", "NESS, BRIAN, STEVEN")], []);
    expect(rows).toHaveLength(1);
    const row = rows[0] as PersonRow;
    expect(row).toMatchObject({
      kind: "person",
      companySourceKey: "crd:5001",
      companyName: "ACME ADVISORS",
      fullName: "Brian Steven Ness",
      firstName: "Brian",
      lastName: "Ness",
      title: "CHIEF OPERATING OFFICER",
      origin: "registry",
      asOf: "2026-07-10",
    });
    expect(row.originRef).toContain("FilingID=100");
    expect(row.raw.OwnerID).toBe("77");
  });

  it("skips entity owners", () => {
    expect(rowsOf([owner("100", "HOLDING CO, LLC", "DE")], [])).toEqual([]);
  });

  it("errors an unknown FilingID", () => {
    const [row] = rowsOf([owner("999", "DOE, JANE")], []);
    expect(row).toMatchObject({ kind: "error" });
    expect((row as { reason: string }).reason).toContain("999");
  });

  it("errors a filing without a CRD", () => {
    const [row] = rowsOf([owner("102", "DOE, JANE")], []);
    expect((row as { reason: string }).reason).toContain("no CRD");
  });

  it("yields both the CCO and the 1K contact", () => {
    const [cco, contact] = rowsOf([], [["101", "KORI CUSICK", "", "MEGAN JENNINGS"]]) as [
      PersonRow,
      PersonRow,
    ];
    expect(cco).toMatchObject({
      fullName: "Kori Cusick",
      isCompliance: true,
      title: "Chief Compliance Officer",
      companySourceKey: "crd:5002",
      companyName: "SOLO WEALTH LLC", // base fell back to the legal name when 1B1 was blank
    });
    expect(contact).toMatchObject({ fullName: "Megan Jennings", isCompliance: false });
  });

  it("skips blank names", () => {
    expect(rowsOf([], [["102", "", "", ""]])).toEqual([]);
  });

  it("fails loudly on a zip without an expected member", () => {
    const path = makeZip({
      "IA_ADV_Base_A_x.csv": csvBytes(BASE_HEADER, []),
      "IA_ADV_1J_1K_x.csv": csvBytes(CCO_HEADER, []),
    });
    expect(() => [...new AdvFilingDataSource(path).rows()]).toThrow(/IA_Schedule_A_B_/);
  });
});

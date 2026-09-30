/** PPP sizing without a database: name keys, the newest release, matching, the enrichment output. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessNameKey,
  type CompanyPlace,
  type PppLoan,
  pppFirmographics,
  pppIndex,
  readPppLoans,
} from "./ppp-size.js";

const loan = (over: Partial<PppLoan> = {}): PppLoan => ({
  LoanNumber: "1000000001",
  BorrowerName: "ACME STAFFING LLC",
  BorrowerCity: "AUSTIN",
  BorrowerState: "TX",
  BorrowerZip: "78701-1234",
  InitialApprovalAmount: "50000",
  CurrentApprovalAmount: "50000",
  JobsReported: "10",
  FranchiseName: "",
  NAICSCode: "561320",
  ...over,
});
const company = (over: Partial<CompanyPlace> = {}): CompanyPlace => ({
  id: 1,
  names: ["Acme Staffing"],
  zip: null,
  state: null,
  ...over,
});

describe("businessNameKey", () => {
  it.each([
    ["The Acme Staffing Co., LLC", "acme staffing"],
    ["ACME STAFFING, INC.", "acme staffing"],
    ["Acme Staffing L.L.C.", "acme staffing"],
    ["Acme Staffing Corporation", "acme staffing"],
    ["Smith & Jones Personnel, P.C.", "smith and jones personnel"],
    ["Smith and Jones Personnel PLLC", "smith and jones personnel"],
    ["Acme-Staffing Ltd", "acme staffing"],
    ["  Talent   Partners  LP ", "talent partners"],
    ["Staff 360 Inc", "staff 360"],
    ["Inc.", ""],
  ])("%s -> %s", (name, key) => {
    expect(businessNameKey(name)).toBe(key);
  });

  it("suffix words are whole words only", () => {
    expect(businessNameKey("Incline Staffing")).toBe("incline staffing");
    expect(businessNameKey("Cobalt Company")).toBe("cobalt");
  });
});

describe("readPppLoans", () => {
  const header = "LoanNumber,BorrowerName,BorrowerState,BorrowerZip,CurrentApprovalAmount\n";
  it("reads only the newest release's files, header-keyed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ppp-"));
    writeFileSync(join(dir, "public_150k_plus_230930.csv"), `${header}9,OLD CO,TX,78701,1\n`);
    writeFileSync(join(dir, "public_150k_plus_240930.csv"), `${header}1,ACME,TX,78701,500000\n`);
    writeFileSync(
      join(dir, "public_up_to_150k_1_240930.csv"),
      `﻿${header}2,BETA,CA,94105,20000\n3,"GAMMA, INC",NY,10001,30000\n`,
    );
    writeFileSync(join(dir, "notes.txt"), "not a loan file");
    writeFileSync(join(dir, "public_150k_plus_250101.csv.part"), `${header}8,PARTIAL,TX,1,1\n`);
    const { release, loans } = readPppLoans(dir);
    expect(release).toBe("240930");
    expect(loans.map((l) => l.LoanNumber)).toEqual(["1", "2", "3"]);
    expect(loans[2]).toEqual({
      LoanNumber: "3",
      BorrowerName: "GAMMA, INC",
      BorrowerState: "NY",
      BorrowerZip: "10001",
      CurrentApprovalAmount: "30000",
    });
  });

  it("a directory with no loan files throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "ppp-"));
    writeFileSync(join(dir, "loans.csv"), "a,b\n");
    expect(() => readPppLoans(dir)).toThrow(/no PPP loan files/);
  });
});

describe("pppIndex.match", () => {
  it("name + ZIP (5 digits) matches, all the borrower's loans at that ZIP", () => {
    const first = loan({ LoanNumber: "1" });
    const second = loan({
      LoanNumber: "2",
      BorrowerName: "Acme Staffing, L.L.C.",
      BorrowerZip: "78701",
    });
    const elsewhere = loan({ LoanNumber: "3", BorrowerZip: "75001" });
    const index = pppIndex([first, second, elsewhere]);
    expect(index.match(company({ zip: "78701" }))).toEqual({
      how: "name_zip",
      loans: [first, second],
    });
    expect(index.match(company({ zip: "75001" }))).toEqual({ how: "name_zip", loans: [elsewhere] });
    expect(index.match(company({ zip: "10001" }))).toBeNull();
  });

  it("name + state only when every same-name loan in the state is at one ZIP", () => {
    const a = loan({ LoanNumber: "1", BorrowerZip: "78701" });
    const b = loan({ LoanNumber: "2", BorrowerZip: "78701-0001" });
    expect(pppIndex([a, b]).match(company({ state: "TX" }))).toEqual({
      how: "name_state",
      loans: [a, b],
    });
    const other = loan({ LoanNumber: "3", BorrowerZip: "75001" });
    expect(pppIndex([a, b, other]).match(company({ state: "TX" }))).toBeNull();
    // Another state's namesake doesn't spoil the match.
    const ca = loan({ LoanNumber: "4", BorrowerState: "CA", BorrowerZip: "94105" });
    expect(pppIndex([a, ca]).match(company({ state: "TX" }))?.loans).toEqual([a]);
  });

  it("lower-case borrower state is indexed upper", () => {
    const l = loan({ BorrowerState: "tx" });
    expect(pppIndex([l]).match(company({ state: "TX" }))).toEqual({
      how: "name_state",
      loans: [l],
    });
  });

  it("ZIP beats state: a ZIP hit on any name is taken first", () => {
    const byLegal = loan({
      LoanNumber: "1",
      BorrowerName: "Acme Holdings Inc",
      BorrowerZip: "78701",
    });
    const byTrade = loan({ LoanNumber: "2", BorrowerName: "Acme Staffing", BorrowerZip: "75001" });
    const index = pppIndex([byLegal, byTrade]);
    expect(
      index.match(
        company({ names: ["Acme Staffing", "ACME HOLDINGS, INC."], zip: "78701", state: "TX" }),
      ),
    ).toEqual({ how: "name_zip", loans: [byLegal] });
  });

  it("the legal name matches when the trade name doesn't", () => {
    const l = loan({ BorrowerName: "ACME HOLDINGS INC" });
    expect(
      pppIndex([l]).match(company({ names: ["Acme Talent", "Acme Holdings, Inc."], zip: "78701" })),
    ).toEqual({ how: "name_zip", loans: [l] });
  });

  it("no name, no ZIP, no state: no match; a suffix-only name never matches", () => {
    const index = pppIndex([loan(), loan({ BorrowerName: "LLC", BorrowerZip: "78701" })]);
    expect(index.match(company())).toBeNull();
    expect(index.match(company({ names: [], zip: "78701", state: "TX" }))).toBeNull();
    expect(index.match(company({ names: ["Inc."], zip: "78701", state: "TX" }))).toBeNull();
  });

  it("same-name loans in a state with no ZIPs don't prove one borrower", () => {
    const a = loan({ LoanNumber: "1", BorrowerZip: "" });
    const b = loan({ LoanNumber: "2", BorrowerZip: "" });
    expect(pppIndex([a, b]).match(company({ state: "TX" }))).toBeNull();
  });
});

describe("pppFirmographics", () => {
  it("payroll = top amount × 12 / 2.5, jobs = the max, franchise = the first named", () => {
    const loans = [
      loan({ CurrentApprovalAmount: "25000", JobsReported: "4", FranchiseName: "  " }),
      loan({
        CurrentApprovalAmount: "30000.50",
        JobsReported: "7",
        FranchiseName: "Express Pros ",
      }),
      loan({ CurrentApprovalAmount: "", InitialApprovalAmount: "40000", JobsReported: "x" }),
    ];
    expect(pppFirmographics("name_zip", "240930", loans)).toEqual({
      source: "ppp_foia",
      release: "240930",
      match: "name_zip",
      jobs_reported: 7,
      payroll_yearly_estimate: 192000,
      franchise: "Express Pros",
      loans,
    });
  });

  it("current amount of 0 falls back to the initial one", () => {
    const out = pppFirmographics("name_state", "240930", [
      loan({ CurrentApprovalAmount: "0", InitialApprovalAmount: "10000" }),
    ]);
    expect(out.payroll_yearly_estimate).toBe(48000);
  });

  it("no usable amounts or jobs give nulls, not zeros", () => {
    const out = pppFirmographics("name_state", "240930", [
      loan({
        CurrentApprovalAmount: "",
        InitialApprovalAmount: "-5",
        JobsReported: "0",
        FranchiseName: "",
      }),
    ]);
    expect(out).toMatchObject({
      jobs_reported: null,
      payroll_yearly_estimate: null,
      franchise: null,
    });
  });

  it("payroll is rounded to whole dollars", () => {
    expect(
      pppFirmographics("name_zip", "240930", [loan({ CurrentApprovalAmount: "1001" })])
        .payroll_yearly_estimate,
    ).toBe(4805); // 1001 × 12 / 2.5 = 4804.8
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  principalTitle,
  type SbaFirm,
  SbaSearchSource,
  sbaRow,
  sbaSearchFormat,
  stateCode,
  unshout,
} from "./sba.js";
import { classifyRow, IDENTITY_KEY } from "./schema.js";

const STAFFING = new Set(["561311", "561312", "561320"]);

const firm = (over: SbaFirm = {}): SbaFirm => ({
  uei: "ABCDEF123456",
  legal_business_name: "ACME STAFFING LLC",
  dba_name: null,
  website: "https://www.acmestaffing.example",
  additional_website: null,
  email: "jdoe@acmestaffing.example",
  display_email: true,
  phone: "(512) 555-0100",
  display_phone: true,
  contact_person: "JANE DOE",
  current_principals: "JANE DOE - PRESIDENT; JOHN ROE - SECRETARY",
  city: "AUSTIN",
  state: "Texas",
  zipcode: "78701",
  naics_primary: "561320",
  ...over,
});

let n = 0;
const root = mkdtempSync(join(tmpdir(), "wren-sba-"));
const answerDir = (files: Record<string, unknown>) => {
  const dir = join(root, `d${n++}`);
  mkdirSync(dir);
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  return dir;
};
const answer = (...results: unknown[]) => ({ status: "ok", results });

describe("unshout", () => {
  it.each([
    ["JOHN O'NEIL-MCCOY JR", "John O'Neil-McCoy Jr"],
    ["MARY MCDONALD", "Mary McDonald"],
    ["ROBERT SMITH III", "Robert Smith III"],
    ["ROBERT SMITH II, ESQ.", "Robert Smith II, Esq."],
    ["JAMES BROWN JR.", "James Brown Jr."],
    ["HENRY FORD IV", "Henry Ford IV"],
    ["CEO", "CEO"],
    ["VP SALES", "VP Sales"],
    ["DIRECTOR, HR", "Director, HR"],
    ["SMITH & JONES LLC", "Smith & Jones LLC"],
    ["ST. LOUIS", "St. Louis"],
    ["WINSTON-SALEM", "Winston-Salem"],
    ["MCALLEN", "McAllen"],
    ["MC", "Mc"],
    ["MCA", "Mca"],
    ["O'BRIEN", "O'Brien"],
    ["", ""],
  ])("%s -> %s", (shouted, written) => {
    expect(unshout(shouted)).toBe(written);
  });

  it("text that already has lowercase is left alone", () => {
    expect(unshout("Jane deVries")).toBe("Jane deVries");
    expect(unshout("JANE Doe")).toBe("JANE Doe");
  });

  it("a kept-upper word inside a slash or hyphen compound stays upper", () => {
    expect(unshout("PRESIDENT/CEO")).toBe("President/CEO");
    expect(unshout("VP-HR")).toBe("VP-HR");
  });
});

describe("stateCode", () => {
  it.each([
    ["Texas", "TX"],
    ["TEXAS", "TX"],
    ["new york", "NY"],
    ["District of Columbia", "DC"],
    ["Puerto Rico", "PR"],
    ["Guam", "GU"],
    ["U.S. Virgin Islands", "VI"],
    ["Virgin Islands", "VI"],
    ["American Samoa", "AS"],
    ["Northern Mariana Islands", "MP"],
    ["TX", "TX"],
    ["tx", "TX"],
    ["ZZ", "ZZ"], // two letters pass through by contract
  ])("%s -> %s", (state, code) => {
    expect(stateCode(state)).toBe(code);
  });

  it.each([null, "", "Ontario", "Texass", "T", "TEX", "Tex."])("unknown %j -> null", (state) => {
    expect(stateCode(state)).toBeNull();
  });
});

describe("principalTitle", () => {
  const principals = "JOHN ROE - SECRETARY; JANE DOE - PRESIDENT;MARY SMITH-JONES - VP - SALES";
  it("the contact's own entry, written out", () => {
    expect(principalTitle(principals, "JANE DOE")).toBe("President");
    expect(principalTitle(principals, "Jane Doe")).toBe("President");
    expect(principalTitle(principals, "MARY SMITH-JONES")).toBe("VP - Sales");
  });

  it("null when not listed, no principals, no contact, or a blank title", () => {
    expect(principalTitle(principals, "JANE Q DOE")).toBeNull();
    expect(principalTitle(null, "JANE DOE")).toBeNull();
    expect(principalTitle(principals, null)).toBeNull();
    expect(principalTitle("JANE DOE - ", "JANE DOE")).toBeNull();
    expect(principalTitle("JANE DOE", "JANE DOE")).toBeNull(); // no " - " separator
  });
});

describe("sbaRow", () => {
  it("lifts the canonical fields and keeps the record whole", () => {
    const f = firm();
    expect(sbaRow(f)).toEqual({
      company_name: "ACME STAFFING LLC",
      website: "https://www.acmestaffing.example",
      email: "jdoe@acmestaffing.example",
      full_name: "Jane Doe",
      title: "President",
      phone: "(512) 555-0100",
      geo: "Austin, TX",
      postcode: "78701",
      country: "US",
      source: "sba_search",
      sba: f,
    });
  });

  it("classifies as a person at the firm's domain", () => {
    expect(classifyRow(sbaRow(firm()))).toMatchObject({
      kind: "lead",
      email: "jdoe@acmestaffing.example",
      firstName: "Jane",
      lastName: "Doe",
      title: "President",
      companyDomain: "acmestaffing.example",
      companyName: "ACME STAFFING LLC",
      geo: "Austin, TX",
      country: "US",
      source: "sba_search",
      sourceKey: null,
    });
  });

  it("display_email / display_phone false hide the values", () => {
    const row = sbaRow(firm({ display_email: false, display_phone: false }));
    expect(row.email).toBeUndefined();
    expect(row.phone).toBeUndefined();
    const shown = sbaRow(firm({ display_email: undefined, display_phone: null }));
    expect(shown.email).toBe("jdoe@acmestaffing.example");
    expect(shown.phone).toBe("(512) 555-0100");
  });

  it("an email without @ is dropped", () => {
    expect(sbaRow(firm({ email: "n/a" })).email).toBeUndefined();
  });

  it("a platform website falls through to additional_website", () => {
    const row = sbaRow(
      firm({ website: "https://facebook.com/acme", additional_website: "acme-jobs.example" }),
    );
    expect(row.website).toBe("acme-jobs.example");
    expect(row[IDENTITY_KEY]).toBeUndefined();
  });

  it("an unusable website falls through too; website wins when both are good", () => {
    expect(sbaRow(firm({ website: "N/A", additional_website: "acme-jobs.example" })).website).toBe(
      "acme-jobs.example",
    );
    expect(
      sbaRow(firm({ website: "acme.example", additional_website: "acme-jobs.example" })).website,
    ).toBe("acme.example");
  });

  it("no usable site: keyed sba:<uei>", () => {
    for (const over of [
      { website: null, additional_website: null },
      { website: "https://linkedin.com/company/acme", additional_website: "  " },
      { website: "", additional_website: "https://www.yelp.com/biz/acme" },
    ]) {
      const row = sbaRow(firm({ ...over, email: "janedoe@gmail.com" }));
      expect(row.website).toBeUndefined();
      expect(row[IDENTITY_KEY]).toEqual({ source_key: "sba:ABCDEF123456" });
      expect(classifyRow(row)).toMatchObject({
        kind: "lead",
        companyDomain: null,
        sourceKey: "sba:ABCDEF123456",
      });
    }
  });

  it("no site and no UEI: nothing minted", () => {
    const row = sbaRow(firm({ website: null, uei: " " }));
    expect(row[IDENTITY_KEY]).toBeUndefined();
  });

  it("legal_name only when the firm trades under another name", () => {
    expect(sbaRow(firm()).legal_name).toBeUndefined();
    const dba = sbaRow(firm({ dba_name: "ACME TALENT" }));
    expect(dba.company_name).toBe("ACME TALENT");
    expect(dba.legal_name).toBe("ACME STAFFING LLC");
    expect(sbaRow(firm({ dba_name: "ACME STAFFING LLC" })).legal_name).toBeUndefined();
    expect(sbaRow(firm({ dba_name: "  " })).company_name).toBe("ACME STAFFING LLC");
  });

  it("geo is City, ST; either part alone; neither leaves it out", () => {
    expect(sbaRow(firm({ city: "NEW  YORK", state: "NY" })).geo).toBe("New York, NY");
    expect(sbaRow(firm({ city: "Round Rock", state: "Ontario" })).geo).toBe("Round Rock");
    expect(sbaRow(firm({ city: null, state: "Texas" })).geo).toBe("TX");
    expect(sbaRow(firm({ city: null, state: null })).geo).toBeUndefined();
  });

  it("postcode as given; title only for a listed principal", () => {
    expect(sbaRow(firm({ zipcode: "78701-1234" })).postcode).toBe("78701-1234");
    expect(sbaRow(firm({ zipcode: null })).postcode).toBeUndefined();
    const other = sbaRow(firm({ contact_person: "PAT LEE" }));
    expect(other.full_name).toBe("Pat Lee");
    expect(other.title).toBeUndefined();
  });

  it("non-string fields are ignored, never thrown on", () => {
    const row = sbaRow({ uei: 12, legal_business_name: ["x"], city: 5, zipcode: 78701 });
    expect(row).toEqual({
      country: "US",
      source: "sba_search",
      sba: { uei: 12, legal_business_name: ["x"], city: 5, zipcode: 78701 },
    });
  });
});

describe("SbaSearchSource", () => {
  it("merges firms across files by UEI, the file sorting last winning", () => {
    const dir = answerDir({
      "naics-561311-2026-09-30.json": answer(
        firm({ uei: "A1", city: "OLD TOWN" }),
        firm({ uei: "B2", legal_business_name: "BETA SEARCH INC", naics_primary: "561311" }),
      ),
      "naics-561320-2026-09-30.json": answer(firm({ uei: "A1", city: "NEW TOWN" })),
      "notes.txt": "ignored",
    });
    const source = new SbaSearchSource(dir, STAFFING);
    const rows = [...source.rows()];
    expect(rows.map((r) => (r.sba as SbaFirm).uei)).toEqual(["A1", "B2"]);
    expect(rows[0]?.geo).toBe("New Town, TX");
    expect(source.files.map((f) => f.slice(dir.length + 1))).toEqual([
      "naics-561311-2026-09-30.json",
      "naics-561320-2026-09-30.json",
    ]);
    expect(source.sourceType).toBe("sba_search");
    expect(source.sourceRef).toBe(dir);
    expect(source.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(source.declined()).toEqual({});
  });

  it("the newest answer wins across codes", () => {
    const dir = answerDir({
      "naics-561311-2026-10-02.json": answer(firm({ uei: "A1", city: "NEW TOWN" })),
      "naics-561312-2026-10-01.json": answer(firm({ uei: "A1", city: "OLD TOWN" })),
    });
    const [row] = [...new SbaSearchSource(dir, STAFFING).rows()];
    expect(row?.geo).toBe("New Town, TX");
  });

  it("firms whose primary NAICS isn't kept are declined not_primary and counted", () => {
    const dir = answerDir({
      "naics-561311-2026-09-30.json": answer(
        firm({ uei: "A1" }),
        firm({ uei: "C3", naics_primary: "541511" }),
        firm({ uei: "D4", naics_primary: null }),
        firm({ uei: null, naics_primary: "541611" }),
        firm({ uei: null, legal_business_name: "NO UEI ONE" }),
        firm({ uei: null, legal_business_name: "NO UEI TWO" }),
        null,
        "junk",
      ),
    });
    const source = new SbaSearchSource(dir, STAFFING);
    const rows = [...source.rows()];
    expect(rows.map((r) => r.company_name)).toEqual([
      "ACME STAFFING LLC",
      "NO UEI ONE",
      "NO UEI TWO",
    ]);
    expect(source.declined()).toEqual({ not_primary: 3 });
  });

  it("a single file path works", () => {
    const dir = answerDir({ "one.json": answer(firm()) });
    const source = new SbaSearchSource(join(dir, "one.json"), STAFFING);
    expect(source.files).toEqual([join(dir, "one.json")]);
    expect([...source.rows()]).toHaveLength(1);
  });

  it("a file with no results array throws on read", () => {
    const dir = answerDir({
      "a.json": answer(firm()),
      "b.json": { status: "error", message: "busy" },
    });
    const source = new SbaSearchSource(dir, STAFFING);
    expect(() => [...source.rows()]).toThrow(/b\.json: not an SBA search answer \(no results\)/);
  });

  it("a directory with no answer files throws at build", () => {
    const empty = answerDir({});
    expect(() => new SbaSearchSource(empty, STAFFING)).toThrow(/no SBA answer files/);
    const partOnly = answerDir({ "naics-561311-2026-09-30.json.part": "{" });
    expect(() => new SbaSearchSource(partOnly, STAFFING)).toThrow(/no SBA answer files/);
  });

  it("the hash covers every file", () => {
    const a = answerDir({ "a.json": answer(firm()), "b.json": answer() });
    const b = answerDir({ "a.json": answer(firm()), "b.json": answer(firm({ uei: "Z" })) });
    const c = answerDir({ "a.json": answer(firm()), "b.json": answer() });
    const hash = (d: string) => new SbaSearchSource(d, STAFFING).contentHash;
    expect(hash(a)).not.toBe(hash(b));
    expect(hash(a)).toBe(hash(c));
  });
});

describe("sbaSearchFormat", () => {
  it("a directory format keeping the niche's primary codes", () => {
    const format = sbaSearchFormat({
      name: "sba-demo",
      help: "demo help",
      niche: "demo",
      naics: ["541511"],
    });
    expect(format).toMatchObject({
      name: "sba-demo",
      help: "demo help",
      niche: "demo",
      columnMapped: false,
      directory: true,
    });
    const dir = answerDir({
      "x.json": answer(firm({ uei: "A" }), firm({ uei: "B", naics_primary: "541511" })),
    });
    const source = format.build(dir) as SbaSearchSource;
    expect(source).toBeInstanceOf(SbaSearchSource);
    expect([...source.rows()].map((r) => (r.sba as SbaFirm).uei)).toEqual(["B"]);
    expect(source.declined()).toEqual({ not_primary: 1 });
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCountry } from "./countries.js";
import {
  canonicalize,
  classifyRow,
  IDENTITY_KEY,
  type RawRow,
  validateCompanyRow,
  validateLeadRow,
} from "./schema.js";
import { CsvLeadSource, parseCsvRecords, rowsFromRecords } from "./sources.js";

const lead = (raw: RawRow, opts?: Parameters<typeof classifyRow>[1]) => {
  const row = classifyRow(raw, opts);
  if (row.kind !== "lead") throw new Error(`expected lead, got ${JSON.stringify(row)}`);
  return row;
};
const company = (raw: RawRow) => {
  const row = classifyRow(raw);
  if (row.kind !== "company") throw new Error(`expected company, got ${JSON.stringify(row)}`);
  return row;
};
const error = (raw: RawRow) => {
  const row = classifyRow(raw);
  if (row.kind !== "error") throw new Error(`expected error, got ${JSON.stringify(row)}`);
  return row;
};

describe("canonicalize", () => {
  it("maps ragged headers to fields", () => {
    expect(
      canonicalize({
        "E-Mail Address": "jane@foo.com",
        "  First Name ": "Jane",
        Company: "Foo LLC",
        "Website URL": "https://foo.com",
      }),
    ).toEqual({
      email: "jane@foo.com",
      first_name: "Jane",
      company_name: "Foo LLC",
      website: "https://foo.com",
    });
  });
  it("first non-empty alias wins in column order", () => {
    expect(canonicalize({ City: "Austin", State: "TX", Region: "Central" })).toEqual({
      geo: "Austin",
    });
  });
  it("country is its own field, not a geo alias", () => {
    expect(canonicalize({ City: "Austin", Country: "United States" })).toEqual({
      geo: "Austin",
      country: "United States",
    });
  });
  it("drops empty and null values", () => {
    expect(canonicalize({ email: "  ", name: null })).toEqual({});
  });
});

describe("normalizeCountry", () => {
  it.each([
    ["US", "US"],
    ["us", "US"],
    ["de", "DE"],
    ["United States", "US"],
    ["UNITED STATES OF AMERICA", "US"],
    ["USA", "US"],
    ["U.S.", "US"],
    ["U.S.A.", "US"],
    ["United Kingdom", "GB"],
    ["Great Britain", "GB"],
    ["UK", "GB"],
    ["Canada", "CA"],
    ["Australia", "AU"],
    ["Germany", "DE"],
    ["France", "FR"],
  ])("recognizes %s", (raw, expected) => expect(normalizeCountry(raw)).toBe(expected));
  it.each([null, "", "   ", "Freedonia", "North America", "1", "usa!"])(
    "unrecognized %s is null, never a guess",
    (raw) => expect(normalizeCountry(raw)).toBeNull(),
  );
  it.each(["XX", "ZZ", "QQ", "xx"])("bare two-letter junk %s rejected against the ISO set", (raw) =>
    expect(normalizeCountry(raw)).toBeNull(),
  );
  it("NA is not-applicable, not Namibia", () => {
    expect(normalizeCountry("NA")).toBeNull();
    expect(normalizeCountry("na")).toBeNull();
  });
  it.each([
    ["CA", "CA"],
    ["DE", "DE"],
    ["IN", "IN"],
    ["CO", "CO"],
    ["PA", "PA"],
    ["IL", "IL"],
    ["AL", "AL"],
    ["LA", "LA"],
  ])("state-code homograph %s still accepted as a country", (raw, expected) =>
    expect(normalizeCountry(raw)).toBe(expected),
  );
  it.each([
    ["Denmark", "DK"],
    ["Sweden", "SE"],
    ["Norway", "NO"],
    ["Belgium", "BE"],
    ["Luxembourg", "LU"],
    ["Israel", "IL"],
    ["United Arab Emirates", "AE"],
    ["Cayman Islands", "KY"],
    ["Bermuda", "BM"],
    ["Jersey", "JE"],
    ["Guernsey", "GG"],
    ["Isle of Man", "IM"],
  ])("long-form %s", (raw, expected) => expect(normalizeCountry(raw)).toBe(expected));
  it.each([
    ["Korea, South", "KR"],
    ["Bahamas, The", "BS"],
    ["Taiwan, Republic of China", "TW"],
  ])("comma-inverted %s swaps and retries", (raw, expected) =>
    expect(normalizeCountry(raw)).toBe(expected),
  );
});

describe("classifyRow: leads", () => {
  it("full lead row", () => {
    expect(
      classifyRow({
        email: "Jane@Foo.com",
        first_name: "Jane",
        last_name: "Doe",
        title: "Owner",
        company: "Foo LLC",
        website: "https://www.foo.com",
      }),
    ).toEqual({
      kind: "lead",
      email: "jane@foo.com",
      firstName: "Jane",
      lastName: "Doe",
      title: "Owner",
      companyName: "Foo LLC",
      companyDomain: "foo.com",
      socialUrl: null,
      country: null,
      countryRaw: null,
      persona: null,
      source: null,
      geo: null,
      sourceKey: null,
    });
  });
  it("company domain falls back to email domain", () =>
    expect(lead({ email: "jane@foo.com" }).companyDomain).toBe("foo.com"));
  it("freemail lead gets no company domain", () =>
    expect(lead({ email: "jane@gmail.com" }).companyDomain).toBeNull());
  it("platform website falls back to email domain, profile kept as social_url", () => {
    const row = lead({
      email: "jane@acmewealth.com",
      website: "https://linkedin.com/company/acme",
    });
    expect(row.companyDomain).toBe("acmewealth.com");
    expect(row.socialUrl).toBe("https://linkedin.com/company/acme");
  });
  it("website beats email domain for company", () =>
    expect(lead({ email: "jane@gmail.com", website: "foo.com" }).companyDomain).toBe("foo.com"));
  it("full name splits once", () => {
    const row = lead({ email: "j@foo.com", name: "Jane Q. Public" });
    expect([row.firstName, row.lastName]).toEqual(["Jane", "Q. Public"]);
  });
  it("single-token name is first only", () => {
    const row = lead({ email: "j@foo.com", contact: "Jane" });
    expect([row.firstName, row.lastName]).toEqual(["Jane", null]);
  });
  it("LAST, FIRST swaps", () => {
    const row = lead({ email: "j@foo.com", name: "SMITH, JOHN" });
    expect([row.firstName, row.lastName]).toEqual(["JOHN", "SMITH"]);
  });
  it("explicit first/last beat full name", () => {
    const row = lead({ email: "j@foo.com", name: "Wrong Person", "first name": "Jane" });
    expect([row.firstName, row.lastName]).toEqual(["Jane", null]);
  });
  it("country normalized to alpha-2", () =>
    expect(lead({ email: "j@foo.com", country: "United States" }).country).toBe("US"));
  it("unrecognized country is null, not guessed", () =>
    expect(lead({ email: "j@foo.com", country: "Freedonia" }).country).toBeNull());
  it("countryRaw distinguishes absent from unrecognized", () => {
    const absent = lead({ email: "j@foo.com" });
    expect([absent.country, absent.countryRaw]).toEqual([null, null]);
    const unrecognized = lead({ email: "j@foo.com", country: "Freedonia" });
    expect([unrecognized.country, unrecognized.countryRaw]).toEqual([null, "Freedonia"]);
  });
  it("overlong social_url truncates, not aborts", () => {
    const profile = `linkedin.com/in/${"x".repeat(600)}`;
    const row = lead({ email: "j@foo.com", website: profile });
    expect(row.socialUrl).toBe(profile.slice(0, 512));
    expect(row.socialUrl?.length).toBe(512);
  });
  it("a postal 'Mail' column does not shadow email", () =>
    expect(lead({ Mail: "123 Main St, Springfield", Email: "jane@foo.com" }).email).toBe(
      "jane@foo.com",
    ));
  it("lead source_key only recognized through the identity channel", () => {
    expect(lead({ email: "j@foo.com", [IDENTITY_KEY]: { source_key: "crd:5" } }).sourceKey).toBe(
      "crd:5",
    );
    expect(lead({ email: "j@foo.com", source_key: "crd:5" }).sourceKey).toBeNull();
    // A CSV column literally named _identity holds a string: data, not a minted key.
    expect(lead({ email: "j@foo.com", [IDENTITY_KEY]: "crd:5" }).sourceKey).toBeNull();
  });
  it("punycode email domain classifies as lead", () =>
    expect(lead({ email: "jane@xn--mnchen-3ya.de" }).companyDomain).toBe("xn--mnchen-3ya.de"));
  it("overlong 64-char columns truncate, not abort", () => {
    const long = "x".repeat(200);
    const row = lead({ email: "j@foo.com", persona: long, source: long, geo: long });
    expect([row.persona, row.source, row.geo]).toEqual([
      "x".repeat(64),
      "x".repeat(64),
      "x".repeat(64),
    ]);
  });
});

describe("classifyRow: companies", () => {
  it("bare company row", () => {
    expect(classifyRow({ "business name": "Foo LLC", website: "www.foo.com" })).toEqual({
      kind: "company",
      domain: "foo.com",
      name: "Foo LLC",
      sourceKey: null,
      socialUrl: null,
      country: null,
    });
  });
  it("domain-only row", () => expect(company({ domain: "foo.com" }).domain).toBe("foo.com"));
  it("source_key rescues a platform-only firm", () => {
    expect(
      classifyRow({
        company_name: "Acme Wealth",
        website: "www.linkedin.com/company/acme-wealth",
        [IDENTITY_KEY]: { source_key: "crd:105734" },
      }),
    ).toEqual({
      kind: "company",
      domain: null,
      name: "Acme Wealth",
      sourceKey: "crd:105734",
      socialUrl: "www.linkedin.com/company/acme-wealth",
      country: null,
    });
  });
  it("source_key rescues a websiteless firm", () => {
    expect(
      classifyRow({ company_name: "Acme Wealth", [IDENTITY_KEY]: { source_key: "crd:105734" } }),
    ).toEqual({
      kind: "company",
      domain: null,
      name: "Acme Wealth",
      sourceKey: "crd:105734",
      socialUrl: null,
      country: null,
    });
  });
  it("domain row carries its source_key", () => {
    const row = company({ website: "foo.com", [IDENTITY_KEY]: { source_key: "crd:1" } });
    expect([row.domain, row.sourceKey]).toEqual(["foo.com", "crd:1"]);
  });
  it("company row requires some identifier", () => {
    const row = validateCompanyRow({
      domain: null,
      name: "Ghost LLC",
      sourceKey: null,
      socialUrl: null,
      country: null,
    });
    expect(row.kind === "error" && row.reason).toMatch(/domain or a source_key/);
  });
  it("country normalized on company row", () =>
    expect(company({ website: "foo.com", country: "Germany" }).country).toBe("DE"));
  it("overlong company social_url truncates", () => {
    const profile = `linkedin.com/company/${"x".repeat(600)}`;
    const row = company({
      company_name: "Acme",
      website: profile,
      [IDENTITY_KEY]: { source_key: "crd:1" },
    });
    expect(row.socialUrl).toBe(profile.slice(0, 512));
  });
  it("a source_key column never asserts identity", () => {
    const row = company({ website: "foo.com", source_key: "crd:1" });
    expect([row.domain, row.sourceKey]).toEqual(["foo.com", null]);
  });
  it("bare source_key column is an error", () =>
    expect(classifyRow({ company_name: "Ghost LLC", source_key: "crd:1" }).kind).toBe("error"));
});

describe("classifyRow: errors", () => {
  it.each([
    [{ email: "not-an-email", website: "foo.com" }, "invalid email"],
    [{ company: "Foo LLC" }, "without a usable domain"],
    [{ website: "N/A" }, "unusable website"],
    [{ phone: "555-1234" }, "no email or website"],
  ])("%o -> %s", (raw, fragment) => expect(error(raw).reason).toContain(fragment));
  it("platform website without source_key is an error", () =>
    expect(
      error({ company_name: "Acme Wealth", website: "www.linkedin.com/company/acme-wealth" })
        .reason,
    ).toContain("platform profile"));
  it("broken email is not downgraded to company", () =>
    expect(classifyRow({ email: "jane@@foo.com", url: "foo.com" }).kind).toBe("error"));
  it("a validation failure is a row error, never a batch abort", () => {
    // The DB-mirroring validators disagree with the pre-checks only on shapes the pre-checks can't reach.
    const l = validateLeadRow({
      email: "jane@foo.com",
      firstName: null,
      lastName: null,
      title: null,
      companyName: null,
      companyDomain: "-bad-",
      socialUrl: null,
      country: null,
      countryRaw: null,
      persona: null,
      source: null,
      geo: null,
      sourceKey: null,
    });
    expect(l.kind === "error" && l.reason).toContain("row failed validation");
    const c = validateCompanyRow({
      domain: "-bad-",
      name: null,
      sourceKey: null,
      socialUrl: null,
      country: null,
    });
    expect(c.kind === "error" && c.reason).toContain("row failed validation");
  });
});

describe("CsvLeadSource", () => {
  const dir = mkdtempSync(join(tmpdir(), "wren-csv-"));
  const file = (name: string, bytes: Uint8Array | string) => {
    const p = join(dir, name);
    writeFileSync(p, bytes);
    return p;
  };

  it("reads BOM and skips blank rows; spilled cells ride under _overflow", () => {
    const path = file(
      "leads.csv",
      "﻿Email,First Name\r\njane@foo.com,Jane\r\n,\r\nbob@bar.com,Bob,spilled-cell\r\n",
    );
    const source = new CsvLeadSource(path);
    expect(source.sourceType).toBe("csv");
    expect(source.sourceRef).toBe(path);
    expect([...source.rows()]).toEqual([
      { Email: "jane@foo.com", "First Name": "Jane" },
      { Email: "bob@bar.com", "First Name": "Bob", _overflow: ["spilled-cell"] },
    ]);
  });
  it("content hash is sha256 of the file bytes", () => {
    const path = file("hash.csv", "Email\njane@foo.com\n");
    expect(new CsvLeadSource(path).contentHash).toBe(
      "8ebfa28291e6390291312e409ef8d82837b6807e636c10ee3e0083855a2cf578",
    );
  });
  it("windows-1252 export decodes", () => {
    const path = file(
      "cp1252.csv",
      Buffer.from("Email,First Name\njane@foo.com,Ren\xe9\n", "latin1"),
    );
    expect([...new CsvLeadSource(path).rows()]).toEqual([
      { Email: "jane@foo.com", "First Name": "René" },
    ]);
  });
  it("UTF-16 BOM is rejected", () => {
    const path = file(
      "utf16.csv",
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Email\njane@foo.com\n", "utf16le")]),
    );
    expect(() => [...new CsvLeadSource(path).rows()]).toThrow(/UTF-16\/32/);
  });
  it("NUL byte is rejected", () => {
    const path = file("nul.csv", Buffer.from("Email\x00\njane@foo.com\n", "latin1"));
    expect(() => [...new CsvLeadSource(path).rows()]).toThrow(/NUL byte/);
  });
  it("duplicate headers are suffixed, not dropped", () => {
    const path = file("dup.csv", "Email,Email\npersonal@foo.com,work@foo.com\n");
    expect([...new CsvLeadSource(path).rows()]).toEqual([
      { Email: "personal@foo.com", Email__2: "work@foo.com" },
    ]);
  });
  it("short row fills missing trailing cells with null", () => {
    const path = file("short.csv", "Email,First Name,Title\njane@foo.com\n");
    expect([...new CsvLeadSource(path).rows()]).toEqual([
      { Email: "jane@foo.com", "First Name": null, Title: null },
    ]);
  });
});

it("all-blank rows are not data rows", () => {
  // Formatting, not data: must not shift row numbers nor be rejected as an empty claim.
  expect([...rowsFromRecords(parseCsvRecords("email,name\n\n , \na@b.com,Ann\n"))]).toEqual([
    { email: "a@b.com", name: "Ann" },
  ]);
});

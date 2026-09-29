/**
 * Adversarial unit tests: CRM exports as they arrive in the wild. Each test asserts
 * what the spec implies, not what the code happens to do.
 */
import type { PersonRow } from "@wren/core";
import { describe, expect, it } from "vitest";
import { dayOrder, parseCrmDate } from "./dates.js";
import { CRM_FORMATS, mapHeaders } from "./formats.js";
import { CrmCsvSource } from "./source.js";

const format = (name: string) => {
  const f = CRM_FORMATS.get(name);
  if (!f) throw new Error(name);
  return f;
};
const fromBytes = (name: string, bytes: Uint8Array) =>
  new CrmCsvSource(format(name), "t.csv", bytes);
const fromText = (name: string, csv: string) => fromBytes(name, new TextEncoder().encode(csv));
/** Latin-1 bytes: every char below 256 is one byte (cp1252 agrees on these). */
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const items = (s: CrmCsvSource) => [...s.rows()];
const persons = (s: CrmCsvSource) => items(s).filter((i): i is PersonRow => i.kind === "person");

describe("mapHeaders: real exports", () => {
  it("maps a HubSpot contacts export header row", () => {
    const map = mapHeaders(format("hubspot"), [
      "Record ID",
      "First Name",
      "Last Name",
      "Email",
      "Phone Number",
      "Job Title",
      "Contact owner",
      "Lifecycle Stage",
      "Lead Status",
      "Create Date",
      "Last Activity Date",
      "Last Contacted",
      "Associated Company IDs",
      "Associated Company",
      "Company Name",
      "Website URL",
    ]);
    expect(map).toMatchObject({
      id: "Record ID",
      firstName: "First Name",
      lastName: "Last Name",
      email: "Email",
      phone: "Phone Number",
      title: "Job Title",
      owner: "Contact owner",
      status: "Lifecycle Stage",
      created: "Create Date",
      lastContacted: "Last Contacted",
      company: "Company Name",
      website: "Website URL",
    });
  });

  it("maps a Salesforce contacts report header row", () => {
    const map = mapHeaders(format("salesforce"), [
      "Salutation",
      "First Name",
      "Last Name",
      "Title",
      "Account Name",
      "Mailing City",
      "Phone",
      "Mobile",
      "Email",
      "Contact Owner",
      "Last Activity",
      "Created Date",
      "Contact ID",
      "Account ID",
    ]);
    expect(map).toMatchObject({
      id: "Contact ID",
      firstName: "First Name",
      lastName: "Last Name",
      title: "Title",
      company: "Account Name",
      phone: "Phone",
      email: "Email",
      owner: "Contact Owner",
      lastContacted: "Last Activity",
      created: "Created Date",
    });
  });

  it("maps a Salesforce Data Loader export: Id is the id, AccountId is not the company", () => {
    const map = mapHeaders(format("salesforce"), [
      "Id",
      "AccountId",
      "FirstName",
      "LastName",
      "Email",
      "Title",
      "OwnerId",
      "Owner.Name",
      "LastActivityDate",
      "CreatedDate",
      "Account.Name",
      "Account.Website",
    ]);
    expect(map).toMatchObject({
      id: "Id",
      company: "Account.Name",
      website: "Account.Website",
      owner: "Owner.Name",
      lastContacted: "LastActivityDate",
      created: "CreatedDate",
    });
  });

  it("maps a Bullhorn ClientContact export header row", () => {
    const map = mapHeaders(format("bullhorn"), [
      "ID",
      "Name",
      "Title",
      "Client Corporation",
      "Email",
      "Email 2",
      "Phone",
      "Owner",
      "Status",
      "Date Added",
      "Date Last Comment",
      "Date of Last Placement",
    ]);
    expect(map).toMatchObject({
      id: "ID",
      fullName: "Name",
      title: "Title",
      company: "Client Corporation",
      email: "Email",
      owner: "Owner",
      status: "Status",
      created: "Date Added",
      lastContacted: "Date Last Comment",
      lastPlacement: "Date of Last Placement",
    });
  });
});

describe("mapHeaders: headers two fields could claim", () => {
  it("gives Name to the person and Company Name to the company, in either order", () => {
    for (const headers of [
      ["Company Name", "Name", "Email"],
      ["Name", "Company Name", "Email"],
    ]) {
      expect(mapHeaders(format("crm-generic"), headers)).toMatchObject({
        fullName: "Name",
        company: "Company Name",
      });
    }
  });

  it("does not read Company Name as a person's name when no Name column exists", () => {
    const map = mapHeaders(format("crm-generic"), ["Company Name", "First Name", "Last Name"]);
    expect(map.fullName).toBeUndefined();
    expect(map.company).toBe("Company Name");
  });

  it("gives Owner, not Owner ID, the owner field", () => {
    for (const f of ["crm-generic", "salesforce", "bullhorn", "hubspot"]) {
      const map = mapHeaders(format(f), ["Name", "Email", "Owner ID", "Owner"]);
      expect(map.owner, f).toBe("Owner");
      expect(map.id, f).not.toBe("Owner ID");
    }
  });

  it("keeps an Account Owner column out of the company field", () => {
    const map = mapHeaders(format("salesforce"), ["Name", "Account Owner", "Account Name"]);
    expect(map.company).toBe("Account Name");
    expect(map.owner).toBe("Account Owner");
  });

  it("does not take a LinkedIn URL column as the website", () => {
    const map = mapHeaders(format("crm-generic"), ["Name", "Email", "LinkedIn URL"]);
    expect(map.website).toBeUndefined();
    expect(map.linkedin).toBe("LinkedIn URL");
  });

  it("does not take Created By as the created date", () => {
    const map = mapHeaders(format("salesforce"), ["Name", "Email", "Created By", "Created Date"]);
    expect(map.created).toBe("Created Date");
  });

  it("accepts a website-only file (a person at a company, no email)", () => {
    expect(() => mapHeaders(format("crm-generic"), ["Name", "Website"])).not.toThrow();
  });

  it("fails loudly on a semicolon-delimited export instead of mis-mapping it", () => {
    expect(() =>
      fromText("crm-generic", "Name;Email;Company\nJane Doe;jane@acme.com;Acme\n"),
    ).toThrow(/Headers: Name;Email;Company/);
  });

  it("fails loudly on an empty file", () => {
    expect(() => fromText("crm-generic", "")).toThrow();
  });
});

describe("parseCrmDate: edges", () => {
  it("handles Feb 29 by leap year", () => {
    expect(parseCrmDate("2/29/2024")).toBe("2024-02-29");
    expect(parseCrmDate("2024-02-29")).toBe("2024-02-29");
    expect(parseCrmDate("2/29/2023")).toBeNull();
    expect(parseCrmDate("29/02/2023", "dmy")).toBeNull();
    expect(parseCrmDate("2/29/00")).toBe("2000-02-29");
  });

  it("reads 2-digit years around the century", () => {
    expect(parseCrmDate("12/31/99")).toBe("1999-12-31");
    expect(parseCrmDate("1/1/00")).toBe("2000-01-01");
    expect(parseCrmDate("3/5/24")).toBe("2024-03-05");
  });

  it("reads epoch milliseconds; epoch seconds is either right or null, never another day", () => {
    expect(parseCrmDate("1709647320000")).toBe("2024-03-05");
    expect([null, "2024-03-05"]).toContain(parseCrmDate("1709647320"));
  });

  it("returns null for placeholders", () => {
    for (const v of [
      "N/A",
      "n/a",
      "-",
      "0",
      "null",
      "NULL",
      "TBD",
      "none",
      "  ",
      "0000-00-00",
      "0000-00-00 00:00:00",
    ])
      expect(parseCrmDate(v), v).toBeNull();
  });

  it("returns null for sentinel years, never a year it made up", () => {
    // .NET DateTime.MinValue and friends: year 1 is not 2001.
    expect(parseCrmDate("0001-01-01")).toBeNull();
    expect(parseCrmDate("0001-01-01T00:00:00")).toBeNull();
    expect(parseCrmDate("1/1/0001")).toBeNull();
  });

  it("never reads an impossible slash date", () => {
    expect(parseCrmDate("13/13/2024", "mdy")).toBeNull();
    expect(parseCrmDate("13/13/2024", "dmy")).toBeNull();
    expect(parseCrmDate("12/31/2024", "dmy")).toBeNull();
    expect(parseCrmDate("0/5/2024")).toBeNull();
  });

  it("reads other common shapes right or not at all", () => {
    expect([null, "2024-03-05"]).toContain(parseCrmDate("2024/03/05"));
    expect([null, "2024-03-05"]).toContain(parseCrmDate("5-Mar-2024"));
    expect([null, "2024-03-05"]).toContain(parseCrmDate("March 5th, 2024"));
    expect(parseCrmDate("Mar 5, 2024 3:15 PM")).toBe("2024-03-05");
    expect(parseCrmDate("Tue Mar 05 2024 14:22:00 GMT+0000")).toBe("2024-03-05");
    expect(parseCrmDate("05.03.2024", "dmy")).toBe("2024-03-05");
  });

  it("does not invent a day for a month-and-year value", () => {
    expect(parseCrmDate("Mar 2024")).toBeNull();
    expect(parseCrmDate("March 32, 2024")).toBeNull();
  });

  it("decides day order from any date column, ignoring ISO and blanks", () => {
    expect(dayOrder([null, "", "2024-12-25", "03/05/2024"])).toBe("mdy");
    expect(dayOrder(["25.12.2024"])).toBe("dmy");
    expect(dayOrder([" 31/01/2024 "])).toBe("dmy");
  });
});

describe("CrmCsvSource: bytes", () => {
  it("reads a UTF-8 file with a BOM", () => {
    const body = new TextEncoder().encode("Name,Email,Company\nJane Doe,jane@acme.com,Acme\n");
    const s = fromBytes("crm-generic", new Uint8Array([0xef, 0xbb, 0xbf, ...body]));
    expect(s.headers.fullName).toBe("Name");
    const [jane] = persons(s);
    expect(jane).toMatchObject({ fullName: "Jane Doe", companyDomain: "acme.com" });
    expect(s.record(1)?.email).toBe("jane@acme.com");
  });

  it("reads a cp1252 (Excel on Windows) file", () => {
    const s = fromBytes(
      "crm-generic",
      latin1("Name,Email,Company\nJos\u00e9 Garc\u00eda,jose@acme.com,Soci\u00e9t\u00e9 Acme\n"),
    );
    const [jose] = persons(s);
    expect(jose).toMatchObject({ fullName: "José García", companyName: "Société Acme" });
  });

  it("keeps quoted commas and newlines inside one cell", () => {
    const s = fromText(
      "crm-generic",
      'Name,Email,Company,Title\nJane Doe,jane@acme.com,"Acme, Inc.","VP,\nTalent"\nBob Roe,bob@acme.com,Acme,CTO\n',
    );
    const got = persons(s);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ companyName: "Acme, Inc.", title: "VP,\nTalent" });
    expect(got[1]).toMatchObject({ fullName: "Bob Roe" });
  });

  it("skips blank rows without shifting row numbers against records", () => {
    const s = fromText(
      "crm-generic",
      "ID,Name,Email,Company\n\n1,Jane Doe,jane@acme.com,Acme\n,,,\n   ,  ,,\n2,Bob Roe,bob@acme.com,Acme\n\n",
    );
    expect(s.rowCount).toBe(2);
    const got = items(s);
    expect(got.map((i) => i.kind)).toEqual(["person", "person"]);
    expect(s.record(1)?.crmKey).toBe("1");
    expect(s.record(2)?.crmKey).toBe("2");
  });

  it("keeps cells past the header instead of dropping the row", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company\nJane Doe,jane@acme.com,Acme,extra,more\n",
    );
    const [jane] = persons(s);
    expect(jane?.raw._overflow).toEqual(["extra", "more"]);
  });

  it("reads the first of two same-named columns and keeps the second in raw", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Email,Company\nJane Doe,jane@acme.com,jd@acme.com,Acme\n",
    );
    const [jane] = persons(s);
    expect(s.record(1)?.email).toBe("jane@acme.com");
    expect(jane?.raw).toMatchObject({ Email: "jane@acme.com", Email__2: "jd@acme.com" });
  });
});

describe("CrmCsvSource: names", () => {
  it("reads a 'Last, First' name column as first Jane, last Doe", () => {
    const s = fromText("crm-generic", 'Name,Email,Company\n"Doe, Jane",jane@acme.com,Acme\n');
    const [jane] = persons(s);
    expect(jane).toMatchObject({ firstName: "Jane", lastName: "Doe" });
  });

  it("title-cases shouted names, keeps apostrophes and hyphens", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company\nJANE O'BRIEN-SMITH,jane@acme.com,Acme\n",
    );
    const [jane] = persons(s);
    expect(jane).toMatchObject({
      fullName: "Jane O'Brien-Smith",
      firstName: "Jane",
      lastName: "O'Brien-Smith",
    });
  });

  it("title-cases split first/last columns too", () => {
    const s = fromText(
      "crm-generic",
      "First Name,Last Name,Email,Company\njane,DOE,jane@acme.com,Acme\n",
    );
    const [jane] = persons(s);
    expect(jane).toMatchObject({ fullName: "Jane Doe", firstName: "Jane", lastName: "Doe" });
  });

  it("falls back to first + last when the full-name cell is blank", () => {
    const s = fromText(
      "crm-generic",
      "Name,First Name,Last Name,Email,Company\n,Jane,Doe,jane@acme.com,Acme\n",
    );
    expect(persons(s)[0]).toMatchObject({ fullName: "Jane Doe" });
  });

  it("makes an error row, not a person, for a nameless row", () => {
    const s = fromText("crm-generic", "Name,Email,Company\n  ,jane@acme.com,Acme\n");
    expect(items(s)[0]?.kind).toBe("error");
    expect(s.record(1)).toBeNull();
  });
});

describe("CrmCsvSource: email cells", () => {
  const one = (cell: string) => {
    const s = fromText("crm-generic", `Name,Email,Company\nJane Doe,"${cell}",Acme\n`);
    const [p] = persons(s);
    return { email: s.record(1)?.email, domain: p?.companyDomain };
  };

  it("strips mailto: and case", () => {
    expect(one("mailto:Jane@ACME.com")).toEqual({ email: "jane@acme.com", domain: "acme.com" });
  });

  it("takes the first of several addresses", () => {
    expect(one("jane@acme.com; jane.doe@gmail.com").email).toBe("jane@acme.com");
    expect(one("jane@acme.com, jd@acme.com").email).toBe("jane@acme.com");
    expect(one("jane@acme.com\njd@acme.com").email).toBe("jane@acme.com");
    expect(one(" ; jane@acme.com").email).toBe("jane@acme.com");
  });

  it("strips angle brackets", () => {
    expect(one("<jane@acme.com>")).toEqual({ email: "jane@acme.com", domain: "acme.com" });
  });

  it("finds the address in a display-name cell", () => {
    expect(one("Jane Doe <jane@acme.com>")).toEqual({ email: "jane@acme.com", domain: "acme.com" });
  });

  it("puts jane@acme.com. at the same company as bob@acme.com", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company\nJane Doe,jane@acme.com.,Acme\nBob Roe,bob@acme.com,Acme\n",
    );
    const [jane, bob] = persons(s);
    expect(jane?.companyDomain).toBe(bob?.companyDomain);
    expect(bob?.companyDomain).toBe("acme.com");
  });
});

describe("CrmCsvSource: company resolution", () => {
  it("ignores a LinkedIn URL in the website column", () => {
    const s = fromText(
      "crm-generic",
      [
        "Name,Email,Company,Website",
        "Jane Doe,jane@acme.com,Acme,https://www.linkedin.com/company/acme",
        "Bob Roe,bob@gmail.com,Initech,https://uk.linkedin.com/company/initech/",
      ].join("\n"),
    );
    const [jane, bob] = persons(s);
    expect(jane).toMatchObject({ companyDomain: "acme.com" });
    expect(bob).toMatchObject({ companyDomain: null, companySourceKey: "crm-co:initech" });
  });

  it("prefers the website over the email domain", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company,Website\nJane Doe,jane@acme-mail.com,Acme,https://acme.com/team\n",
    );
    expect(persons(s)[0]?.companyDomain).toBe("acme.com");
  });

  it("never keys a company on a freemail domain", () => {
    const s = fromText("crm-generic", "Name,Email,Company\nJane Doe,jane@GMAIL.com,Acme\n");
    expect(persons(s)[0]).toMatchObject({ companyDomain: null, companySourceKey: "crm-co:acme" });
  });

  it("finds a freemail row's firm by a colleague's domain across case and punctuation", () => {
    const s = fromText(
      "crm-generic",
      [
        "Name,Email,Company",
        'Jane Doe,jane@acme.com,"Acme, Inc."',
        "Bob Roe,bob@gmail.com,ACME INC",
        "Ann Poe,,acme inc.",
      ].join("\n"),
    );
    const got = persons(s);
    expect(got.map((p) => p.companyDomain)).toEqual(["acme.com", "acme.com", "acme.com"]);
  });

  it("finds the colleague's domain even when the colleague's row comes later", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company\nBob Roe,bob@gmail.com,Acme\nJane Doe,jane@acme.com,Acme\n",
    );
    expect(persons(s)[0]?.companyDomain).toBe("acme.com");
  });

  it("keys a company named only in non-Latin script instead of rejecting the row", () => {
    const s = fromText("crm-generic", "Name,Email,Company\nTaro Yamada,taro@gmail.com,東京商事\n");
    const [item] = items(s);
    expect(item?.kind).toBe("person");
  });

  it("rejects a row with no website, no work email and no company", () => {
    const s = fromText("crm-generic", "Name,Email,Company\nJane Doe,jane@gmail.com,\n");
    const [item] = items(s);
    expect(item?.kind).toBe("error");
    expect(s.record(1)).toBeNull();
  });
});

describe("CrmCsvSource: records", () => {
  it("hashes ids longer than 128 chars, keeping the keys stable and distinct", () => {
    const long = "x".repeat(129);
    const csv = `ID,Name,Email,Company\n${long},Jane Doe,jane@acme.com,Acme\n${long},Bob Roe,bob@acme.com,Acme\n`;
    const s = fromText("crm-generic", csv);
    items(s);
    const [a, b] = [s.record(1)?.crmKey, s.record(2)?.crmKey];
    expect(a).toMatch(/^h:/);
    expect(a?.length).toBeLessThanOrEqual(128);
    expect(a).not.toBe(b);
    const again = fromText("crm-generic", csv);
    items(again);
    expect(again.record(1)?.crmKey).toBe(a);
    expect(again.record(2)?.crmKey).toBe(b);
  });

  it("keeps an id of exactly 128 chars as the key", () => {
    const id = "7".repeat(128);
    const s = fromText("crm-generic", `ID,Name,Email,Company\n${id},Jane Doe,jane@acme.com,Acme\n`);
    items(s);
    expect(s.record(1)?.crmKey).toBe(id);
  });

  it("trims whitespace around the id", () => {
    const s = fromText("crm-generic", "ID,Name,Email,Company\n  42 ,Jane Doe,jane@acme.com,Acme\n");
    items(s);
    expect(s.record(1)?.crmKey).toBe("42");
  });

  it("numbers identical id-less rows apart, error rows in between do not shift them", () => {
    const csv =
      "Name,Email,Company\nA B,a@acme.com,Acme\n,nobody@acme.com,Acme\nA B,a@acme.com,Acme\n";
    const s = fromText("crm-generic", csv);
    items(s);
    expect(s.record(2)).toBeNull();
    expect(s.record(1)?.crmKey).toMatch(/#1$/);
    expect(s.record(3)?.crmKey).toBe(s.record(1)?.crmKey?.replace("#1", "#2"));
  });

  it("gives every date column the file's one day order", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company,Last Contacted,Created\nJane Doe,jane@acme.com,Acme,03/04/2024,13/02/2020\n",
    );
    const [jane] = persons(s);
    expect(s.record(1)).toMatchObject({ lastContactedOn: "2024-04-03", addedOn: "2020-02-13" });
    expect(jane?.asOf).toBe("2024-04-03");
  });

  it("falls back to the created date for as_of when never contacted", () => {
    const s = fromText(
      "crm-generic",
      "Name,Email,Company,Last Contacted,Created\nJane Doe,jane@acme.com,Acme,N/A,2021-06-01\n",
    );
    expect(persons(s)[0]?.asOf).toBe("2021-06-01");
    expect(s.record(1)?.lastContactedOn).toBeNull();
  });

  it("reads a HubSpot export end to end", () => {
    const csv = [
      "Record ID,First Name,Last Name,Email,Phone Number,Job Title,Contact owner,Lifecycle Stage,Create Date,Last Activity Date,Last Contacted,Company Name,Website URL",
      "51,JANE,doe,Jane@Acme.com,+1 555 0100,VP Talent,Sam Lee,customer,2021-04-01 09:12,2024-03-05 14:22,2024-03-01 10:00,Acme Corp,acme.com",
      "52,Bob,Roe,bob@gmail.com,,,,lead,2022-01-01 00:00,,,Acme Corp,",
    ].join("\n");
    const s = fromText("hubspot", csv);
    const [jane, bob] = persons(s);
    expect(jane).toMatchObject({
      fullName: "Jane Doe",
      title: "VP Talent",
      companyDomain: "acme.com",
      companyName: "Acme Corp",
      origin: "crm",
      asOf: "2024-03-01",
    });
    expect(bob).toMatchObject({ companyDomain: "acme.com", asOf: "2022-01-01" });
    expect(s.record(1)).toEqual({
      crmKey: "51",
      email: "jane@acme.com",
      phone: "+1 555 0100",
      owner: "Sam Lee",
      status: "customer",
      lastContactedOn: "2024-03-01",
      lastPlacementOn: null,
      addedOn: "2021-04-01",
    });
  });
});

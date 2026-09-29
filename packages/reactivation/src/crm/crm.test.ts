import { describe, expect, it } from "vitest";
import { dayOrder, parseCrmDate } from "./dates.js";
import { CRM_FORMATS, mapHeaders, normalizeHeader } from "./formats.js";
import { CrmCsvSource } from "./source.js";

const format = (name: string) => {
  const f = CRM_FORMATS.get(name);
  if (!f) throw new Error(name);
  return f;
};
const source = (name: string, csv: string) =>
  new CrmCsvSource(format(name), "test.csv", new TextEncoder().encode(csv));

describe("headers", () => {
  it("normalizes API names, dots and underscores alike", () => {
    expect(normalizeHeader("Account.Name")).toBe("account name");
    expect(normalizeHeader("LastActivityDate")).toBe("last activity date");
    expect(normalizeHeader(" first_name ")).toBe("first name");
  });

  it("prefers the dialect's own names, then the generic ones", () => {
    const map = mapHeaders(format("hubspot"), [
      "Record ID",
      "First Name",
      "Last Name",
      "Email",
      "Company Name",
      "Last Activity Date",
      "Last Contacted",
      "Contact owner",
    ]);
    expect(map).toMatchObject({
      id: "Record ID",
      firstName: "First Name",
      email: "Email",
      company: "Company Name",
      lastContacted: "Last Contacted",
      owner: "Contact owner",
    });
  });

  it("reads Salesforce API names", () => {
    const map = mapHeaders(format("salesforce"), [
      "Id",
      "FirstName",
      "LastName",
      "Email",
      "Account.Name",
      "LastActivityDate",
    ]);
    expect(map).toMatchObject({
      id: "Id",
      firstName: "FirstName",
      lastName: "LastName",
      company: "Account.Name",
      lastContacted: "LastActivityDate",
    });
  });

  it("fails loudly, naming the headers, when no row could make a person", () => {
    expect(() => mapHeaders(format("crm-generic"), ["Email", "Phone"])).toThrow(
      /no a name .*Headers: Email, Phone/,
    );
    expect(() => mapHeaders(format("crm-generic"), ["Name", "Phone"])).toThrow(
      /email, company or website/,
    );
  });
});

describe("dates", () => {
  it("reads the shapes CRMs export", () => {
    expect(parseCrmDate("2024-03-05 14:22")).toBe("2024-03-05");
    expect(parseCrmDate("2024-03-05T14:22:00Z")).toBe("2024-03-05");
    expect(parseCrmDate("3/5/24")).toBe("2024-03-05");
    expect(parseCrmDate("03/05/2024 2:22 PM")).toBe("2024-03-05");
    expect(parseCrmDate("05/03/2024", "dmy")).toBe("2024-03-05");
    expect(parseCrmDate("Mar 5, 2024")).toBe("2024-03-05");
    expect(parseCrmDate("5 March 2024")).toBe("2024-03-05");
    expect(parseCrmDate("1709647320000")).toBe("2024-03-05");
  });

  it("returns null for what it cannot read, never a guess", () => {
    expect(parseCrmDate("")).toBeNull();
    expect(parseCrmDate("soon")).toBeNull();
    expect(parseCrmDate("2/30/2024")).toBeNull();
  });

  it("settles day-first when one value cannot be month-first", () => {
    expect(dayOrder(["03/05/2024", "04/06/2024"])).toBe("mdy");
    expect(dayOrder(["03/05/2024", "25/06/2024"])).toBe("dmy");
  });
});

describe("rows", () => {
  const csv = [
    "ID,Name,Email,Company,Website,Owner,Last Note,Date Added,Title",
    "1,JANE DOE,jane@acme.com,Acme,,Sam,25/01/2024,01/02/2020,VP Talent",
    "2,Bob Roe,bob.roe@gmail.com,Acme,,Sam,,,",
    "3,Ann Poe,,Globex Corp,https://www.globex.io/about,Kim,,,",
    "4,Lee Moe,lee@gmail.com,Initech,,,,,",
    "5,Ray Zoe,,,,,,,",
    "6,,x@y.com,Y,,,,,",
  ].join("\n");

  it("maps each row to a person at a company, keeping the CRM facts", () => {
    const s = source("bullhorn", csv);
    const items = [...s.rows()];
    expect(items.map((i) => i.kind)).toEqual([
      "person",
      "person",
      "person",
      "person",
      "error",
      "error",
    ]);
    const [jane, bob, ann, lee] = items;
    expect(jane).toMatchObject({
      fullName: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      companyDomain: "acme.com",
      title: "VP Talent",
      origin: "crm",
      asOf: "2024-01-25",
    });
    // A freemail row finds its firm through a colleague's work address.
    expect(bob).toMatchObject({ companyDomain: "acme.com", companySourceKey: null });
    expect(ann).toMatchObject({ companyDomain: "globex.io" });
    // No domain anywhere: keyed by the name.
    expect(lee).toMatchObject({ companyDomain: null, companySourceKey: "crm-co:initech" });
    expect(s.record(1)).toEqual({
      crmKey: "1",
      email: "jane@acme.com",
      phone: null,
      owner: "Sam",
      status: null,
      lastContactedOn: "2024-01-25",
      lastPlacementOn: null,
      addedOn: "2020-02-01",
    });
    expect(s.record(5)).toBeNull();
  });

  it("keys id-less rows by their hash, numbering identical rows apart", () => {
    const s = source("crm-generic", "Name,Email\nA B,a@acme.com\nA B,a@acme.com\nC D,c@acme.com\n");
    [...s.rows()];
    const keys = [1, 2, 3].map((n) => s.record(n)?.crmKey);
    expect(keys[0]).toMatch(/^h:[0-9a-f]{40}#1$/);
    expect(keys[1]).toBe(keys[0]?.replace("#1", "#2"));
    expect(keys[2]).toMatch(/#1$/);
    // Same file, same keys: a re-import updates, never doubles.
    const again = source(
      "crm-generic",
      "Name,Email\nA B,a@acme.com\nA B,a@acme.com\nC D,c@acme.com\n",
    );
    [...again.rows()];
    expect(again.record(2)?.crmKey).toBe(keys[1]);
  });
});

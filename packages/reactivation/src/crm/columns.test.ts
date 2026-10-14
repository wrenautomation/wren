// The portal's import picks its own columns: the guess, the check on it, and a chosen map.
import { describe, expect, it } from "vitest";
import { CRM_FORMATS, checkHeaders, guessHeaders, mapHeaders, missingFields } from "./formats.js";
import { CrmCsvSource, fileHeadersOf } from "./source.js";

const generic = CRM_FORMATS.get("crm-generic");
if (!generic) throw new Error("no generic format");
const bytes = (csv: string) => new TextEncoder().encode(csv);

describe("guessing columns", () => {
  it("reads what the synonym tables reach, and never fails", () => {
    expect(guessHeaders(generic, ["Name", "Company", "Email"])).toMatchObject({
      fullName: "Name",
      company: "Company",
      email: "Email",
    });
    expect(guessHeaders(generic, ["Who", "Where"])).toEqual({});
  });

  it("says what a map lacks, in words", () => {
    expect(missingFields({})).toEqual([
      "a name (Name, or First Name)",
      "an email, company or website column",
    ]);
    expect(missingFields({ firstName: "First", website: "Site" })).toEqual([]);
  });

  it("fails the way it always did when the guess is not enough", () => {
    expect(() => mapHeaders(generic, ["Who", "Where"])).toThrow(/no a name .* Headers: Who, Where/);
    expect(() => checkHeaders(generic, { fullName: "Who" }, ["Who"])).toThrow(/no an email/);
  });
});

describe("a chosen map", () => {
  const csv = "Who,Where,Mail\nAna Reyes,Birch Staffing,ana@birchstaffing.example\n";

  it("is used in place of the guess, over the file's own header names", () => {
    const s = new CrmCsvSource(generic, "f.csv", bytes(csv), {
      fullName: "Who",
      company: "Where",
      email: "Mail",
    });
    expect(s.fileHeaders).toEqual(["Who", "Where", "Mail"]);
    expect(s.rowCount).toBe(1);
    // The CRM facts fill as the rows are read.
    expect([...s.rows()]).toHaveLength(1);
    expect(s.record(1)).toMatchObject({ email: "ana@birchstaffing.example" });
  });

  it("refuses a column the file lacks, or a map that is not enough", () => {
    expect(() => new CrmCsvSource(generic, "f.csv", bytes(csv), { fullName: "Nope" })).toThrow(
      "no column named Nope in the file",
    );
    expect(() => new CrmCsvSource(generic, "f.csv", bytes(csv), { fullName: "Who" })).toThrow(
      /no an email/,
    );
  });

  it("reads a repeated header as the rows key it", () => {
    expect(
      fileHeadersOf(bytes("Email,Name,Email\na@x.example,Ana,b@x.example\n"), "f.csv"),
    ).toEqual(["Email", "Name", "Email__2"]);
  });
});

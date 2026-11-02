/** `classifyValue` and `csvValues`: the pure parsing/validation half of suppress.ts — no database. */
import { describe, expect, it } from "vitest";
import { classifyValue, csvValues } from "./suppress.js";

/** The simplest CSV reader a test needs: no quoting, blank lines kept as empty rows. */
const rows = (text: string): string[][] =>
  text.split("\n").map((line) => (line === "" ? [] : line.split(",")));

describe("classifyValue", () => {
  it.each<[string, "email" | "domain", string]>([
    ["Jane@Foo.COM", "email", "jane@foo.com"],
    [" jane@foo.com ", "email", "jane@foo.com"],
    ["foo.com", "domain", "foo.com"],
    ["Foo.Example.COM", "domain", "foo.example.com"],
    ["sub-domain.example.co", "domain", "sub-domain.example.co"],
    ["jane@foo", "email", "jane@foo"],
  ])("normalizes %j and infers its kind", (raw, kind, normalized) => {
    expect(classifyValue(raw)).toEqual([kind, normalized]);
  });

  it.each(["", "   ", "not a value", "example", "@foo.com", "jane@"])("rejects junk %j", (raw) => {
    expect(() => classifyValue(raw)).toThrow();
  });
});

describe("csvValues", () => {
  it("reads a header's email column", () => {
    const text = "name,email,notes\nJane,jane@foo.com,past client\nBob,bob@bar.com,friend\n";
    expect(csvValues(rows(text))).toEqual(["jane@foo.com", "bob@bar.com"]);
  });

  it("reads a header's domain column", () => {
    expect(csvValues(rows("notes,domain\nrival,rival.com\nally,ally.example\n"))).toEqual([
      "rival.com",
      "ally.example",
    ]);
  });

  it("accepts the e-mail header alias", () => {
    expect(csvValues(rows("E-Mail,other\njane@foo.com,x\n"))).toEqual(["jane@foo.com"]);
  });

  it("falls back to the first column", () => {
    expect(csvValues(rows("who,what\njane@foo.com,client\n"))).toEqual(["jane@foo.com"]);
  });

  it("an explicit column overrides the guess", () => {
    const text = "email,backup_domain\njane@foo.com,foo-backup.com\n";
    expect(csvValues(rows(text), { column: "backup_domain" })).toEqual(["foo-backup.com"]);
  });

  it("an explicit column that is missing throws", () => {
    expect(() => csvValues(rows("email\njane@foo.com\n"), { column: "nope" })).toThrow();
  });

  it("reads a headerless email list", () => {
    expect(csvValues(rows("jane@foo.com\nbob@bar.com\n"))).toEqual(["jane@foo.com", "bob@bar.com"]);
  });

  it("reads a headerless domain list", () => {
    expect(csvValues(rows("rival.com\nally.example\n"))).toEqual(["rival.com", "ally.example"]);
  });

  it("skips blank rows and cells", () => {
    expect(csvValues(rows("email\njane@foo.com\n\n \nbob@bar.com\n"))).toEqual([
      "jane@foo.com",
      "bob@bar.com",
    ]);
  });

  it("an empty file yields nothing", () => {
    expect(csvValues(rows(""))).toEqual([]);
  });
});

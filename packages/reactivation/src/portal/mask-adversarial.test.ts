/**
 * Adversarial cases for the demo mask: the ways a surname, an address's local
 * part or a profile's vanity can still reach a demo visitor. Each test states
 * what the demo must never show.
 */
import { describe, expect, it } from "vitest";
import { hiddenWords, makeMask } from "./mask.js";

const person = (first: string | null, last: string | null, full: string | null = null) => ({
  first,
  last,
  full,
});

describe("names that should already work", () => {
  const mask = makeMask([
    person("Sean", "O'Brien", "Sean O'Brien"),
    person("Ana", "García", "Ana García"),
    person("Jane", "Doe", "Jane Doe"),
    person("Pat", "Smith-Jones", "Pat Smith-Jones"),
    person("Ann", "Kowalski", "Ann Marie Kowalski"),
    person(null, null, "Li Wei Zhang"),
  ]);

  it("apostrophes, accents, all-caps, possessives, hyphenated pairs, middle names", () => {
    expect(
      mask("Sean O'Brien, ANA GARCÍA and Doe's team; Pat Smith-Jones; Ann Marie Kowalski"),
    ).toBe("Sean O., ANA G. and D.'s team; Pat S.; Ann M. K.");
  });

  it("a name in a path or query string", () => {
    expect(mask("https://acme.com/team/jane-doe?who=doe&x=1")).toBe(
      "https://acme.com/team/jane-D.?who=D.&x=1",
    );
  });

  it("only full_name set", () => {
    expect(mask("Li Wei Zhang")).toBe("Li W. Z.");
  });

  it("plus tags and uppercase addresses", () => {
    expect(mask("JANE.DOE+crm@Acme.COM")).toBe("J•••@Acme.COM");
  });

  it("LinkedIn /pub/ and country subdomains", () => {
    expect(mask("https://uk.linkedin.com/pub/jane-doe/12/345/678")).toBe(
      "https://uk.linkedin.com/pub/•••/12/345/678",
    );
    expect(mask("HTTPS://WWW.LINKEDIN.COM/IN/JaneDoe123")).toBe("HTTPS://WWW.LINKEDIN.COM/IN/•••");
  });
});

describe("leaks", () => {
  // Was a bug: a CRM that puts the whole name in first_name shows "Jane Doe" on the demo in full.
  it("a full name stored in first_name", () => {
    const mask = makeMask([person("Jane Doe", null, null)]);
    expect(mask("Jane Doe")).toBe("Jane D.");
  });

  // Was a bug: "Last, First" full names (common CRM export) hide the first name and show the surname.
  it("a 'Last, First' full name with no first_name", () => {
    const mask = makeMask([person(null, null, "Doe, Jane")]);
    expect(mask("Jane Doe")).not.toMatch(/Doe/);
  });

  // Was a bug: a hyphenated surname's halves appear alone in titles ("Ms. Jones") and leak.
  it("half of a hyphenated surname on its own", () => {
    const mask = makeMask([person("Pat", "Smith-Jones", "Pat Smith-Jones")]);
    expect(mask("Pat Jones joined Initech")).not.toMatch(/Jones/);
  });

  // Was a bug: pages and URLs carry the name unaccented; the accented surname never matches.
  it("an accented surname written without the accent", () => {
    const mask = makeMask([person("Ana", "García", "Ana García")]);
    expect(mask("https://acme.com/team/ana-garcia")).not.toMatch(/garcia/i);
  });

  // Was a bug: text from the web in decomposed Unicode (NFD) never matches the stored (NFC) surname.
  it("an accented surname in decomposed form", () => {
    const mask = makeMask([person("Ana", "García", "Ana García")]);
    expect(mask("Ana García")).not.toMatch(/Garc/);
  });

  // Was a bug: a typographic apostrophe (LinkedIn titles use it) slips past a name stored with a straight one.
  it("a curly apostrophe", () => {
    const mask = makeMask([person("Sean", "O'Brien", "Sean O'Brien")]);
    expect(mask("Sean O’Brien - Recruiter | LinkedIn")).not.toMatch(/Brien/);
  });

  // Was a bug: a URL-encoded space ("%20") puts a digit before the surname, so the word boundary fails.
  it("a surname after a URL-encoded space", () => {
    const mask = makeMask([person("Jane", "Doe", "Jane Doe")]);
    expect(mask("https://www.google.com/search?q=Jane%20Doe")).not.toMatch(/Doe/);
  });

  // Was a bug: a LinkedIn link nested in a redirect URL keeps its vanity.
  it("a URL-encoded LinkedIn profile", () => {
    const mask = makeMask([]);
    expect(
      mask("https://www.google.com/url?q=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fjanedoe123"),
    ).not.toMatch(/janedoe/);
  });

  // Was a bug: search results show profiles as breadcrumbs ("linkedin.com › in › vanity"), not slashes.
  it("a LinkedIn breadcrumb from a search result", () => {
    const mask = makeMask([]);
    expect(mask("ca.linkedin.com › in › janedoe123")).not.toMatch(/janedoe/);
  });

  // Was a bug: finding values are free-form JSON; a name used as a key is never masked.
  it("a surname in an object key", () => {
    const mask = makeMask([person("Jane", "Doe", "Jane Doe")]);
    expect(JSON.stringify(mask({ people: { "Jane Doe": { title: "Lead" } } }))).not.toMatch(/Doe/);
  });

  // Was a bug: an address in a key (e.g. {"jane.doe@acme.com": "valid"}) keeps its local part.
  it("an address in an object key", () => {
    const mask = makeMask([]);
    expect(JSON.stringify(mask({ "jane.doe@acme.com": "valid" }))).not.toMatch(/jane/);
  });

  // Was a bug: a maiden name in parentheses is dropped with the nicknames, so it shows in full.
  it("a maiden name in parentheses", () => {
    expect(hiddenWords([person("Jane", "Smith", "Jane Smith (née Doe)")])).toContain("doe");
  });

  // Was a bug: one-character surnames (common in Chinese: 张, 王, 李) are skipped as "one letter".
  it("a one-character CJK surname", () => {
    const mask = makeMask([person("伟", "张", "张 伟")]);
    expect(mask("张 伟 joined Initech")).not.toMatch(/张/);
  });
});

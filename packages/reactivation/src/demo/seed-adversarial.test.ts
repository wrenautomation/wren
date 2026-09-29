/**
 * Adversarial tests for the demo seed's made-up half: guessed addresses, the
 * export's mess, the Bullhorn CSV. Tests state what SHOULD happen; a failing
 * one is a bug.
 */
import { emailSyntaxError } from "@wren/core";
import { describe, expect, it } from "vitest";
import { parseCrmDate } from "../crm/dates.js";
import { CRM_FORMATS } from "../crm/formats.js";
import { CrmCsvSource } from "../crm/source.js";
import { seededRng, simulateHistory, usDate } from "./history.js";
import { guessEmail, messUp, type SeedRow, toBullhornCsv } from "./seed.js";

const row = (over: Partial<SeedRow> = {}): SeedRow => ({
  id: "1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane.doe@umbrellahealth.example",
  title: "Talent Lead",
  company: "Umbrella Health",
  website: "https://umbrellahealth.example",
  linkedin: "",
  owner: "Sam Patel",
  status: "Client",
  created: "01/02/2020",
  lastContacted: "",
  lastPlacement: "",
  ...over,
});

/** An rng that plays back fixed numbers, so each mess rule can be forced. */
const scripted = (xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length] as number;
};

describe("guessEmail", () => {
  // Was a bug: NFKD can't split Ł, Ø, ß or đ, so the letter is silently dropped: "ukasz.nowak@" is a wrong address (maybe someone else's), not a guess at Łukasz.
  it("a letter NFKD can't split is spelled out or the guess is refused, never dropped", () => {
    const cases: [string, string, string[]][] = [
      ["Łukasz", "Nowak", ["lukasz.nowak@acme.example"]],
      ["Øystein", "Dahl", ["oystein.dahl@acme.example", "oeystein.dahl@acme.example"]],
      ["Anna", "Groß", ["anna.gross@acme.example", "anna.gros@acme.example"]],
      ["Đorđe", "Petrović", ["dorde.petrovic@acme.example", "djordje.petrovic@acme.example"]],
    ];
    const wrong = cases.filter(([f, l, ok]) => {
      const got = guessEmail(f, l, "acme.example");
      return got !== null && !ok.includes(got);
    });
    expect(wrong.map(([f, l]) => `${f} ${l} -> ${guessEmail(f, l, "acme.example")}`)).toEqual([]);
  });

  // Was a bug: no length cap, so two long names make a local part over 64 chars, an address no mail server accepts.
  it("a guess is a valid address or none", () => {
    const got = guessEmail(
      "Wolfeschlegelsteinhausenberger",
      "Bergerdorffvoralternwarengewissenhaft",
      "acme.example",
    );
    expect(got === null || emailSyntaxError(got) === null).toBe(true);
  });
});

describe("messUp", () => {
  // Was a bug: the "Inc." variant is appended blindly, so "Globex Inc." becomes "Globex Inc. Inc.", a spelling no recruiter typed.
  it("the second spelling of a name that already ends in Inc. is not Inc. Inc.", () => {
    // title kept, company varied, "Inc." variant, site kept, no duplicate
    const [out] = messUp(scripted([0.9, 0.0, 0.0, 0.9, 0.9]), [row({ company: "Globex Inc." })]);
    expect(out?.company).not.toMatch(/Inc\.\s+Inc\./);
  });

  it("holds: a duplicate differs only by id, capitals and blanks; nobody is lost", () => {
    // no title blank, no variant, no site blank, duplicate
    const out = messUp(scripted([0.9, 0.9, 0.9, 0.0]), [
      row({ linkedin: "https://www.linkedin.com/in/janedoe/" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      ...out[0],
      id: "2",
      email: "JANE.DOE@UMBRELLAHEALTH.EXAMPLE",
      title: "",
      linkedin: "",
    });
  });
});

describe("toBullhornCsv through the Bullhorn import", () => {
  it("holds: commas, quotes, newlines, accents and emoji come back as written", () => {
    const rows = [
      row({
        firstName: "Zoë",
        lastName: "O'Brien-Núñez",
        title: 'Director, "Talent" Acquisition 🚀',
        company: "Smith, Jones & Co\nHealth",
      }),
      row({ id: "2", firstName: "李", lastName: "Wang", email: "", company: "Café Nova" }),
    ];
    const csv = toBullhornCsv(rows);
    const format = CRM_FORMATS.get("bullhorn");
    if (!format) throw new Error("no bullhorn format");
    const source = new CrmCsvSource(format, "t.csv", new TextEncoder().encode(csv));
    const got = [...source.rows()].map((p) =>
      p.kind === "person" ? [p.firstName, p.lastName, p.title, p.companyName] : p.reason,
    );
    expect(got).toEqual([
      ["Zoë", "O'Brien-Núñez", 'Director, "Talent" Acquisition 🚀', "Smith, Jones & Co\nHealth"],
      ["李", "Wang", "Talent Lead", "Café Nova"],
    ]);
  });
});

describe("simulateHistory", () => {
  it("holds: across seeds and odd days, dates are in order, in the past, and parse back to the same day", () => {
    for (const today of [
      new Date("2028-02-29T23:59:59Z"),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-09-29T04:00:00-08:00"),
    ]) {
      for (const seed of ["a.example", "www.b.example", "c.example"]) {
        const rng = seededRng(seed);
        for (let i = 0; i < 300; i++) {
          const h = simulateHistory(rng, today);
          const dates = [h.created, h.lastPlacement, h.lastContacted].filter(
            (d): d is Date => d !== null,
          );
          for (const d of dates) {
            expect(d.getTime()).toBeLessThan(today.getTime());
            expect(parseCrmDate(usDate(d))).toBe(d.toISOString().slice(0, 10));
          }
          if (h.lastContacted) expect(h.lastContacted > h.created).toBe(true);
          if (h.lastPlacement) expect(h.lastPlacement > h.created).toBe(true);
          if (h.lastPlacement && h.lastContacted)
            expect(h.lastPlacement <= h.lastContacted).toBe(true);
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { hiddenWords, makeMask } from "./mask.js";

const names = [
  { first: "Sarah", last: "Kowalski", full: "Sarah Kowalski" },
  { first: "José", last: "O'Neil-Smith", full: "José (Pepe) Maria O'Neil-Smith, SHRM-CP" },
  { first: null, last: null, full: "Li Wei Zhang" },
];

describe("hiddenWords", () => {
  it("everything in a name but the first name; nicknames and one letter skipped", () => {
    expect(hiddenWords(names)).toEqual([
      "o'neil-smith",
      "kowalski",
      "shrm-cp",
      "maria",
      "zhang",
      "wei",
    ]);
  });
});

describe("makeMask", () => {
  const mask = makeMask(names);
  it("names become an initial, anywhere in any string", () => {
    expect(mask({ name: "Sarah Kowalski", reasons: [{ reason: "KOWALSKI moved" }] })).toEqual({
      name: "Sarah K.",
      reasons: [{ reason: "K. moved" }],
    });
    expect(mask("José Maria O'Neil-Smith")).toBe("José M. O.");
  });
  it("a name inside another word stays", () => {
    expect(mask("Kowalskiego Street, Weiss Group")).toBe("Kowalskiego Street, Weiss Group");
  });
  it("addresses keep a letter and the domain; profile links lose the name", () => {
    expect(mask("mail sarah.kowalski@acme.com or s@x.io")).toBe("mail s•••@acme.com or s•••@x.io");
    expect(mask({ url: "https://ca.linkedin.com/in/sarah-k-123/?x=1" })).toEqual({
      url: "https://ca.linkedin.com/in/•••/?x=1",
    });
  });
  it("numbers, nulls, booleans and companies pass", () => {
    expect(mask({ n: 3, x: null, ok: true, firm: "Umbrella Health" })).toEqual({
      n: 3,
      x: null,
      ok: true,
      firm: "Umbrella Health",
    });
  });
  it("an empty list masks addresses only", () => {
    expect(makeMask([])("Sarah Kowalski s.k@acme.com")).toBe("Sarah Kowalski s•••@acme.com");
  });
});

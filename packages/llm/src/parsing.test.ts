import { describe, expect, it } from "vitest";
import { z } from "zod";
import { firstJsonObject, NO_JSON_OBJECT, parseModel, wellFormed } from "./parsing.js";

const Answer = z.object({ items: z.array(z.string()).default([]) });

describe("firstJsonObject", () => {
  it("ignores trailing prose with braces", () => {
    const text =
      'Sure! ```json\n{"people": [], "generic_emails": ["a@b.co"]}\n```\nNote: {braces} after.';
    expect(firstJsonObject(text)).toEqual({ people: [], generic_emails: ["a@b.co"] });
  });

  it("skips leading junk and non-objects", () => {
    expect(firstJsonObject('prose {not json} then {"ok": 1}')).toEqual({ ok: 1 });
    expect(firstJsonObject("no braces at all")).toBe(NO_JSON_OBJECT);
    expect(firstJsonObject("[1, 2] then {")).toBe(NO_JSON_OBJECT);
  });

  // Was a bug: Cohere writes real line breaks inside strings, so a whole email draft read as "no JSON object".
  it("reads raw line breaks and tabs inside strings", () => {
    const text =
      '```json\n{\n  "opener": "Hi Peter,\n\nA call?\tThanks.",\n  "note": "a \\"q\\""\n}\n```';
    expect(firstJsonObject(text)).toEqual({
      opener: "Hi Peter,\n\nA call?\tThanks.",
      note: 'a "q"',
    });
  });

  it("handles braces inside strings", () => {
    expect(firstJsonObject('{"a": "}{", "b": 1}')).toEqual({ a: "}{", b: 1 });
  });
});

describe("parseModel", () => {
  it("returns the typed value", () => {
    expect(parseModel('{"items": ["a"]}', Answer)).toEqual({ items: ["a"] });
  });
  it("returns a ValidationError string for the wrong shape", () => {
    const out = parseModel('{"items": "not a list"}', Answer);
    expect(typeof out).toBe("string");
    expect(out as string).toMatch(/^ValidationError: items:/);
  });
  it("returns the no-object reason", () => {
    expect(parseModel("no json here", Answer)).toBe(NO_JSON_OBJECT);
  });
});

describe("wellFormed", () => {
  it("drops half an emoji and keeps whole ones", () => {
    expect(wellFormed("\uDC64 Jane 👤 Doe \uD83D")).toBe(" Jane 👤 Doe ");
  });
});

import { describe, expect, it } from "vitest";
import { pyRepr, pyReprStr } from "./pyrepr.js";

describe("pyRepr", () => {
  it("matches Python repr on the verified sample", () => {
    // Verified against CPython: repr(('t', "you've", 'a"b', 'both\'"', None, ('x',), (), 'é—\xa0​\n\t\\'))
    const value = ["t", "you've", 'a"b', "both'\"", null, ["x"], [], "é— ​\n\t\\"];
    expect(pyRepr(value)).toBe(
      "('t', \"you've\", 'a\"b', 'both\\'\"', None, ('x',), (), 'é—\\xa0\\u200b\\n\\t\\\\')",
    );
  });
  it("escapes control characters and astral non-printables", () => {
    expect(pyReprStr("\x01\x7f")).toBe("'\\x01\\x7f'");
    expect(pyReprStr(" ")).toBe("'\\u2028'");
    expect(pyReprStr("😀")).toBe("'😀'");
    expect(pyReprStr("\u{e0001}")).toBe("'\\U000e0001'");
  });
});

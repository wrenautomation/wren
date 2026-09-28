import { describe, expect, it } from "vitest";
import { errorText, formatDelay, retryDelayMs } from "./loop.js";

describe("retryDelayMs", () => {
  it("starts at 15s, doubles per failure in a row, stops at the cap", () => {
    const cap = 8 * 60_000;
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => retryDelayMs(n, cap))).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 480_000, 480_000,
    ]);
    expect(retryDelayMs(3, 3_000)).toBe(3_000);
  });
});

describe("errorText", () => {
  it("names the query and the root cause, never the SQL or params", () => {
    const cause = Object.assign(new Error("sorry, too many clients already"), {
      name: "PostgresError",
    });
    const err = Object.assign(
      new Error('Failed query: insert into "runs" ("id") values ($1)\nparams: 9f1c'),
      { query: 'insert into "runs" ("id") values ($1)', cause },
    );
    expect(errorText(err)).toBe('insert "runs": PostgresError: sorry, too many clients already');
  });
  it("is the same text when only the params differ", () => {
    const a = Object.assign(new Error("params: a"), { query: 'update "messages" set x = $1' });
    const b = Object.assign(new Error("params: b"), { query: 'update "messages" set x = $1' });
    expect(errorText(a)).toBe(errorText(b));
    expect(errorText(a)).toBe('update "messages": query failed');
  });
  it("keeps a plain error as name and message", () => {
    expect(errorText(new TypeError("boom"))).toBe("TypeError: boom");
    expect(errorText("nope")).toBe("nope");
  });
});

describe("formatDelay", () => {
  it("says seconds under a minute", () => {
    expect([15_000, 59_000, 60_000, 480_000].map(formatDelay)).toEqual([
      "15 s",
      "59 s",
      "1 min",
      "8 min",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { failureOf } from "./feedback.js";

/** An error as the portal's calls throw it: a message and the HTTP status. */
const failed = (message: string, status: number) => Object.assign(new Error(message), { status });

describe("failureOf", () => {
  it("names what's missing on a 404, and offers no retry", () => {
    expect(failureOf(failed("no such draft", 404), "draft")).toEqual({
      line: "This draft wasn't found. It may have been deleted, or the link is out of date.",
      again: false,
      raw: "no such draft",
    });
    expect(failureOf(failed("not found", 500)).line).toBe(
      "This page wasn't found. The link may be out of date.",
    );
  });

  it("says a raw server error as a plain sentence, keeping the raw text", () => {
    const f = failureOf(failed('relation "x" does not resolve', 500));
    expect(f.line).toBe("This page couldn't load.");
    expect(f.again).toBe(true);
    expect(f.raw).toBe('relation "x" does not resolve');
  });

  it("keeps a message already written for people", () => {
    expect(failureOf(failed("Sign-in is busy. Try again in a minute.", 500)).line).toBe(
      "Sign-in is busy. Try again in a minute.",
    );
  });

  it("says access, offline and busy plainly", () => {
    expect(failureOf(failed("forbidden", 403)).line).toBe("You don't have access to this.");
    expect(failureOf(failed("You're offline, or the portal is.", 0)).line).toBe(
      "Couldn't reach Wren. Check your connection.",
    );
    expect(failureOf(failed("slow down", 429)).again).toBe(true);
  });
});

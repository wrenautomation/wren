/** The recruiting opener template with and without the company's opener line. */
import { CALL_TIMES, render } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { recruiting } from "./index.js";

const tpl = () => {
  const t = recruiting.templates.get("book-first/opener");
  if (t === undefined) throw new Error("missing book-first/opener");
  return t;
};
const LINE = "You have placed ICU nurses in Tulsa hospitals since 1999.";
const terms: Readonly<Record<string, string>> = recruiting.offerFacts.get("reactivation") ?? {};
const base = {
  first_name: "Dana",
  company_name: "Tulsa Nurse Partners",
  title: "Owner",
  ...terms,
  "call.times": CALL_TIMES,
};
const body = (facts: Record<string, unknown>) => render(tpl(), facts, "person:7").body;

describe("recruiting book-first opener", () => {
  it("puts the line in its own paragraph after the greeting", () => {
    const b = body({ ...base, "company.opener": LINE });
    expect(b.startsWith(`Hi Dana,\n\n${LINE}\n\n`)).toBe(true);
    expect(b).not.toMatch(/\n{3,}/);
  });

  it("no line leaves no gap, whether the fact is absent, null or blank", () => {
    const without = body(base);
    expect(without).toMatch(/^Hi Dana,\n\n[^\n]/);
    expect(without).not.toContain(LINE);
    expect(without).not.toMatch(/\n{3,}/);
    for (const opener of [null, "", "   "]) {
      expect(body({ ...base, "company.opener": opener })).toBe(without);
    }
  });

  it("a role inbox gets the fallback greeting and still the line", () => {
    const { first_name: _, title: __, ...company } = base;
    const b = body({ ...company, "company.opener": LINE });
    expect(b.startsWith(`Hi there,\n\n${LINE}\n\n`)).toBe(true);
  });

  it("the line only changes its own paragraph", () => {
    const withLine = body({ ...base, "company.opener": LINE });
    expect(withLine.replace(`${LINE}\n\n`, "")).toBe(body(base));
  });

  it("opens on the co-op hook, says who William is, and names the problem", () => {
    const b = body(base);
    expect(
      b.startsWith("Hi Dana,\n\nI'm a software engineering student at the University of Waterloo"),
    ).toBe(true);
    expect(b).toContain("Government of Canada");
    expect(b).toContain("Now I'm looking to work with recruiting firms.");
    expect(b).toContain("Guess what a lot of them are probably doing right now?");
  });

  it("asks for a call with a Google Meet invite and drops the old claims", () => {
    const b = body(base);
    expect(b).toContain("Google Meet invite");
    for (const gone of [
      "I found you",
      "calendar invite",
      "firms at a time",
      "new domain",
      "I'd bet",
    ]) {
      expect(b).not.toContain(gone);
    }
  });

  it("asks for the times, quotes the offer's terms, and leaves no syntax behind", () => {
    const b = body(base);
    expect(b).toContain(CALL_TIMES);
    expect(b).toContain(`${terms["offer.goal"]} meetings in ${terms["offer.days"]} days`);
    expect(b.replace(CALL_TIMES, "")).not.toMatch(/[{}]|\[\[|\(\(|\]\]|\)\)/);
  });
});

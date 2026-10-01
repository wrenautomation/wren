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
const base = {
  first_name: "Dana",
  company_name: "Tulsa Nurse Partners",
  title: "Owner",
  ...recruiting.offerFacts.get("reactivation"),
  "call.times": CALL_TIMES,
};
const body = (facts: Record<string, unknown>) => render(tpl(), facts, "person:7").body;

describe("recruiting book-first opener", () => {
  it("puts the line in its own paragraph after the greeting", () => {
    const b = body({ ...base, "company.opener": LINE });
    expect(
      b.startsWith(
        `Hi Dana,\n\n${LINE}\n\nI found you on the Tulsa Nurse Partners site, listed as Owner, so`,
      ),
    ).toBe(true);
    expect(b).not.toMatch(/\n{3,}/);
  });

  it("no line leaves no gap, whether the fact is absent, null or blank", () => {
    const without = body(base);
    expect(
      without.startsWith(
        "Hi Dana,\n\nI found you on the Tulsa Nurse Partners site, listed as Owner, so",
      ),
    ).toBe(true);
    expect(without).not.toMatch(/\n{3,}/);
    for (const opener of [null, "", "   "]) {
      expect(body({ ...base, "company.opener": opener })).toBe(without);
    }
  });

  it("a role inbox gets the fallback greeting and still the line", () => {
    const { first_name: _, title: __, ...company } = base;
    const b = body({ ...company, "company.opener": LINE });
    expect(
      b.startsWith(`Hi there,\n\n${LINE}\n\nI found you on the Tulsa Nurse Partners site, so`),
    ).toBe(true);
  });

  it("the line only changes its own paragraph", () => {
    const withLine = body({ ...base, "company.opener": LINE });
    expect(withLine.replace(`${LINE}\n\n`, "")).toBe(body(base));
  });
});
